# Статус

Дата: 2026-09-24. Реализован MVP. Основной пользовательский сценарий проверен через native UI на изолированных локальных IMAP/SMTP-серверах. Финальная Windows NSIS сборка с текущими исправлениями завершилась успешно.

## Реализовано

- Трёхколоночный desktop UI; account modal, меню, default sender, rename и отключение.
- Реальные Rust IMAP/SMTP команды, TLS/STARTTLS, MIME, вложения, Reply/Reply All.
- SQLite cache + FTS5; локальные drafts и состояние папки/аккаунта.
- Системное хранение секретов; безопасный HTML и блокировка картинок.
- Серверные read/unread, star, delete; startup/manual sync.
- Windows NSIS workflow, иконки, lockfiles, документация.

## Завершено при продолжении

- Проверен flow: добавить аккаунт → IMAP/SMTP connection test → получить/открыть HTML-письмо с вложением → найти текст через SQLite → создать/сохранить/открыть черновик → SMTP send → Sent copy → Reply → read/unread/star → Trash → rename → default sender между двумя аккаунтами.
- Системный vault на macOS: сохранение/чтение пароля работают; пароль отсутствует в тестовой SQLite. Rename сохранил email и логины. После перезапуска кэш загрузился и startup sync завершился.
- Исправлен белый фон iframe в native WebView; тёмный HTML-просмотр визуально проверен после пересборки.
- При смене папки сбрасывается фильтр, поэтому «Непрочитанные» больше не скрывает локальные черновики.
- Пустой compose не создаёт черновик; фокус ставится в поле получателя. Проверено в native UI и по количеству drafts в SQLite.
- Сохранение/rename/default больше не переставляют аккаунты в sidebar (SQLite UPSERT сохраняет rowid); расширен существующий focused persistence test.
- Отключение выбранного аккаунта очищает viewer даже в объединённом inbox.
- Завершён preset iCloud SMTP: 587/STARTTLS.

## Проверка

- `npm run typecheck`, `npm run lint`, `npm run build`: успешно.
- Vitest: 3 теста — HTML isolation, opt-in images, Reply All.
- Финальный локальный Rust pass: 4 focused теста (конфигурация, MIME, folder mapping, SQLite/FTS/order/default/rename). Ранее прошедшие 2 loopback integration tests локально не повторялись; полный набор из 6 успешно прошёл в финальном Windows CI.
- `cargo check`, `cargo clippy --all-targets -- -D warnings`, `cargo fmt`: успешно.
- Native macOS release ранее собран; текущая QA `.app` пересобрана и проверена через native UI.
- [Финальный Windows NSIS build](https://github.com/Morfiuskz/Pochta/actions/runs/35962350882) для исходного commit `ed879a60a24ab1f522756433993d4d4ea1d9493f` завершился успешно: typecheck, lint, 3 frontend и 6 Rust тестов, fmt, Clippy и сборка installer.
- Артефакт `Morfius-Mail-Windows-x64` скачан в `artifacts/windows/Morfius Mail_0.1.0_x64-setup.exe` (3,1 МБ). Файл подтверждён как Windows NSIS executable; каталог artifacts исключён из Git.
- `npm audit`: 0 уязвимостей после обновления Vitest.
- UI проверен в браузере: основной экран, account modal, автоконфигурация Gmail, фокус и адаптация к высоте окна.

Реального почтового аккаунта в задаче нет: остаётся live-проверка внешнего провайдера/TLS и интерактивная установка/Windows Credential Manager на Windows. Это не подменяется локальными fixture-тестами. Loopback-тесты используют только синтетические данные и не отправляют письма внешним адресатам.

## Ограничения

200 последних писем на папку за проход; старый кэш сохраняется. Письма >25 МБ пропускаются, поиск до 1000 результатов, отправляемые вложения ≤20 МБ. Custom folders, OAuth2, push, server drafts editing, CID-картинки, активные ссылки и окончательное удаление не входят в MVP. Кэш писем не зашифрован. Windows installer без подписи. `imap-proto 0.10.2` выдаёт предупреждение о совместимости с будущей версией Rust.
