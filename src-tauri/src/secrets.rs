use crate::model::*;
fn entry(id: &str, kind: &str) -> Result<keyring::Entry> {
    keyring::Entry::new("com.morfius.mail", &format!("{id}:{kind}"))
        .map_err(|_| "Системное хранилище паролей недоступно".into())
}
pub fn get(id: &str, kind: &str) -> Result<String> {
    entry(id, kind)?.get_password().map_err(|_| {
        "Пароль не найден в системном хранилище. Откройте подключение и введите пароль заново."
            .into()
    })
}
pub fn set(id: &str, kind: &str, value: &str) -> Result<()> {
    entry(id, kind)?
        .set_password(value)
        .map_err(|_| "Не удалось сохранить пароль в системном хранилище".into())
}
pub fn delete(id: &str, kind: &str) -> Result<()> {
    match entry(id, kind)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("Не удалось удалить пароль из системного хранилища".into()),
    }
}
