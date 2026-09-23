# Статус

Дата: 2026-09-23. Реализован MVP. Локальная сборка и автоматические проверки прошли; Windows CI запускается после push.

## Реализовано

- Трёхколоночный desktop UI; account modal, меню, default sender, rename и отключение.
- Реальные Rust IMAP/SMTP команды, TLS/STARTTLS, MIME, вложения, Reply/Reply All.
- SQLite cache + FTS5; локальные drafts и состояние папки/аккаунта.
- Системное хранение секретов; безопасный HTML и блокировка картинок.
- Серверные read/unread, star, delete; startup/manual sync.
- Windows NSIS workflow, иконки, lockfiles, документация.

## Проверка

- `npm run typecheck`, `npm run lint`, `npm run build`: успешно.
- Vitest: 3 теста — HTML isolation, opt-in images, Reply All.
- Rust: 6 тестов — конфигурация, MIME, folder mapping, SQLite/FTS, IMAP sync/flags/delete/empty folder по loopback, SMTP MIME/вложения/reply headers по loopback.
- `cargo check`, `cargo clippy --all-targets -- -D warnings`, `cargo fmt`: успешно.
- Native macOS release (`tauri build --no-bundle`): успешно. Проверка Windows NSIS выполняется в GitHub Actions.
- `npm audit`: 0 уязвимостей после обновления Vitest.
- UI проверен в браузере: основной экран, account modal, автоконфигурация Gmail, фокус и адаптация к высоте окна.

Реального почтового аккаунта в задаче нет: live-проверка провайдера, TLS серверов и Windows Credential Manager требует ручного checklist. Loopback-тесты используют только синтетические данные и не отправляют письма внешним адресатам.

## Ограничения

200 последних писем на папку за проход; старый кэш сохраняется. Письма >25 МБ пропускаются, поиск до 1000 результатов, отправляемые вложения ≤20 МБ. Custom folders, OAuth2, push, server drafts editing, CID-картинки, активные ссылки и окончательное удаление не входят в MVP. Кэш писем не зашифрован. Windows installer без подписи. `imap-proto 0.10.2` выдаёт предупреждение о совместимости с будущей версией Rust.
