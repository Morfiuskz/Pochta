# Почта

Минималистичный локальный почтовый клиент для Windows: несколько IMAP-ящиков, общий inbox, поиск по кэшу, чтение и SMTP-отправка. Три колонки, тёмный интерфейс, никаких календарей, AI или дополнительных сервисов.

**Стек:** Tauri 2 · React 19 · TypeScript · Rust · SQLite FTS5 · IMAP/SMTP · Windows Credential Manager.

## Запуск

Windows 10/11 x64: Node.js 22 LTS, Rust stable (MSVC), Visual Studio Build Tools с «Desktop development with C++» и Windows SDK, Microsoft Edge WebView2 Runtime. На macOS для разработки нужны Xcode Command Line Tools; секреты сохраняются в Keychain.

```sh
npm ci
npm run tauri dev
```

`npm run dev` открывает только предпросмотр UI без почтовых операций. Настоящая почта работает в Tauri. Кнопка «+» открывает компактный шаг email + название. Далее: встроенный preset → Thunderbird ISPDB по домену → явный ручной fallback. Распознаются Яндекс, Mail/VK Mail, Gmail, Outlook/Microsoft, iCloud и их aliases. Серверы не угадываются по домену.

Яндекс OAuth: реализован PKCE + XOAUTH2, нужен собственный Client ID. Mail OAuth: клиентская инфраструктура готова, нужны регистрация и HTTPS broker владельца для client secret. [Настройка OAuth](docs/OAUTH.md). Без OAuth доступны пароли приложений; Outlook требует ещё не реализованный Microsoft OAuth. POP3 помечен «позже» и отключён. Перед сохранением проверяются IMAP и SMTP.

## Windows development setup

Для Windows 10/11 **x64** установите Git, **Node.js 22 LTS с npm 10**, **Rust stable через rustup (MSVC)**, **Visual Studio Build Tools 2022** с workload **Desktop development with C++** (MSVC x64/x86 и Windows 10/11 SDK), **Microsoft Edge WebView2 Evergreen Runtime**. После установки откройте новый PowerShell. [Официальные prerequisites Tauri](https://v2.tauri.app/start/prerequisites/#windows).

Первый checkout:

```powershell
git clone https://github.com/Morfiuskz/Pochta.git
Set-Location Pochta
```

Либо в существующем checkout без незакоммиченных изменений:

```powershell
git switch main
git pull --ff-only origin main
```

Далее из корня репозитория:

```powershell
rustup default stable-x86_64-pc-windows-msvc
node --version
npm --version
rustc --version
npm install
npm run tauri dev
# Завершите dev через Ctrl+C, затем соберите release:
npm run tauri build
```

`npm run tauri build` сам выполняет frontend build и Rust release build. В конфигурации включён **только NSIS**, поэтому ожидаемый installer (при стандартном target directory):

```text
src-tauri\target\release\bundle\nsis\Почта_0.1.0_x64-setup.exe
```

MSI не генерируется. Установщик без цифровой подписи. Первой сборке нужен интернет для dependencies и инструментов NSIS; переносить `node_modules`, `dist`, `src-tauri/target` с Mac не нужно. Git переносит исходники и lockfiles, но не локальные ящики, SQLite, OAuth config или Apple Keychain: на новом Windows-компьютере добавьте аккаунты заново.

GitHub Actions → **Windows build** → artifact **Pochta-Windows-x64**. Локальная сборка не зависит от CI.

### Старая установка Morfius Mail на том же Windows

`productName` и title теперь «Почта»; имя bundle наследуется от productName. Identifier и keyring service остались `com.morfius.mail`, версия пока `0.1.0`. Поэтому путь данных `%APPDATA%\com.morfius.mail` и имена записей credentials сохранены. Однако корректное обновление поверх старой установки после rename (с той же версией) без Windows-теста **не гарантировано**: installer может не распознать прежнее имя установки.

Закройте приложение и сделайте резервную копию папки данных. Сначала попробуйте новый installer без предварительного удаления старого. Если он создаёт вторую установку или конфликтует, удалите старую через Windows, **не выбирая удаление данных**, затем установите «Почта». Сохранность credentials после деинсталляции пока не проверена: держите возможность повторного входа. Не удаляйте папку данных и записи Credential Manager вручную.

Первым делом проверьте запуск, название окна, доступ к прежним аккаунтам (если были), IMAP/SMTP, сохранение пароля после перезапуска. OAuth требует отдельно настроенных developer credentials — см. [OAUTH.md](docs/OAUTH.md).

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
- OAuth Google/Microsoft ещё не реализован. Существующие ручные аккаунты продолжают работать без миграции базы.

[Объём проекта](docs/PROJECT.md) · [Архитектура](docs/ARCHITECTURE.md) · [Статус](docs/STATUS.md) · [Проверка вручную](docs/MANUAL-VERIFICATION.md) · [Решения](docs/DECISIONS.md) · [Дальнейшие шаги](docs/ROADMAP.md)
