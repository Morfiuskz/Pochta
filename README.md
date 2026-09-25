# Почта

**Modern, privacy-focused desktop email client for Windows.**

«Почта» — открытый настольный почтовый клиент с тёмным трёхколоночным интерфейсом, объединённым входящим и поддержкой нескольких аккаунтов. Приложение работает напрямую с почтовыми провайдерами по IMAP/SMTP и хранит кэш писем локально на устройстве.

Проект сосредоточен на основной работе с почтой без календарей, рекламы, аналитики и облачного сервиса разработчика. Яндекс, Google и Mail.ru поддерживают вход через OAuth; для совместимых провайдеров остаётся ручная настройка и вход по паролю приложения.

## Features

- несколько почтовых аккаунтов и единый список писем;
- получение по IMAP и отправка по SMTP;
- OAuth для Яндекса, Google/Gmail и Mail.ru;
- ручная настройка и пароли приложений как fallback;
- создание письма, ответ и ответ всем;
- получение, просмотр, отправка и сохранение вложений;
- статусы прочитано/не прочитано, пометка звездой и перенос в корзину;
- локальный SQLite-кэш и полнотекстовый поиск;
- progressive sync: первые 50 писем появляются быстро, затем список догружается до лимита 200;
- локальная сортировка по дате и отправителю;
- изменяемая ширина трёх колонок с сохранением настройки;
- хранение credentials и OAuth-токенов в системном secure credential storage;
- очистка HTML и изолированный просмотр письма;
- внешние изображения заблокированы по умолчанию;
- тёмный desktop UI для Windows.

## Supported providers

| Провайдер | Поддержка |
| --- | --- |
| Яндекс / Яндекс 360 | OAuth, IMAP/SMTP XOAUTH2; для custom domain возможен ручной выбор провайдера |
| Gmail / Google | OAuth, IMAP/SMTP XOAUTH2 |
| Mail.ru | OAuth через развёрнутый HTTPS broker, IMAP/SMTP XOAUTH2 |
| VK WorkSpace / custom domains | Ручная настройка и пароль приложения; OAuth публично не заявляется без официального подтверждения |
| iCloud Mail | Ручная настройка с паролем приложения, где это разрешено провайдером |
| Другие IMAP/SMTP-сервисы | Автоконфигурация через Thunderbird ISPDB либо ручные параметры |
| Outlook / Microsoft | Пока не реализовано: требуется Microsoft OAuth |

Подробности регистрации OAuth-приложений и локальной конфигурации владельца сборки: [docs/OAUTH.md](docs/OAUTH.md).

## Security & privacy

- Письма передаются между приложением и выбранным почтовым провайдером, а не на сервер разработчика.
- Письма и metadata кэшируются локально; содержимое кэша не имеет дополнительного шифрования поверх защиты операционной системы.
- Пароли и OAuth-токены хранятся отдельно в системном хранилище credentials и не записываются в SQLite.
- Mail OAuth broker на `https://oauth.morfius.ru` используется только для token exchange и не хранит письма, коды или токены.
- HTML очищается и открывается в sandboxed viewer; remote images требуют явного разрешения пользователя.

Подробнее: [Privacy Policy](PRIVACY.md) и [Security Policy](SECURITY.md).

## Screenshots

Скриншоты будут опубликованы вместе с первым публичным релизом. Каталог для них подготовлен в `docs/screenshots/`; отсутствующие изображения намеренно не подключены к README.

## Download

Windows installer распространяется только через [GitHub Releases](https://github.com/Morfiuskz/Pochta/releases) и не хранится в Git. После публикации первого релиза актуальной версией станет **v0.1.0**; исходный код останется доступен в этом репозитории.

Пока release отсутствует, приложение можно собрать из исходного кода по инструкции ниже. Первая версия installer не будет иметь цифровой подписи, поэтому Windows может показать предупреждение SmartScreen.

## Development

Основная среда разработки и тестирования — Windows 10/11 x64. Потребуются:

- Node.js 22;
- Rust stable с MSVC toolchain;
- Visual Studio Build Tools 2022 с workload **Desktop development with C++** и Windows SDK;
- Microsoft Edge WebView2 Runtime;
- Git.

```powershell
git clone https://github.com/Morfiuskz/Pochta.git
Set-Location Pochta
npm ci
npm run tauri dev
```

`npm run dev` запускает только браузерный preview без native mail operations. Release-сборка Windows:

```powershell
npm run tauri build
```

Конфигурация создаёт NSIS installer в `src-tauri\target\release\bundle\nsis\`; build artifacts и installer не коммитятся. Настройка OAuth описана отдельно в [docs/OAUTH.md](docs/OAUTH.md). Перед pull request прочитайте [CONTRIBUTING.md](CONTRIBUTING.md).

## Tech stack

- Tauri 2 и Rust;
- React 19 и TypeScript;
- SQLite с FTS5;
- IMAP, SMTP, MIME и XOAUTH2;
- Windows Credential Manager через системный keyring;
- Vite и NSIS.

## Known limitations

- За один проход загружается до 200 последних писем каждой папки; pagination старой почты ещё нет.
- Письма больше 25 МБ пропускаются, суммарный размер отправляемых вложений ограничен 20 МБ.
- Поиск работает только по локально загруженным письмам и возвращает до 1000 результатов.
- Нет push/IDLE, группировки цепочек, редактирования серверных черновиков, custom folder mapping и окончательного удаления.
- Поддержка CID-изображений ограничена; активные ссылки и remote content намеренно ограничены.
- Локальный SQLite-кэш писем не зашифрован дополнительно.
- Microsoft OAuth ещё не реализован.
- Google OAuth остаётся в режиме Testing до подготовки публичного consent/verification; входят только добавленные Test users.
- Windows installer v0.1.0 планируется без code signing.

## Roadmap

Ближайшая цель — публичный Windows release v0.1.0: чистая release-сборка, ручная проверка installer, скриншоты и публикация GitHub Release. Затем планируются подгрузка старых писем, Microsoft OAuth, улучшения MIME/CID и опциональная подпись installer.

Актуальный checklist: [docs/ROADMAP.md](docs/ROADMAP.md).

## License

Исходный код распространяется по лицензии [MIT](LICENSE). Использование приложения также регулируется краткими [Terms of Use](TERMS.md).
