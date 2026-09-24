//! OAuth secrets never cross IPC or enter account JSON. Mail's confidential-client
//! exchange is delegated to an owner-operated HTTPS broker; no embedded secrets.
use crate::{model::*, secrets};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use reqwest::{blocking::Client, Url};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    io::{Read, Write},
    net::TcpListener,
    path::PathBuf,
    sync::OnceLock,
    time::{Duration, Instant},
};
static CONFIG_PATH: OnceLock<PathBuf> = OnceLock::new();
pub fn init(path: PathBuf) {
    let _ = CONFIG_PATH.set(path);
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Config {
    client_id: String,
    redirect_uri: String,
    #[serde(default)]
    broker_url: Option<String>,
}
#[derive(Serialize)]
pub struct Availability {
    pub ready: bool,
    pub message: String,
}
fn config(provider: &str) -> Result<Config> {
    if !matches!(provider, "yandex" | "google" | "mail") {
        return Err("OAuth этого провайдера пока не реализован".into());
    }
    let configs: HashMap<String, Config> = CONFIG_PATH
        .get()
        .and_then(|p| std::fs::read(p).ok())
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default();
    let c = configs.get(provider).cloned().ok_or("Вход через провайдера ещё не настроен владельцем приложения. Используйте пароль приложения или настройте oauth.json по инструкции в docs/OAUTH.md.")?;
    if c.client_id.trim().is_empty() {
        return Err("Не задан OAuth Client ID. См. docs/OAUTH.md".into());
    }
    let u = Url::parse(&c.redirect_uri).map_err(|_| "Некорректный OAuth Redirect URI")?;
    if u.scheme() != "http"
        || u.host_str() != Some("127.0.0.1")
        || u.port().is_none()
        || u.path() != "/oauth/callback"
        || u.query().is_some()
        || u.fragment().is_some()
        || !u.username().is_empty()
        || u.password().is_some()
    {
        return Err(
            "OAuth Redirect URI должен иметь вид http://127.0.0.1:PORT/oauth/callback".into(),
        );
    }
    if provider == "google" && c.broker_url.is_some() {
        return Err("Google OAuth использует только официальный token endpoint".into());
    }
    if let Some(broker) = &c.broker_url {
        https(broker)?;
    }
    let expected_redirect = match provider {
        "yandex" => Some("http://127.0.0.1:43821/oauth/callback"),
        "google" => Some("http://127.0.0.1:43823/oauth/callback"),
        _ => None,
    };
    if let Some(expected) = expected_redirect {
        if c.redirect_uri != expected {
            return Err(format!(
                "Для {provider} используйте Redirect URI {expected}"
            ));
        }
    }
    if provider == "mail" {
        https(c.broker_url.as_deref().ok_or("Для Mail требуется HTTPS-сервис обмена токенов владельца приложения. См. docs/OAUTH.md")?)?;
    }
    Ok(c)
}
pub fn availability(provider: &str) -> Availability {
    match config(provider) {
        Ok(_) => Availability {
            ready: true,
            message:
                "Вход откроется в системном браузере. Основной пароль вводится только у провайдера."
                    .into(),
        },
        Err(message) => Availability {
            ready: false,
            message,
        },
    }
}
fn https(raw: &str) -> Result<Url> {
    let u = Url::parse(raw).map_err(|_| "Некорректный адрес OAuth")?;
    if u.scheme() != "https"
        || u.host_str().is_none()
        || !u.username().is_empty()
        || u.password().is_some()
        || u.fragment().is_some()
    {
        return Err("OAuth требует HTTPS".into());
    }
    Ok(u)
}
fn client() -> Result<Client> {
    Client::builder()
        .timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "Не удалось подготовить OAuth-соединение".into())
}
#[derive(Deserialize)]
struct Endpoints {
    authorization_endpoint: String,
    token_endpoint: String,
}
fn endpoints(provider: &str) -> Result<Endpoints> {
    if provider == "yandex" {
        return Ok(Endpoints {
            authorization_endpoint: "https://oauth.yandex.ru/authorize".into(),
            token_endpoint: "https://oauth.yandex.ru/token".into(),
        });
    }
    if provider == "google" {
        return Ok(Endpoints {
            authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth".into(),
            token_endpoint: "https://oauth2.googleapis.com/token".into(),
        });
    }
    let e: Endpoints = client()?
        .get("https://account.mail.ru/.well-known/openid-configuration")
        .send()
        .and_then(|r| r.error_for_status())
        .and_then(|r| r.json())
        .map_err(|_| "Не удалось получить настройки OAuth Mail. Проверьте сеть")?;
    for raw in [&e.authorization_endpoint, &e.token_endpoint] {
        let u = https(raw)?;
        if !matches!(u.host_str(), Some("oauth.mail.ru" | "account.mail.ru")) {
            return Err("Адрес OAuth Mail изменился. Требуется обновление приложения".into());
        }
    }
    Ok(e)
}
#[derive(Serialize, Deserialize)]
pub struct Token {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    expires_at: i64,
    provider: String,
    email: String,
    client_id: String,
}
#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    expires_in: u64,
}
fn exchange(provider: &str, c: &Config, fields: &[(&str, &str)], email: &str) -> Result<Token> {
    let e = endpoints(provider)?;
    let url = c.broker_url.as_deref().unwrap_or(&e.token_endpoint);
    let t: TokenResponse = client()?.post(url).form(fields).send().and_then(|r| r.error_for_status()).and_then(|r| r.json()).map_err(|_| "Провайдер не выдал OAuth-токен. Проверьте регистрацию приложения и права доступа; повторите вход.")?;
    if t.access_token.is_empty()
        || t.access_token.len() > 16384
        || t.access_token.chars().any(char::is_control)
        || t.refresh_token.as_ref().is_some_and(|refresh| {
            refresh.is_empty()
                || refresh.len() > 16384
                || refresh.chars().any(char::is_control)
        })
        || t.expires_in == 0
    {
        return Err("Провайдер вернул некорректный OAuth-токен".into());
    }
    Ok(Token {
        access_token: t.access_token,
        refresh_token: t.refresh_token,
        expires_at: chrono::Utc::now()
            .timestamp()
            .saturating_add(t.expires_in.min(i64::MAX as u64) as i64),
        provider: provider.into(),
        email: email.into(),
        client_id: c.client_id.clone(),
    })
}
fn random() -> String {
    format!(
        "{}{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}
fn callback_url(target: &str) -> Result<Url> {
    let u = if target.starts_with('/') {
        Url::parse("http://127.0.0.1")
            .and_then(|base| base.join(target))
            .map_err(|_| "Некорректный OAuth ответ")?
    } else {
        Url::parse(target).map_err(|_| "Некорректный OAuth ответ")?
    };
    if u.path() != "/oauth/callback" {
        return Err("Некорректный OAuth callback".into());
    }
    Ok(u)
}
fn callback_code(target: &str, state: &str) -> Result<String> {
    let u = callback_url(target)?;
    let values: Vec<_> = u.query_pairs().collect();
    let one = |key: &str| {
        let v: Vec<_> = values.iter().filter(|(k, _)| k == key).collect();
        if v.len() == 1 {
            Some(v[0].1.to_string())
        } else {
            None
        }
    };
    if one("state").as_deref() != Some(state) {
        return Err("OAuth: ответ не относится к текущему входу".into());
    }
    if let Some(error) = one("error") {
        let description = one("error_description").unwrap_or(error);
        let description: String = description
            .chars()
            .filter(|c| !c.is_control())
            .take(300)
            .collect();
        return Err(format!("OAuth: {description}"));
    }
    one("code")
        .filter(|s| !s.is_empty())
        .ok_or("OAuth: код авторизации отсутствует".into())
}
pub fn authorize(provider: &str, email: &str) -> Result<Token> {
    let c = config(provider)?;
    let redirect = Url::parse(&c.redirect_uri).map_err(|_| "Ошибка Redirect URI")?;
    let listener = TcpListener::bind(("127.0.0.1", redirect.port().unwrap()))
        .map_err(|_| "Порт OAuth занят. Закройте другое окно входа и повторите")?;
    listener
        .set_nonblocking(true)
        .map_err(|_| "Не удалось запустить OAuth callback")?;
    let state = random();
    let verifier = random();
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let e = endpoints(provider)?;
    let mut url = https(&e.authorization_endpoint)?;
    url.query_pairs_mut().extend_pairs([
        ("response_type", "code"),
        ("client_id", &c.client_id),
        ("redirect_uri", &c.redirect_uri),
        ("state", &state),
        ("code_challenge", &challenge),
        ("code_challenge_method", "S256"),
        (
            "scope",
            match provider {
                "yandex" => "login:email mail:imap_full mail:smtp",
                "google" => "https://mail.google.com/",
                _ => "openid mail.imap offline_access",
            },
        ),
    ]);
    if provider == "yandex" {
        url.query_pairs_mut()
            .append_pair("login_hint", email)
            .append_pair("force_confirm", "yes");
    } else if provider == "google" {
        url.query_pairs_mut()
            .append_pair("login_hint", email)
            .append_pair("access_type", "offline")
            .append_pair("prompt", "consent");
    } else {
        url.query_pairs_mut().append_pair("prompt", "consent");
    }
    webbrowser::open(url.as_str()).map_err(|_| "Не удалось открыть системный браузер")?;
    let deadline = Instant::now() + Duration::from_secs(180);
    while Instant::now() < deadline {
        let (mut stream, _) = match listener.accept() {
            Ok(s) => s,
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(100));
                continue;
            }
            Err(_) => return Err("Ошибка локального OAuth callback".into()),
        };
        let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
        let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
        let mut buf = Vec::new();
        let mut byte = [0u8; 1];
        while buf.len() < 8192 && Instant::now() < deadline {
            if stream.read(&mut byte).unwrap_or(0) != 1 {
                break;
            }
            buf.push(byte[0]);
            if buf.ends_with(b"\r\n\r\n") {
                break;
            }
        }
        let request = String::from_utf8_lossy(&buf);
        let mut parts = request.lines().next().unwrap_or("").split_whitespace();
        let method = parts.next();
        let target = parts.next().unwrap_or("");
        if method != Some("GET") || callback_url(target).is_err() {
            let _ = stream.write_all(
                b"HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
            );
            continue;
        }
        let code = callback_code(target, &state);
        let body = match &code {
            Ok(_) => "Вход подтверждён. Вернитесь в приложение «Почта».".to_string(),
            Err(error) => format!("Вход не выполнен: {error}. Вернитесь в приложение «Почта»."),
        };
        let response = format!("HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{body}", body.len());
        let _ = stream.write_all(response.as_bytes());
        let code = code?;
        return exchange(
            provider,
            &c,
            &[
                ("grant_type", "authorization_code"),
                ("client_id", &c.client_id),
                ("redirect_uri", &c.redirect_uri),
                ("code", &code),
                ("code_verifier", &verifier),
            ],
            email,
        );
    }
    Err("Время входа истекло. Повторите попытку (ожидание — 3 минуты)".into())
}
pub fn encode(t: &Token) -> Result<String> {
    serde_json::to_string(t).map_err(|_| "Не удалось сохранить OAuth-токен".into())
}
pub fn access(t: &Token) -> &str {
    &t.access_token
}
pub fn credential(a: &Account, kind: &str) -> Result<String> {
    let AuthMethod::Oauth { provider } = &a.auth else {
        return secrets::get(&a.id, kind);
    };
    validate_account(a, provider)?;
    let mut t: Token = serde_json::from_str(&secrets::get(&a.id, "oauth")?)
        .map_err(|_| "Повторите вход через провайдера")?;
    if t.provider != *provider || t.email != a.email {
        return Err("Аккаунт изменился. Повторите OAuth-вход".into());
    }
    if t.expires_at <= chrono::Utc::now().timestamp() + 60 {
        let c = config(provider)?;
        if c.client_id != t.client_id {
            return Err("OAuth-приложение изменилось. Повторите вход".into());
        }
        if provider == "yandex" && c.broker_url.is_none() {
            return Err(reauth_message(provider));
        }
        let refresh = t
            .refresh_token
            .as_deref()
            .ok_or_else(|| reauth_message(provider))?;
        let mut next = exchange(
            provider,
            &c,
            &[
                ("grant_type", "refresh_token"),
                ("client_id", &c.client_id),
                ("refresh_token", refresh),
            ],
            &a.email,
        )
        .map_err(|_| reauth_message(provider))?;
        if next.refresh_token.is_none() {
            next.refresh_token = t.refresh_token.take();
        }
        secrets::set(&a.id, "oauth", &encode(&next)?)?;
        t = next;
    }
    Ok(t.access_token)
}
pub fn validate_account(a: &Account, provider: &str) -> Result<()> {
    let (imap, smtp) = match provider {
        "yandex" => ("imap.yandex.com", "smtp.yandex.com"),
        "google" => ("imap.gmail.com", "smtp.gmail.com"),
        "mail" => ("imap.mail.ru", "smtp.mail.ru"),
        _ => return Err("OAuth этого провайдера пока недоступен".into()),
    };
    if a.imap.host != imap
        || a.smtp.host != smtp
        || a.imap.port != 993
        || a.smtp.port != 465
        || a.imap.security != Security::Tls
        || a.smtp.security != Security::Tls
        || !a.same_credentials
        || a.imap.login != a.email
        || a.smtp.login != a.email
    {
        return Err("Для OAuth используйте настройки выбранного провайдера. Изменение серверов требует нового подключения".into());
    }
    Ok(())
}
pub fn reauth_message(provider: &str) -> String {
    match provider {
        "google" => "Требуется повторный вход в Google".into(),
        "yandex" => "Войдите в Яндекс снова".into(),
        _ => "Требуется повторный вход через провайдера".into(),
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn callback_state_and_pkce() {
        assert_eq!(
            callback_code("/oauth/callback?state=abc&code=123", "abc").unwrap(),
            "123"
        );
        assert!(callback_code("/oauth/callback?state=bad&code=123", "abc").is_err());
        assert!(callback_code("/oauth/callback?state=abc&state=abc&code=123", "abc").is_err());
        assert!(callback_code("/oauth/callback?state=abc&error=access_denied", "abc").is_err());
        assert_eq!(
            URL_SAFE_NO_PAD.encode(Sha256::digest(
                b"dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
            )),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }
    #[test]
    fn google_callback_accepts_issuer_and_absolute_target() {
        assert_eq!(
            callback_code(
                "http://127.0.0.1:43823/oauth/callback?state=abc&iss=https%3A%2F%2Faccounts.google.com&code=google-code",
                "abc"
            )
            .unwrap(),
            "google-code"
        );
    }
}
