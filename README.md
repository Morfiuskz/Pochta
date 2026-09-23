# Morfius Mail

Минималистичный локальный почтовый клиент для Windows: несколько IMAP-ящиков, общий inbox, поиск по кэшу, чтение и SMTP-отправка. Три колонки, тёмный интерфейс, никаких календарей, AI или дополнительных сервисов.

**Стек:** Tauri 2 · React 19 · TypeScript · Rust · SQLite FTS5 · IMAP/SMTP · Windows Credential Manager.

## Запуск

Windows 10/11 x64: Node.js 22 LTS, Rust stable (MSVC), Visual Studio Build Tools с «Desktop development with C++» и Windows SDK, Microsoft Edge WebView2 Runtime. На macOS для разработки нужны Xcode Command Line Tools; секреты сохраняются в Keychain.

```sh
npm ci
npm run tauri dev
```

`npm run dev` открывает только предпросмотр UI без почтовых операций. Настоящая почта работает в Tauri. Кнопка «+» в разделе аккаунтов открывает настройки IMAP/SMTP. Рекомендуется пароль приложения. OAuth2 и POP3 не поддерживаются.

## Windows installer

На Windows:

```sh
npm ci
npm run tauri build -- --bundles nsis
```

Установщик: `src-tauri/target/release/bundle/nsis/Morfius Mail_0.1.0_x64-setup.exe`.

GitHub Actions → **Windows build** → успешный запуск → artifact **Morfius-Mail-Windows-x64**. Workflow запускается при push в `main`, pull request и вручную. Установщик пока не подписан сертификатом разработчика.

На macOS проверка native release: `npm run tauri build -- --no-bundle`. Windows installer собирается на Windows runner, не на macOS.

## Проверка

```sh
npm run typecheck
npm run lint
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml --locked
cargo clippy --manifest-path src-tauri/Cargo.toml --locked -- -D warnings
cargo fmt --manifest-path src-tauri/Cargo.toml --check
```

## Данные и ограничения

- SQLite в системной папке данных приложения `com.morfius.mail` (Windows: `%APPDATA%\com.morfius.mail\mail.db`). Пароли — отдельные записи системного vault, не SQLite и не конфиги.
- Тела писем, вложения и локальные черновики хранятся в кэше **без дополнительного шифрования**. Доступ к файлам регулирует ОС.
- Синхронизация при запуске и вручную; до 200 последних писем каждой распознанной папки за проход. Ранее загруженные письма сохраняются, их флаги обновляются. Поиск — по загруженным письмам, максимум 1000 результатов.
- Письма больше 25 МБ пропускаются. Отправляемые вложения ограничены суммарно 20 МБ.
- HTML очищается и отображается в sandbox iframe; скрипты, формы, ссылки и внешние стили отключены. Изображения загружаются только после явного разрешения для конкретного письма.
- Reply / Reply All поддерживают Reply-To и заголовки In-Reply-To/References; отдельной группировки цепочек нет.
- Удаление переносит письмо в серверную корзину. Окончательное удаление в MVP отсутствует.
- Черновики создаются и сохраняются локально; серверные черновики доступны для чтения.
- Провайдеры, требующие исключительно OAuth2, в текущем MVP не подключаются.

[Объём проекта](docs/PROJECT.md) · [Архитектура](docs/ARCHITECTURE.md) · [Статус](docs/STATUS.md) · [Проверка вручную](docs/MANUAL-VERIFICATION.md) · [Решения](docs/DECISIONS.md) · [Дальнейшие шаги](docs/ROADMAP.md)
