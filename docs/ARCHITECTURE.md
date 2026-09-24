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

Телеметрии и удалённых шрифтов нет. Помимо почтовых серверов и явно разрешённых изображений сеть используется для ISPDB (только домен) и OAuth. Mail OAuth требует отдельного HTTPS broker владельца, поскольку секрет приложения не встраивается в desktop.

- `providers.ts`: presets, точное сопоставление доменов, поддерживаемые auth methods. `discovery.rs`: HTTPS Thunderbird ISPDB с timeout, ограничением ответа и отказом от небезопасной/неподдерживаемой конфигурации.
- `oauth.rs`: PKCE S256/state, системный браузер, ограниченный loopback callback, токены в vault, refresh через broker. OAuth не передаёт токены через IPC. Серверы XOAUTH2 ограничены конкретным provider.
- Account.auth с serde default Password сохраняет совместимость старых JSON в SQLite; schema migration не нужна. Identifier, keyring service и пути данных сохранены при переименовании в «Почта».
- Сохранение соединения проверяет IMAP и SMTP до записи аккаунта; ожидание browser OAuth не блокирует синхронизацию. Настройка и ограничения: [OAUTH.md](OAUTH.md).
