mod db;
mod mail;
mod model;
mod secrets;
use model::*;
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tauri::Manager;
#[derive(Clone)]
struct State {
    path: PathBuf,
    operations: Arc<Mutex<()>>,
}
async fn work<T: Send + 'static>(
    state: State,
    f: impl FnOnce(&PathBuf) -> Result<T> + Send + 'static,
) -> Result<T> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = state
            .operations
            .lock()
            .map_err(|_| "Перезапустите приложение")?;
        f(&state.path)
    })
    .await
    .map_err(|_| "Операция прервана. Повторите попытку".to_string())?
}
#[tauri::command]
fn list_accounts(state: tauri::State<State>) -> Result<Vec<Account>> {
    db::accounts(&db::open(&state.path)?)
}
#[tauri::command]
fn list_messages(state: tauri::State<State>, query: Query) -> Result<Vec<Summary>> {
    db::list(&db::open(&state.path)?, query)
}
#[tauri::command]
fn get_message(state: tauri::State<State>, id: String) -> Result<Message> {
    db::message(&db::open(&state.path)?, &id)
}
#[tauri::command]
async fn save_account(state: tauri::State<'_, State>, input: AccountInput) -> Result<Account> {
    work(state.inner().clone(), move |path| {
        let mut a = input.account;
        validate(&a)?;
        let mut c = db::open(path)?;
        let existing = if a.id.is_empty() {
            None
        } else {
            Some(db::account(&c, &a.id)?)
        };
        if a.id.is_empty() {
            a.id = uuid::Uuid::new_v4().to_string();
        }
        if a.name.trim().is_empty() {
            a.name = a.email.clone()
        }
        if db::accounts(&c)?.is_empty() {
            a.is_default = true
        }
        if a.same_credentials {
            a.smtp.login = a.imap.login.clone()
        }
        let old_imap = secrets::get(&a.id, "imap").ok();
        let old_smtp = secrets::get(&a.id, "smtp").ok();
        if input.password.is_empty() && old_imap.is_none() {
            return Err("Введите пароль IMAP / пароль приложения".into());
        }
        if !a.same_credentials && input.smtp_password.is_empty() && old_smtp.is_none() {
            return Err("Введите пароль SMTP".into());
        }
        let result = (|| {
            if !input.password.is_empty() {
                secrets::set(&a.id, "imap", &input.password)?;
            }
            if !a.same_credentials && !input.smtp_password.is_empty() {
                secrets::set(&a.id, "smtp", &input.smtp_password)?;
            }
            db::save_account(&mut c, &a)
        })();
        if let Err(e) = result {
            for (kind, old) in [("imap", old_imap), ("smtp", old_smtp)] {
                if let Some(p) = old {
                    let _ = secrets::set(&a.id, kind, &p);
                } else {
                    let _ = secrets::delete(&a.id, kind);
                }
            }
            return Err(e);
        }
        if let Some(old) = existing {
            if old.email != a.email
                || old.imap.host != a.imap.host
                || old.imap.login != a.imap.login
                || old.imap.port != a.imap.port
            {
                clear_cache(&mut c, &a.id)?;
            }
        }
        Ok(a)
    })
    .await
}
fn clear_cache(c: &mut rusqlite::Connection, id: &str) -> Result<()> {
    let tx = c.transaction().map_err(db::err)?;
    tx.execute(
        "DELETE FROM message_search WHERE id IN (SELECT id FROM messages WHERE account_id=?1)",
        [id],
    )
    .map_err(db::err)?;
    tx.execute("DELETE FROM messages WHERE account_id=?1", [id])
        .map_err(db::err)?;
    tx.execute("DELETE FROM folders WHERE account_id=?1", [id])
        .map_err(db::err)?;
    tx.commit().map_err(db::err)?;
    Ok(())
}
#[tauri::command]
async fn account_action(
    state: tauri::State<'_, State>,
    id: String,
    action: String,
    value: Option<String>,
) -> Result<()> {
    work(state.inner().clone(), move |path| {
        let mut c = db::open(path)?;
        let mut a = db::account(&c, &id)?;
        match action.as_str() {
            "rename" => {
                a.name = value.unwrap_or_default().trim().to_string();
                if a.name.is_empty() {
                    a.name = a.email.clone();
                }
            }
            "default" => {
                if !a.enabled {
                    return Err("Сначала включите аккаунт".into());
                }
                a.is_default = true
            }
            "toggle" => {
                a.enabled = !a.enabled;
                if !a.enabled {
                    a.is_default = false
                }
            }
            "delete" => {
                secrets::delete(&id, "imap")?;
                secrets::delete(&id, "smtp")?;
                clear_cache(&mut c, &id)?;
                c.execute(
                    "DELETE FROM drafts WHERE json_extract(data,'$.accountId')=?1",
                    [&id],
                )
                .map_err(db::err)?;
                c.execute("DELETE FROM accounts WHERE id=?1", [&id])
                    .map_err(db::err)?;
                return Ok(());
            }
            _ => return Err("Неизвестное действие".into()),
        }
        db::save_account(&mut c, &a)
    })
    .await
}
#[tauri::command]
async fn test_connection(state: tauri::State<'_, State>, input: AccountInput) -> Result<String> {
    work(state.inner().clone(), move |_| {
        let a = input.account;
        validate(&a)?;
        let p = if input.password.is_empty() {
            secrets::get(&a.id, "imap")?
        } else {
            input.password
        };
        mail::run(&a, &p, mail::Job::Test)?;
        let sp = if a.same_credentials {
            p
        } else if !input.smtp_password.is_empty() {
            input.smtp_password
        } else {
            secrets::get(&a.id, "smtp")?
        };
        mail::test_smtp(&a, &sp)?;
        Ok("IMAP и SMTP: подключение успешно".into())
    })
    .await
}
#[tauri::command]
async fn sync_account(state: tauri::State<'_, State>, id: String) -> Result<String> {
    work(state.inner().clone(), move |path| {
        let a = db::account(&db::open(path)?, &id)?;
        if !a.enabled {
            return Err("Аккаунт отключён".into());
        }
        mail::run(&a, &secrets::get(&id, "imap")?, mail::Job::Sync(path))
    })
    .await
}
#[tauri::command]
async fn message_action(
    state: tauri::State<'_, State>,
    id: String,
    action: String,
) -> Result<String> {
    work(state.inner().clone(), move |path| {
        let c = db::open(path)?;
        let m = db::message(&c, &id)?;
        let a = db::account(&c, &m.account_id)?;
        if !a.enabled {
            return Err("Аккаунт отключён".into());
        }
        mail::run(
            &a,
            &secrets::get(&a.id, "imap")?,
            mail::Job::Action(path, &id, &action),
        )
    })
    .await
}
#[tauri::command]
async fn send_message(state: tauri::State<'_, State>, draft: Compose) -> Result<String> {
    work(state.inner().clone(), move |path| {
        let c = db::open(path)?;
        let a = db::account(&c, &draft.account_id)?;
        if !a.enabled {
            return Err("Аккаунт отключён".into());
        }
        let result = mail::send(&a, &draft)?;
        if c.execute("DELETE FROM drafts WHERE id=?1", [&draft.id])
            .is_err()
        {
            return Ok(format!(
                "{result}. Черновик не удалось удалить; не отправляйте повторно."
            ));
        }
        Ok(result)
    })
    .await
}
#[tauri::command]
fn save_draft(state: tauri::State<State>, draft: Compose) -> Result<()> {
    db::open(&state.path)?
        .execute(
            "INSERT OR REPLACE INTO drafts VALUES(?1,?2)",
            rusqlite::params![draft.id, serde_json::to_string(&draft).unwrap()],
        )
        .map_err(db::err)?;
    Ok(())
}
#[tauri::command]
fn list_drafts(state: tauri::State<State>) -> Result<Vec<Compose>> {
    let c = db::open(&state.path)?;
    let mut q = c
        .prepare("SELECT data FROM drafts ORDER BY rowid DESC")
        .map_err(db::err)?;
    let rows = q
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(db::err)?;
    rows.map(|r| {
        serde_json::from_str(&r.map_err(db::err)?)
            .map_err(|_| "Не удалось прочитать черновик".into())
    })
    .collect()
}
#[tauri::command]
fn delete_draft(state: tauri::State<State>, id: String) -> Result<()> {
    db::open(&state.path)?
        .execute("DELETE FROM drafts WHERE id=?1", [id])
        .map_err(db::err)?;
    Ok(())
}
#[tauri::command]
fn get_ui(state: tauri::State<State>) -> Result<String> {
    use rusqlite::OptionalExtension;
    Ok(db::open(&state.path)?
        .query_row("SELECT data FROM ui WHERE key='view'", [], |r| r.get(0))
        .optional()
        .map_err(db::err)?
        .unwrap_or("{}".into()))
}
#[tauri::command]
fn save_ui(state: tauri::State<State>, value: String) -> Result<()> {
    if value.len() > 4096 {
        return Err("Слишком большой размер настроек".into());
    }
    db::open(&state.path)?
        .execute("INSERT OR REPLACE INTO ui VALUES('view',?1)", [value])
        .map_err(db::err)?;
    Ok(())
}
#[tauri::command]
async fn save_attachment(
    app: tauri::AppHandle,
    state: tauri::State<'_, State>,
    id: String,
    index: usize,
) -> Result<bool> {
    use tauri_plugin_dialog::DialogExt;
    let path = state.path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        use base64::Engine;
        let m = db::message(&db::open(&path)?, &id)?;
        let a = m.attachments.get(index).ok_or("Вложение не найдено")?;
        let name = a
            .name
            .rsplit(['/', '\\'])
            .next()
            .unwrap_or("attachment.bin");
        if let Some(file) = app.dialog().file().set_file_name(name).blocking_save_file() {
            let path = file.into_path().map_err(|_| "Некорректный путь")?;
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(&a.data)
                .map_err(|_| "Повреждено вложение")?;
            std::fs::write(path, bytes).map_err(|_| "Не удалось сохранить файл")?;
            Ok(true)
        } else {
            Ok(false)
        }
    })
    .await
    .map_err(|_| "Операция прервана".to_string())?
}
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let path = dir.join("mail.db");
            db::open(&path).map_err(std::io::Error::other)?;
            app.manage(State {
                path,
                operations: Arc::new(Mutex::new(())),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_accounts,
            list_messages,
            get_message,
            save_account,
            account_action,
            test_connection,
            sync_account,
            message_action,
            send_message,
            save_draft,
            list_drafts,
            delete_draft,
            get_ui,
            save_ui,
            save_attachment
        ])
        .run(tauri::generate_context!())
        .expect("Не удалось запустить Morfius Mail");
}

#[cfg(test)]
mod protocol_tests;
