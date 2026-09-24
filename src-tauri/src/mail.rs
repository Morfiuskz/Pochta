use crate::{db, model::*};
use base64::{engine::general_purpose::STANDARD, Engine};
use lettre::{
    message::{header::ContentType, Attachment as MailAttachment, Mailbox, MultiPart, SinglePart},
    transport::smtp::authentication::{Credentials, Mechanism},
    SmtpTransport, Transport,
};
use mailparse::{MailHeaderMap, ParsedMail};
use serde::Serialize;
use std::{
    io::{Read, Write},
    net::{TcpStream, ToSocketAddrs},
    path::Path,
    time::Duration,
};
const TIMEOUT: Duration = Duration::from_secs(25);
const SYNC_LIMIT: usize = 200;
const INITIAL_SYNC_LIMIT: usize = 50;
const SYNC_BATCH_SIZE: usize = 20;
fn imap_error(e: imap::Error) -> String {
    match e {
        imap::Error::Io(_) => "IMAP: сеть недоступна или сервер не отвечает".into(),
        imap::Error::Tls(_) => "IMAP: ошибка TLS. Проверьте сервер и сертификат".into(),
        _ => "IMAP: сервер отклонил запрос. Проверьте подключение и доступ к папке".into(),
    }
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncProgress {
    pub loaded: usize,
    pub total: Option<usize>,
}
pub enum Job<'a> {
    Test,
    Sync(&'a Path, &'a dyn Fn(SyncProgress)),
    Action(&'a Path, &'a str, &'a str),
    Append(&'a [u8]),
}
pub fn run(a: &Account, password: &str, job: Job) -> Result<String> {
    let addrs = (a.imap.host.as_str(), a.imap.port)
        .to_socket_addrs()
        .map_err(|_| "IMAP: не удалось найти сервер. Проверьте сеть и адрес".to_string())?;
    let mut socket = None;
    for addr in addrs {
        if let Ok(s) = TcpStream::connect_timeout(&addr, TIMEOUT) {
            socket = Some(s);
            break;
        }
    }
    let socket = socket.ok_or("IMAP: сервер недоступен или время ожидания истекло")?;
    socket
        .set_read_timeout(Some(TIMEOUT))
        .map_err(|_| "Ошибка настройки сети")?;
    socket
        .set_write_timeout(Some(TIMEOUT))
        .map_err(|_| "Ошибка настройки сети")?;
    let tls = native_tls::TlsConnector::new().map_err(|_| "Не удалось инициализировать TLS")?;
    match a.imap.security {
        Security::Tls => {
            let stream = tls
                .connect(&a.imap.host, socket)
                .map_err(|_| "IMAP: ошибка TLS. Проверьте имя сервера и сертификат")?;
            let mut client = imap::Client::new(stream);
            client.read_greeting().map_err(imap_error)?;
            login_run(client, a, password, job)
        }
        Security::Starttls => {
            let mut client = imap::Client::new(socket);
            client.read_greeting().map_err(imap_error)?;
            let client = client.secure(&a.imap.host, &tls).map_err(imap_error)?;
            login_run(client, a, password, job)
        }
        Security::None => {
            let mut client = imap::Client::new(socket);
            client.read_greeting().map_err(imap_error)?;
            login_run(client, a, password, job)
        }
    }
}
struct Xoauth<'a> {
    login: &'a str,
    token: &'a str,
}
impl imap::Authenticator for Xoauth<'_> {
    type Response = String;
    fn process(&self, challenge: &[u8]) -> String {
        if !challenge.is_empty() {
            return String::new();
        }
        format!("user={}\x01auth=Bearer {}\x01\x01", self.login, self.token)
    }
}
fn login_run<T: Read + Write>(
    client: imap::Client<T>,
    a: &Account,
    p: &str,
    job: Job,
) -> Result<String> {
    let mut s = if matches!(a.auth, AuthMethod::Oauth { .. }) {
        client
            .authenticate(
                "XOAUTH2",
                &Xoauth {
                    login: &a.imap.login,
                    token: p,
                },
            )
            .map_err(|_| match &a.auth {
                AuthMethod::Oauth { provider } => crate::oauth::reauth_message(provider),
                AuthMethod::Password => unreachable!(),
            })?
    } else {
        client.login(&a.imap.login, p).map_err(|_| "Неверный пароль или пароль приложения. Проверьте логин и разрешение IMAP; провайдер может требовать OAuth".to_string())?
    };
    let result = execute(&mut s, a, job);
    let _ = s.logout();
    result
}
pub fn folder_kind(name: &str, attributes: &str) -> String {
    let n = name.to_lowercase();
    let at = attributes.to_lowercase();
    if n == "inbox" {
        "inbox"
    } else if at.contains("sent")
        || ["sent", "sent items", "sent messages", "отправленные"]
            .iter()
            .any(|x| n.ends_with(x))
    {
        "sent"
    } else if at.contains("trash")
        || ["trash", "deleted items", "deleted messages", "корзина"]
            .iter()
            .any(|x| n.ends_with(x))
    {
        "trash"
    } else if at.contains("junk")
        || ["spam", "junk", "junk e-mail", "спам"]
            .iter()
            .any(|x| n.ends_with(x))
    {
        "spam"
    } else if at.contains("draft") || n.ends_with("drafts") || n.ends_with("черновики") {
        "drafts"
    } else if at.contains("archive") || n.ends_with("archive") || n.ends_with("архив") {
        "archive"
    } else {
        "other"
    }
    .into()
}
fn folders<T: Read + Write>(s: &mut imap::Session<T>) -> Result<Vec<(String, String)>> {
    Ok(s.list(None, Some("*"))
        .map_err(imap_error)?
        .iter()
        .filter(|n| {
            !n.attributes()
                .iter()
                .any(|a| matches!(a, imap::types::NameAttribute::NoSelect))
        })
        .map(|n| {
            (
                n.name().to_string(),
                folder_kind(n.name(), &format!("{:?}", n.attributes())),
            )
        })
        .collect())
}
fn execute<T: Read + Write>(s: &mut imap::Session<T>, a: &Account, job: Job) -> Result<String> {
    match job {
        Job::Test => {
            s.noop().map_err(imap_error)?;
            Ok("IMAP подключён".into())
        }
        Job::Sync(path, on_progress) => {
            let mut c = db::open(path)?;
            let mut total = 0;
            let mut known_total = 0;
            let mut sync_folders = folders(s)?;
            sync_folders.sort_by_key(|(_, kind)| if kind == "inbox" { 0 } else { 1 });
            for (folder, kind) in sync_folders {
                if kind == "other" {
                    continue;
                }
                let mb = s.select(&folder).map_err(imap_error)?;
                let validity = mb
                    .uid_validity
                    .ok_or("IMAP: сервер не сообщил UIDVALIDITY")?;
                let all = s.uid_search("UNDELETED").map_err(imap_error)?;
                let mut uids: Vec<u32> = all.iter().copied().collect();
                uids.sort_unstable();
                let recent: Vec<_> = uids.into_iter().rev().take(SYNC_LIMIT).collect();
                known_total += recent.len();
                on_progress(SyncProgress {
                    loaded: total,
                    total: Some(known_total),
                });
                let initial_end = recent.len().min(INITIAL_SYNC_LIMIT);
                let chunks = recent[..initial_end]
                    .chunks(SYNC_BATCH_SIZE)
                    .chain(recent[initial_end..].chunks(SYNC_BATCH_SIZE));
                for chunk in chunks {
                    let set = chunk
                        .iter()
                        .map(u32::to_string)
                        .collect::<Vec<_>>()
                        .join(",");
                    let meta = s
                        .uid_fetch(&set, "(UID FLAGS RFC822.SIZE)")
                        .map_err(imap_error)?;
                    let eligible = meta
                        .iter()
                        .filter(|f| f.size.unwrap_or(0) <= 25 * 1024 * 1024)
                        .filter_map(|f| f.uid)
                        .map(|u| u.to_string())
                        .collect::<Vec<_>>()
                        .join(",");
                    if eligible.is_empty() {
                        continue;
                    }
                    let fetched = s
                        .uid_fetch(eligible, "(UID FLAGS INTERNALDATE BODY.PEEK[])")
                        .map_err(imap_error)?;
                    let mut messages = Vec::new();
                    for f in fetched.iter() {
                        if let (Some(uid), Some(body)) = (f.uid, f.body()) {
                            let mut m = parse(body, a, &folder, &kind, uid, validity)?;
                            m.read = f
                                .flags()
                                .iter()
                                .any(|f| matches!(f, imap::types::Flag::Seen));
                            m.starred = f
                                .flags()
                                .iter()
                                .any(|f| matches!(f, imap::types::Flag::Flagged));
                            if m.date == 0 {
                                m.date = f.internal_date().map(|d| d.timestamp()).unwrap_or(0)
                            }
                            messages.push(m);
                        }
                    }
                    let tx = c.transaction().map_err(db::err)?;
                    for m in messages {
                        db::save_message(&tx, &m)?;
                        total += 1;
                    }
                    tx.commit().map_err(db::err)?;
                    on_progress(SyncProgress {
                        loaded: total,
                        total: Some(known_total),
                    });
                }
                let tx = c.transaction().map_err(db::err)?;
                let mut stmt = tx
                    .prepare("SELECT id,data FROM messages WHERE account_id=?1 AND folder=?2")
                    .map_err(db::err)?;
                let old = stmt
                    .query_map(rusqlite::params![a.id, folder], |r| {
                        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
                    })
                    .map_err(db::err)?
                    .collect::<std::result::Result<Vec<_>, _>>()
                    .map_err(db::err)?;
                drop(stmt);
                for (id, data) in old {
                    if let Ok(m) = serde_json::from_str::<Message>(&data) {
                        if m.uid_validity != validity || !all.contains(&m.uid) {
                            db::remove_message(&tx, &id)?;
                        }
                    }
                }
                // Refresh flags for older cached messages without fetching their bodies again.
                if mb.exists > 0 {
                    let flags = s.uid_fetch("1:*", "(UID FLAGS)").map_err(imap_error)?;
                    for f in flags.iter() {
                        if let Some(uid) = f.uid {
                            let id = format!("{}:{}:{}:{}", a.id, folder, validity, uid);
                            if let Ok(mut m) = db::message(&tx, &id) {
                                m.read = f
                                    .flags()
                                    .iter()
                                    .any(|f| matches!(f, imap::types::Flag::Seen));
                                m.starred = f
                                    .flags()
                                    .iter()
                                    .any(|f| matches!(f, imap::types::Flag::Flagged));
                                db::save_message(&tx, &m)?;
                            }
                        }
                    }
                }
                tx.execute(
                    "INSERT OR REPLACE INTO folders VALUES(?1,?2,?3,?4)",
                    rusqlite::params![a.id, folder, kind, validity],
                )
                .map_err(db::err)?;
                tx.commit().map_err(db::err)?;
            }
            Ok(format!("Синхронизировано писем: {total}"))
        }
        Job::Action(path, id, action) => {
            let mut c = db::open(path)?;
            let mut m = db::message(&c, id)?;
            let mb = s.select(&m.folder).map_err(imap_error)?;
            if mb.uid_validity != Some(m.uid_validity) {
                return Err("Папка изменилась на сервере. Обновите почту".into());
            }
            let uid = m.uid.to_string();
            if action == "delete" {
                if m.kind == "trash" {
                    return Err(
                        "Письмо уже в корзине. Окончательное удаление выполняется в веб-почте"
                            .into(),
                    );
                }
                let fs = folders(s)?;
                let trash = fs
                    .iter()
                    .find(|(_, k)| k == "trash")
                    .map(|(n, _)| n.clone())
                    .unwrap_or("Trash".into());
                if !fs.iter().any(|(n, _)| n == &trash) {
                    s.create(&trash).map_err(imap_error)?;
                }
                let caps = s.capabilities().map_err(imap_error)?;
                if caps.has_str("MOVE") {
                    s.uid_mv(&uid, &trash).map_err(imap_error)?;
                } else {
                    s.uid_copy(&uid, &trash).map_err(imap_error)?;
                    s.uid_store(&uid, "+FLAGS.SILENT (\\Deleted)")
                        .map_err(imap_error)?;
                    if caps.has_str("UIDPLUS") {
                        s.uid_expunge(&uid).map_err(imap_error)?;
                    }
                }
                let tx = c.transaction().map_err(db::err)?;
                db::remove_message(&tx, id)?;
                tx.commit().map_err(db::err)?;
            } else {
                let flag = match action {
                    "read" => "+FLAGS.SILENT (\\Seen)",
                    "unread" => "-FLAGS.SILENT (\\Seen)",
                    "star" => "+FLAGS.SILENT (\\Flagged)",
                    "unstar" => "-FLAGS.SILENT (\\Flagged)",
                    _ => return Err("Неизвестное действие".into()),
                };
                s.uid_store(uid, flag).map_err(imap_error)?;
                match action {
                    "read" => m.read = true,
                    "unread" => m.read = false,
                    "star" => m.starred = true,
                    _ => m.starred = false,
                }
                let tx = c.transaction().map_err(db::err)?;
                db::save_message(&tx, &m)?;
                tx.commit().map_err(db::err)?;
            }
            Ok("Готово".into())
        }
        Job::Append(raw) => {
            let fs = folders(s)?;
            let sent = fs
                .iter()
                .find(|(_, k)| k == "sent")
                .map(|(n, _)| n.clone())
                .unwrap_or("Sent".into());
            if !fs.iter().any(|(n, _)| n == &sent) {
                s.create(&sent).map_err(imap_error)?;
            }
            s.append_with_flags(&sent, raw, &[imap::types::Flag::Seen])
                .map_err(imap_error)?;
            Ok("".into())
        }
    }
}
pub fn parse(
    raw: &[u8],
    a: &Account,
    folder: &str,
    kind: &str,
    uid: u32,
    validity: u32,
) -> Result<Message> {
    let p = mailparse::parse_mail(raw).map_err(|_| "Не удалось разобрать письмо")?;
    let h = |key| p.headers.get_first_value(key).unwrap_or_default();
    let from = h("From");
    let (name, email) = mailparse::addrparse(&from)
        .ok()
        .and_then(|list| list.extract_single_info())
        .map(|x| (x.display_name.unwrap_or_else(|| x.addr.clone()), x.addr))
        .unwrap_or((from.clone(), from));
    let mut m = Message {
        id: format!("{}:{}:{}:{}", a.id, folder, validity, uid),
        account_id: a.id.clone(),
        folder: folder.into(),
        kind: kind.into(),
        uid,
        uid_validity: validity,
        sender: name,
        sender_email: email,
        to: h("To"),
        cc: h("Cc"),
        reply_to: h("Reply-To"),
        subject: h("Subject"),
        text: String::new(),
        html: String::new(),
        date: mailparse::dateparse(&h("Date")).unwrap_or(0),
        read: false,
        starred: false,
        attachments: vec![],
        message_id: h("Message-ID"),
        references: h("References"),
    };
    walk(&p, &mut m)?;
    if m.text.is_empty() {
        m.text = html_text(&m.html);
    }
    Ok(m)
}
fn html_text(html: &str) -> String {
    let mut inside = false;
    html.chars()
        .filter_map(|c| match c {
            '<' => {
                inside = true;
                Some(' ')
            }
            '>' => {
                inside = false;
                None
            }
            _ if !inside => Some(c),
            _ => None,
        })
        .collect()
}
fn walk(p: &ParsedMail, m: &mut Message) -> Result<()> {
    let disposition = p.get_content_disposition();
    let filename = disposition
        .params
        .get("filename")
        .or_else(|| p.ctype.params.get("name"));
    if filename.is_some()
        || matches!(
            disposition.disposition,
            mailparse::DispositionType::Attachment
        )
    {
        let data = p
            .get_body_raw()
            .map_err(|_| "Не удалось прочитать вложение")?;
        m.attachments.push(Attachment {
            name: filename.cloned().unwrap_or("attachment.bin".into()),
            mime: p.ctype.mimetype.clone(),
            size: data.len(),
            data: STANDARD.encode(data),
        });
    } else if !p.subparts.is_empty() {
        for part in &p.subparts {
            walk(part, m)?;
        }
    } else if p.ctype.mimetype == "text/plain" {
        m.text.push_str(
            &p.get_body()
                .map_err(|_| "Не удалось прочитать текст письма")?,
        );
    } else if p.ctype.mimetype == "text/html" {
        m.html.push_str(
            &p.get_body()
                .map_err(|_| "Не удалось прочитать HTML письма")?,
        );
    }
    Ok(())
}
pub(super) fn smtp(a: &Account, p: &str) -> Result<SmtpTransport> {
    let b = match a.smtp.security {
        Security::Tls => SmtpTransport::relay(&a.smtp.host).map_err(|_| "SMTP: ошибка TLS")?,
        Security::Starttls => {
            SmtpTransport::starttls_relay(&a.smtp.host).map_err(|_| "SMTP: ошибка STARTTLS")?
        }
        Security::None => SmtpTransport::builder_dangerous(&a.smtp.host),
    };
    let login = if a.same_credentials {
        &a.imap.login
    } else {
        &a.smtp.login
    };
    let b = if matches!(a.auth, AuthMethod::Oauth { .. }) {
        b.authentication(vec![Mechanism::Xoauth2])
    } else {
        b
    };
    Ok(b.port(a.smtp.port)
        .timeout(Some(TIMEOUT))
        .credentials(Credentials::new(login.clone(), p.into()))
        .build())
}
pub fn test_smtp(a: &Account, p: &str) -> Result<()> {
    if smtp(a, p)?.test_connection().map_err(|e| {
        if e.is_permanent() {
            match &a.auth {
                AuthMethod::Oauth { provider } => crate::oauth::reauth_message(provider),
                AuthMethod::Password => {
                    "SMTP авторизация отклонена. Проверьте пароль приложения".into()
                }
            }
        } else {
            "Не удалось подключиться к SMTP. Проверьте сеть, сервер и TLS".into()
        }
    })? {
        Ok(())
    } else {
        Err("SMTP: сервер отклонил подключение".into())
    }
}
fn addresses(s: &str) -> Result<Vec<Mailbox>> {
    if s.trim().is_empty() {
        return Ok(vec![]);
    }
    let parsed = s
        .replace(';', ",")
        .parse::<lettre::message::Mailboxes>()
        .map_err(|_| "Некорректный адрес получателя")?;
    Ok(parsed.into_iter().collect())
}
pub(super) fn build_message(a: &Account, d: &Compose) -> Result<lettre::Message> {
    let recipients = addresses(&d.to)?;
    if recipients.is_empty() {
        return Err("Добавьте получателя".into());
    }
    if d.attachments.iter().map(|a| a.size).sum::<usize>() > 20 * 1024 * 1024 {
        return Err("Общий размер вложений превышает 20 МБ".into());
    }
    let mut builder = lettre::Message::builder()
        .from(Mailbox::new(
            Some(a.sender_name.clone()),
            a.email
                .parse()
                .map_err(|_| "Некорректный email отправителя")?,
        ))
        .subject(&d.subject);
    for r in recipients {
        builder = builder.to(r)
    }
    for r in addresses(&d.cc)? {
        builder = builder.cc(r)
    }
    if !d.in_reply_to.is_empty() {
        builder = builder.in_reply_to(d.in_reply_to.clone())
    }
    if !d.references.is_empty() {
        builder = builder.references(d.references.clone())
    }
    let mut parts = MultiPart::mixed().singlepart(SinglePart::plain(d.body.clone()));
    let mut decoded_size = 0usize;
    for item in &d.attachments {
        let bytes = STANDARD
            .decode(&item.data)
            .map_err(|_| "Повреждено вложение")?;
        decoded_size += bytes.len();
        if decoded_size > 20 * 1024 * 1024 {
            return Err("Общий размер вложений превышает 20 МБ".into());
        }
        parts = parts.singlepart(
            MailAttachment::new(item.name.clone()).body(
                bytes,
                item.mime
                    .parse()
                    .unwrap_or(ContentType::parse("application/octet-stream").unwrap()),
            ),
        )
    }
    let message = builder
        .multipart(parts)
        .map_err(|_| "Проверьте поля письма: не удалось сформировать сообщение")?;
    Ok(message)
}
pub fn send(a: &Account, d: &Compose) -> Result<String> {
    let message = build_message(a, d)?;
    let p = crate::oauth::credential(a, if a.same_credentials { "imap" } else { "smtp" })?;
    smtp(a,&p)?.send(&message).map_err(|_|"SMTP: отправка не подтверждена. Проверьте папку «Отправленные» перед повтором; затем сеть, пароль и получателей")?;
    // Providers such as Gmail already file SMTP messages in Sent.
    if a.smtp.host.to_lowercase() != "smtp.gmail.com" {
        let saved = crate::oauth::credential(a, "imap")
            .and_then(|p| run(a, &p, Job::Append(&message.formatted())));
        if saved.is_err() {
            return Ok("Письмо отправлено. Копию не удалось сохранить в «Отправленные»; не отправляйте письмо повторно.".into());
        }
    }
    Ok("Письмо отправлено".into())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn xoauth_payload() {
        use imap::Authenticator;
        let auth = Xoauth {
            login: "me@example.test",
            token: "synthetic-token",
        };
        assert_eq!(
            auth.process(b""),
            "user=me@example.test\x01auth=Bearer synthetic-token\x01\x01"
        );
        assert_eq!(auth.process(b"auth error"), "");
    }
    #[test]
    fn mapping() {
        assert_eq!(folder_kind("[Gmail]/Sent Mail", "Sent"), "sent");
        assert_eq!(folder_kind("INBOX", ""), "inbox");
        assert_eq!(folder_kind("Deleted Items", ""), "trash");
        assert_eq!(folder_kind("Projects", ""), "other");
    }
    #[test]
    fn mime_parsing() {
        let p=mailparse::parse_mail(b"Content-Type: multipart/mixed; boundary=x\r\n\r\n--x\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nHello\r\n--x\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename=test.txt\r\nContent-Transfer-Encoding: base64\r\n\r\naGk=\r\n--x--").unwrap();
        assert_eq!(p.subparts.len(), 2);
        assert_eq!(p.subparts[0].get_body().unwrap(), "Hello");
        assert_eq!(p.subparts[1].get_body_raw().unwrap(), b"hi");
        assert!(addresses("bad address").is_err());
        assert_eq!(
            addresses("one@example.org; two@example.org").unwrap().len(),
            2
        );
    }
}
