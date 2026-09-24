use crate::model::*;
use rusqlite::{params, Connection};
use std::path::Path;
pub fn err(_: rusqlite::Error) -> String {
    "Не удалось прочитать или сохранить локальный кэш".into()
}
pub fn open(path: &Path) -> Result<Connection> {
    let c = Connection::open(path).map_err(err)?;
    c.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY, data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS folders(account_id TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, validity INTEGER NOT NULL, PRIMARY KEY(account_id,name));
 CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY, account_id TEXT NOT NULL, folder TEXT NOT NULL, kind TEXT NOT NULL, date INTEGER NOT NULL, unread INTEGER NOT NULL, starred INTEGER NOT NULL, attachments INTEGER NOT NULL, search TEXT NOT NULL, data TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS messages_view ON messages(account_id,kind,date DESC);
 CREATE VIRTUAL TABLE IF NOT EXISTS message_search USING fts5(id UNINDEXED, text, tokenize='unicode61');
 CREATE TABLE IF NOT EXISTS drafts(id TEXT PRIMARY KEY, data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS ui(key TEXT PRIMARY KEY, data TEXT NOT NULL);").map_err(err)?;
    Ok(c)
}
pub fn accounts(c: &Connection) -> Result<Vec<Account>> {
    let mut q = c
        .prepare("SELECT data FROM accounts ORDER BY rowid")
        .map_err(err)?;
    let rows = q.query_map([], |r| r.get::<_, String>(0)).map_err(err)?;
    rows.map(|r| {
        serde_json::from_str(&r.map_err(err)?).map_err(|_| "Повреждены данные аккаунта".into())
    })
    .collect()
}
pub fn account(c: &Connection, id: &str) -> Result<Account> {
    accounts(c)?
        .into_iter()
        .find(|a| a.id == id)
        .ok_or("Аккаунт не найден".into())
}
pub fn save_account(c: &mut Connection, a: &Account) -> Result<()> {
    let tx = c.transaction().map_err(err)?;
    if a.is_default {
        for mut other in accounts(&tx)? {
            if other.id != a.id {
                other.is_default = false;
                tx.execute(
                    "UPDATE accounts SET data=?1 WHERE id=?2",
                    params![serde_json::to_string(&other).unwrap(), other.id],
                )
                .map_err(err)?;
            }
        }
    }
    tx.execute(
        "INSERT INTO accounts(id,data) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
        params![a.id, serde_json::to_string(a).unwrap()],
    )
    .map_err(err)?;
    tx.commit().map_err(err)?;
    Ok(())
}
pub fn save_message(c: &Connection, m: &Message) -> Result<()> {
    let search = format!(
        "{} {} {} {} {} {}",
        m.sender, m.sender_email, m.to, m.cc, m.subject, m.text
    );
    c.execute(
        "INSERT OR REPLACE INTO messages VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
        params![
            m.id,
            m.account_id,
            m.folder,
            m.kind,
            m.date,
            !m.read,
            m.starred,
            !m.attachments.is_empty(),
            search,
            serde_json::to_string(m).unwrap()
        ],
    )
    .map_err(err)?;
    c.execute("DELETE FROM message_search WHERE id=?1", [&m.id])
        .map_err(err)?;
    c.execute(
        "INSERT INTO message_search(id,text) VALUES(?1,?2)",
        params![m.id, search],
    )
    .map_err(err)?;
    Ok(())
}
pub fn message(c: &Connection, id: &str) -> Result<Message> {
    let s: String = c
        .query_row("SELECT data FROM messages WHERE id=?1", [id], |r| r.get(0))
        .map_err(err)?;
    serde_json::from_str(&s).map_err(|_| "Письмо повреждено".into())
}
pub fn remove_message(c: &Connection, id: &str) -> Result<()> {
    c.execute("DELETE FROM messages WHERE id=?1", [id])
        .map_err(err)?;
    c.execute("DELETE FROM message_search WHERE id=?1", [id])
        .map_err(err)?;
    Ok(())
}
pub fn list(c: &Connection, q: Query) -> Result<Vec<Summary>> {
    let fts = q
        .search
        .split_whitespace()
        .filter(|s| !s.is_empty())
        .map(|s| format!("\"{}\"*", s.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" AND ");
    let mut stmt=c.prepare("SELECT m.data FROM messages m JOIN accounts a ON m.account_id=a.id WHERE json_extract(a.data,'$.enabled')=1 AND (?1='' OR m.account_id=?1) AND (?4!='' OR (?2='all' AND m.kind='inbox') OR (?2='starred' AND m.starred=1) OR m.kind=?2) AND (?3!='unread' OR m.unread=1) AND (?3!='attachments' OR m.attachments=1) AND (?4='' OR m.id IN (SELECT id FROM message_search WHERE message_search MATCH ?5)) ORDER BY m.date DESC LIMIT 1000").map_err(err)?;
    let rows = stmt
        .query_map(
            params![
                q.account_id,
                q.folder,
                q.filter,
                q.search,
                if fts.is_empty() { "\"\"" } else { &fts }
            ],
            |r| r.get::<_, String>(0),
        )
        .map_err(err)?;
    rows.map(|r| {
        serde_json::from_str::<Message>(&r.map_err(err)?)
            .map(Summary::from)
            .map_err(|_| "Письмо повреждено".into())
    })
    .collect()
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn persistence_search_and_unicode() {
        let mut c = open(Path::new(":memory:")).unwrap();
        let a = Account {
            auth: AuthMethod::Password,
            id: "a".into(),
            name: "Work".into(),
            sender_name: "".into(),
            email: "me@example.org".into(),
            imap: Server {
                host: "imap.example.org".into(),
                port: 993,
                login: "me".into(),
                security: Security::Tls,
            },
            smtp: Server {
                host: "smtp.example.org".into(),
                port: 587,
                login: "me".into(),
                security: Security::Starttls,
            },
            same_credentials: true,
            is_default: true,
            enabled: true,
        };
        save_account(&mut c, &a).unwrap();
        let mut second = a.clone();
        second.id = "b".into();
        save_account(&mut c, &second).unwrap();
        let mut renamed = a.clone();
        renamed.name = "Renamed".into();
        save_account(&mut c, &renamed).unwrap();
        let saved = accounts(&c).unwrap();
        assert_eq!(
            saved.iter().map(|a| a.id.as_str()).collect::<Vec<_>>(),
            vec!["a", "b"]
        );
        assert_eq!(saved.iter().filter(|a| a.is_default).count(), 1);
        assert_eq!(saved[0].email, a.email);
        assert_eq!(saved[0].imap.login, a.imap.login);

        let m = Message {
            id: "m".into(),
            account_id: "a".into(),
            folder: "INBOX".into(),
            kind: "inbox".into(),
            uid: 1,
            uid_validity: 1,
            sender: "Иван".into(),
            sender_email: "ivan@example.org".into(),
            to: a.email,
            cc: "".into(),
            reply_to: "".into(),
            subject: "Договор проекта".into(),
            text: "Проверка поиска".into(),
            html: "".into(),
            date: 1,
            read: false,
            starred: false,
            attachments: vec![],
            message_id: "".into(),
            references: "".into(),
        };
        save_message(&c, &m).unwrap();
        let query = |s: &str| Query {
            account_id: "".into(),
            folder: "all".into(),
            filter: "all".into(),
            search: s.into(),
        };
        assert_eq!(list(&c, query("догов")).unwrap().len(), 1);
        assert_eq!(list(&c, query("missing")).unwrap().len(), 0);
        assert_eq!(list(&c, query("")).unwrap().len(), 1);
        assert!(list(&c, query("\" OR *")).is_ok());
        assert_eq!(message(&c, "m").unwrap().subject, "Договор проекта");
        remove_message(&c, "m").unwrap();
        assert!(list(&c, query("")).unwrap().is_empty());
    }
}
