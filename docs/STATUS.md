# Статус проекта

Дата: 2026-09-25. «Почта» готовится к первому публичному Windows release **v0.1.0**. Основная среда разработки и ручного тестирования — Windows 10/11.

## Работает сейчас

- Несколько аккаунтов, unified inbox и фильтрация через sidebar.
- IMAP/SMTP, MIME, отправка, Reply/Reply All и вложения.
- Серверные read/unread, star и перенос в корзину.
- Локальный SQLite-кэш, FTS5 search и локальные черновики.
- Progressive sync: первая пачка до 50 писем сразу отдаётся в UI, фоновая догрузка продолжается до лимита 200; уже загруженные письма сохраняются при ошибке.
- Локальная сортировка писем по дате и отправителю.
- Трёхколоночный тёмный UI, draggable-разделители с сохранением размеров и custom dropdowns.
- Очистка HTML, sandboxed viewer и блокировка remote images по умолчанию.
- Пароли и OAuth-токены хранятся в системном credential storage, а не в SQLite или React state.

## Провайдеры и OAuth

- **Яндекс:** OAuth Authorization Code + PKCE/state, loopback callback и IMAP/SMTP XOAUTH2 работают.
- **Google/Gmail:** Desktop OAuth + PKCE/state, refresh и IMAP/SMTP XOAUTH2 реализованы и live-проверены. Google OAuth app пока работает в режиме Testing для добавленных Test users.
- **Mail.ru:** OAuth + PKCE/state, refresh и IMAP/SMTP XOAUTH2 реализованы и live-проверены через stateless HTTPS broker.
- **Mail broker:** развёрнут через Coolify/Traefik на `https://oauth.morfius.ru`; desktop endpoint — `https://oauth.morfius.ru/mail/token`. Broker не хранит письма или пользовательские токены.
- **VK WorkSpace/custom domains:** используется app-password/manual fallback, пока применимость Mail OAuth официально не подтверждена.
- **iCloud и другие совместимые IMAP/SMTP-провайдеры:** ISPDB/manual setup и пароль приложения, где это поддерживает провайдер.
- **Outlook/Microsoft:** пока не реализован; требуется Microsoft OAuth.

Подробности: [OAUTH.md](OAUTH.md).

## Проверено

- Яндекс, Google и Mail.ru OAuth flows live-проверены, включая получение authorization code, token exchange и почтовую OAuth-аутентификацию.
- Mail broker работает по HTTPS в production-развёртывании Coolify/Traefik.
- Progressive sync показывает прогресс и постепенно обновляет список писем.
- Текущие UI-улучшения работают: сортировка, custom dropdowns, выбор аккаунта только в sidebar и сохраняемые размеры колонок.
- Windows NSIS build поддерживается; installer должен распространяться через GitHub Releases, а не через Git.

## Windows production build v0.1.0

25 сентября 2026 года production build успешно прошёл на Windows: `npm run typecheck`, `npm run build`, `cargo check --manifest-path src-tauri/Cargo.toml --locked` и `npm run tauri build` завершились без ошибок.

- Installer: `src-tauri\target\release\bundle\nsis\Почта_0.1.0_x64-setup.exe`.
- Размер: 4 052 345 байт (3,86 МиБ).
- SHA-256: `5DE40967251B0CC7085C2EB8AAF6DCC498F7FF4B75E83D866FD29E20DBADEF89`.
- Windows metadata: Product Name и File Description — «Почта», File Version — `0.1.0`.
- Installer не подписан, как и запланировано для первого релиза.
- Rust предупредил о future incompatibility зависимости `imap-proto 0.10.2`; также linker сообщил о штатном создании import library. Сборку эти предупреждения не прервали.

GitHub Release пока не создан. До публикации installer нужно вручную проверить на чистой Windows 10/11 x64: установку и SmartScreen, имя/иконку/ярлыки, первый и повторный запуск, сохранение данных и credentials с identifier `com.morfius.mail`, OAuth Яндекс/Google/Mail.ru, IMAP sync, SMTP send, вложения, обновление поверх прежней установки и удаление приложения.

## Ограничения v0.1.0

- До 200 последних писем на папку за проход; подгрузки более старой почты пока нет.
- Письма больше 25 МБ пропускаются; отправляемые вложения ограничены суммарно 20 МБ.
- Поиск работает по локальному кэшу и возвращает до 1000 результатов.
- Нет push/IDLE, thread grouping, custom folder mapping, редактирования серверных drafts и окончательного удаления.
- Кэш писем не имеет дополнительного шифрования поверх защиты ОС.
- Google scope `https://mail.google.com/` требует подготовки публичного consent и проверки требований verification.
- Первый Windows installer планируется без цифровой подписи.

## До публичного release

Остаются чистая Windows release-сборка, ручной тест installer, скриншоты, финальный просмотр публичных страниц, публикация GitHub Release v0.1.0 и подготовка Google OAuth к внешним пользователям. Checklist ведётся в [ROADMAP.md](ROADMAP.md).
