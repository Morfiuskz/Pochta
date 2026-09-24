# Статус

Дата: 2026-09-25. Приложение переименовано в «Почта», добавлены onboarding и OAuth-инфраструктура. Реализован MVP. Основной пользовательский сценарий проверен через native UI на изолированных локальных IMAP/SMTP-серверах. Windows NSIS сборка предыдущего MVP успешна; она не содержит описанного ниже нового onboarding. Новые изменения проверяются на macOS.

## Текущее продолжение: onboarding и OAuth

- Пользовательское имя «Почта»: sidebar, modal, HTML/window title, product/installer metadata; конверт и внутренний identifier сохранены.
- Первый шаг: email и optional display name. Presets Яндекс/Mail/Gmail/Microsoft/iCloud → HTTPS Thunderbird ISPDB → явная ручная форма. Неизвестный домен не превращается в выдуманные imap/smtp хосты. Собственный домен можно связать с Яндекс 360 вручную.
- Отдельные методы Password/OAuth, backward-compatible serde default для существующих аккаунтов. Сохранение требует успешной проверки IMAP и SMTP.
- Яндекс: реализованы code + PKCE S256/state, loopback callback, browser login и IMAP/SMTP XOAUTH2; требуется Client ID владельца. Официальный refresh требует Client Secret, поэтому без broker после истечения токена UI предлагает безопасный повторный вход.
- Google: реализован официальный Desktop flow через системный браузер — Authorization Code + PKCE/state, отдельный loopback callback, scope `https://mail.google.com/`, IMAP/SMTP XOAUTH2, secure storage и автоматический refresh. Gmail/Googlemail распознаются напрямую; Google Workspace предлагается только по ISPDB-серверам Google или ручному выбору. Требуется Desktop Client ID владельца и настройка consent screen/test users.
- Mail: официально подтверждены discovery, PKCE S256/state, `openid mail.imap offline_access`, refresh token и единый XOAUTH2 bearer format для IMAP/SMTP. Allowlist обновлён для актуальных endpoints на `o2.mail.ru`. Обмен и refresh требуют Client Secret, поэтому остаются за HTTPS broker; broker не развёрнут, loopback redirect не проверен при регистрации. Для VK WorkSpace/custom-domain OAuth Mail публично не подтверждён — используется app-password/manual fallback. Microsoft OAuth пока не реализован; Outlook не предлагает пароль как замену OAuth.
- Токены только в системном vault, не IPC/SQLite/log. OAuth-хосты ограничены provider; TLS validation сохранена. Конфигурация и контракт broker: [OAUTH.md](OAUTH.md).
- Manual IMAP/SMTP, TLS/STARTTLS/None, отдельные credentials SMTP работают; POP3 явно отключён («позже»).
- В браузере проверены компактная форма, Яндекс, app-password, неизвестный домен и ручной fallback. Исправлено сохранение чужого preset при возврате и смене email.

## Проверка текущих изменений

- Для завершения Yandex OAuth и добавления Google OAuth выполнены ровно `npm run typecheck` и `cargo check --manifest-path src-tauri/Cargo.toml --locked`: успешно. Полные test suites и release build не запускались; live OAuth оставлен для ручной проверки с Client IDs владельца.
- TypeScript typecheck, ESLint: успешно.
- Frontend: 5 тестов, включая domain matching, fallback/auth selection и сохранение display metadata.
- Rust: 9 тестов, включая discovery parsing/fallback, PKCE/state, XOAUTH2 payload, старый формат аккаунтов и сохранённые loopback IMAP/SMTP проверки.
- Cargo check, Clippy all-targets с `-D warnings`, rustfmt: успешно. Есть прежнее предупреждение future incompatibility `imap-proto 0.10.2`.
- Vite production build: успешно. Tauri release `.app`: успешно, `src-tauri/target/release/bundle/macos/Почта.app`. Native запуск, новое имя, onboarding и понятный отказ OAuth без конфигурации проверены.
- Native ISPDB: настройки GMX загружены; HTTP 404 для Fastmail корректно перевёл в manual fallback. Пароли и реальные аккаунты для этой проверки не использовались.
- Реальный Yandex/Google OAuth не проверен: developer credentials не предоставлены. На Windows ещё нужны browser callback, Credential Manager для tokens, IMAP/SMTP XOAUTH2 и Google refresh; для Mail нужны зарегистрированное OAuth Mail приложение, принятый loopback redirect, развёрнутый broker и live-проверка обычного Mail-аккаунта. Поддержка OAuth для VK WorkSpace/custom-domain требует отдельного официального подтверждения.

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

## Проверка предыдущего MVP

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

200 последних писем на папку за проход; старый кэш сохраняется. Письма >25 МБ пропускаются, поиск до 1000 результатов, отправляемые вложения ≤20 МБ. Custom folders, OAuth Microsoft, push, server drafts editing, CID-картинки, активные ссылки и окончательное удаление не входят в MVP. Кэш писем не зашифрован. Google scope `https://mail.google.com/` требует проверки приложения перед публичным распространением. Windows installer без подписи. `imap-proto 0.10.2` выдаёт предупреждение о совместимости с будущей версией Rust.
