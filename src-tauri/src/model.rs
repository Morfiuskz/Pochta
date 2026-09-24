use serde::{Deserialize, Serialize};
pub type Result<T> = std::result::Result<T, String>;
#[derive(Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Security {
    Tls,
    Starttls,
    None,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Server {
    pub host: String,
    pub port: u16,
    pub login: String,
    pub security: Security,
}
#[derive(Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(tag = "method", rename_all = "lowercase")]
pub enum AuthMethod {
    #[default]
    Password,
    Oauth {
        provider: String,
    },
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    #[serde(default)]
    pub auth: AuthMethod,
    pub id: String,
    pub name: String,
    pub sender_name: String,
    pub email: String,
    pub imap: Server,
    pub smtp: Server,
    pub same_credentials: bool,
    pub is_default: bool,
    pub enabled: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountInput {
    pub account: Account,
    pub password: String,
    pub smtp_password: String,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Attachment {
    pub name: String,
    pub mime: String,
    pub size: usize,
    pub data: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: String,
    pub account_id: String,
    pub folder: String,
    pub kind: String,
    pub uid: u32,
    pub uid_validity: u32,
    pub sender: String,
    pub sender_email: String,
    pub to: String,
    pub cc: String,
    pub reply_to: String,
    pub subject: String,
    pub text: String,
    pub html: String,
    pub date: i64,
    pub read: bool,
    pub starred: bool,
    pub attachments: Vec<Attachment>,
    pub message_id: String,
    pub references: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub id: String,
    pub account_id: String,
    pub kind: String,
    pub sender: String,
    pub sender_email: String,
    pub subject: String,
    pub snippet: String,
    pub date: i64,
    pub read: bool,
    pub starred: bool,
    pub has_attachments: bool,
}
impl From<Message> for Summary {
    fn from(m: Message) -> Self {
        Self {
            id: m.id,
            account_id: m.account_id,
            kind: m.kind,
            sender: m.sender,
            sender_email: m.sender_email,
            subject: m.subject,
            snippet: m
                .text
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
                .chars()
                .take(160)
                .collect(),
            date: m.date,
            read: m.read,
            starred: m.starred,
            has_attachments: !m.attachments.is_empty(),
        }
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Compose {
    pub id: String,
    pub account_id: String,
    pub to: String,
    pub cc: String,
    pub subject: String,
    pub body: String,
    pub attachments: Vec<Attachment>,
    pub in_reply_to: String,
    pub references: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Query {
    pub account_id: String,
    pub folder: String,
    pub filter: String,
    pub search: String,
}
pub fn validate(a: &Account) -> Result<()> {
    if let AuthMethod::Oauth { provider } = &a.auth {
        crate::oauth::validate_account(a, provider)?;
    }
    a.email
        .parse::<lettre::Address>()
        .map_err(|_| "Укажите корректный email".to_string())?;
    if a.sender_name.contains(['\r', '\n']) {
        return Err("Некорректное имя отправителя".into());
    }
    for s in [&a.imap, &a.smtp] {
        if s.host.trim().is_empty()
            || s.host.contains(['/', '\r', '\n', ' ', ':'])
            || s.port == 0
            || s.login.trim().is_empty()
        {
            return Err("Проверьте сервер, порт и логин IMAP/SMTP".into());
        }
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn config_and_validation() {
        let mut a:Account=serde_json::from_str(r#"{"id":"1","name":"","senderName":"Me","email":"me@example.org","imap":{"host":"imap.example.org","port":993,"login":"me","security":"tls"},"smtp":{"host":"smtp.example.org","port":587,"login":"me","security":"starttls"},"sameCredentials":true,"isDefault":true,"enabled":true}"#).unwrap();
        assert!(matches!(a.auth, AuthMethod::Password));
        assert!(validate(&a).is_ok());
        a.auth = AuthMethod::Oauth {
            provider: "yandex".into(),
        };
        assert!(validate(&a).is_err()); // OAuth cannot send tokens to manual hosts.
        a.auth = AuthMethod::Password;
        a.email = "invalid".into();
        assert!(validate(&a).is_err());
        a.email = "me@example.org".into();
        a.imap.port = 0;
        assert!(validate(&a).is_err());
    }
}
