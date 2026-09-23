# Архитектура

React (`src/`) → типизированные payload Tauri commands (`src-tauri/src/lib.rs`) → `mail.rs` / `db.rs` / `secrets.rs`.

- `model.rs`: сериализуемые модели, проверка конфигурации. Пароли существуют только во входном AccountInput и системном vault.
- `mail.rs`: IMAP через `imap` + native TLS, MIME через `mailparse`, SMTP через `lettre`. UID идентифицируется вместе с аккаунтом, папкой и UIDVALIDITY. BODY.PEEK не меняет Seen во время синхронизации.
- `db.rs`: SQLite WAL; accounts, folders, messages, drafts, ui, индекс FTS5 unicode61. Параметризованные SQL-запросы; поисковый ввод экранирован как FTS-литералы. Список не передаёт тела/вложения в JS.
- `secrets.rs`: keyring 3, Windows native Credential Manager, Apple Keychain для разработки. Отдельные IMAP/SMTP entries. Нет plaintext fallback.
- Блокирующие сетевые операции выполняются через spawn_blocking. Общая блокировка упорядочивает sync, изменения аккаунтов, отправку и флаги. Чтение кэша не ждёт сетевой операции.
- Sync сначала получает данные папки, затем транзакционно обновляет кэш и удаляет исчезнувшие UID. При изменении UIDVALIDITY старые UID папки удаляются. Отключённые аккаунты не видны в поиске/списке.
- HTML: DOMPurify с allowlist, без CSS/ссылок/форм; iframe sandbox без разрешений и собственный CSP. IPC capabilities относятся только к главному локальному окну; native API не передаются в iframe.
- Сохранение вложения идёт через native save dialog. Путь не принимается от HTML письма.

Никакого облачного backend, телеметрии или удалённых шрифтов. Сеть используется для заданных пользователем почтовых серверов и явно разрешённых изображений.
