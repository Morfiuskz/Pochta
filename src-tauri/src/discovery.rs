use crate::model::*;
use serde::Serialize;
use std::io::Read;
use std::time::Duration;
#[derive(Serialize)]
pub struct Discovered {
    imap: Server,
    smtp: Server,
    name: String,
}
pub fn discover(email: &str) -> Option<Discovered> {
    let address = email.parse::<lettre::Address>().ok()?;
    let domain = address.domain();
    if !domain.contains('.')
        || !domain
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'.' || c == b'-')
    {
        return None;
    }
    // Only the public ISPDB receives the domain, never the address or credentials.
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .ok()?;
    let response = client
        .get(format!("https://autoconfig.thunderbird.net/v1.1/{domain}"))
        .send()
        .ok()?
        .error_for_status()
        .ok()?;
    let mut xml = String::new();
    response.take(131073).read_to_string(&mut xml).ok()?;
    if xml.len() > 131072 {
        return None;
    }
    parse(&xml, email)
}
fn parse(xml: &str, email: &str) -> Option<Discovered> {
    let doc = roxmltree::Document::parse(xml).ok()?;
    let server = |tag: &str, kind: &str| -> Option<Server> {
        doc.descendants()
            .filter(|n| n.has_tag_name(tag) && n.attribute("type") == Some(kind))
            .find_map(|n| {
                let field = |name| {
                    n.children()
                        .find(|c| c.has_tag_name(name))
                        .and_then(|c| c.text())
                };
                if !n.children().any(|c| {
                    c.has_tag_name("authentication")
                        && matches!(c.text(), Some("password-cleartext"))
                }) {
                    return None;
                }
                let security = match field("socketType")? {
                    "SSL" => Security::Tls,
                    "STARTTLS" => Security::Starttls,
                    _ => return None,
                };
                let host = field("hostname")?.to_string();
                if !host.contains('.')
                    || !host
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-')
                {
                    return None;
                }
                let login = field("username")?
                    .replace("%EMAILADDRESS%", email)
                    .replace("%EMAILLOCALPART%", email.split('@').next()?)
                    .replace("%EMAILDOMAIN%", email.split('@').nth(1)?);
                if login.contains('%') {
                    return None;
                }
                let port: u16 = field("port")?.parse().ok()?;
                if port == 0 {
                    return None;
                }
                Some(Server {
                    host,
                    port,
                    login,
                    security,
                })
            })
    };
    Some(Discovered {
        imap: server("incomingServer", "imap")?,
        smtp: server("outgoingServer", "smtp")?,
        name: doc
            .descendants()
            .find(|n| n.has_tag_name("displayName"))
            .and_then(|n| n.text())
            .unwrap_or("Почтовый провайдер")
            .to_string(),
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn discovery_and_fallback() {
        let xml = r#"<clientConfig><emailProvider><displayName>Test</displayName><incomingServer type="imap"><hostname>imap.test.org</hostname><port>993</port><socketType>SSL</socketType><username>%EMAILADDRESS%</username><authentication>password-cleartext</authentication></incomingServer><outgoingServer type="smtp"><hostname>smtp.test.org</hostname><port>587</port><socketType>STARTTLS</socketType><username>%EMAILLOCALPART%</username><authentication>password-cleartext</authentication></outgoingServer></emailProvider></clientConfig>"#;
        let a = parse(xml, "me@test.org").unwrap();
        assert_eq!(a.imap.login, "me@test.org");
        assert_eq!(a.smtp.login, "me");
        assert!(parse(&xml.replace("STARTTLS", "plain"), "me@test.org").is_none());
        assert!(parse(&xml.replace("password-cleartext", "OAuth2"), "me@test.org").is_none());
        assert!(parse("broken", "me@test.org").is_none());
    }
}
