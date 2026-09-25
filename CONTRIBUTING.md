# Contributing

Спасибо за интерес к проекту «Почта». Для небольшого и проверяемого pull request:

1. Создайте fork репозитория.
2. Создайте отдельную branch от актуальной `main`.
3. Внесите сфокусированные изменения без несвязанного рефакторинга.
4. Выполните подходящие проверки.
5. Откройте pull request с описанием проблемы, решения и ручной проверки.

## Среда разработки

Основная поддерживаемая среда — Windows 10/11 x64:

- Node.js 22;
- Rust stable с target `x86_64-pc-windows-msvc`;
- Visual Studio Build Tools 2022: **Desktop development with C++**, MSVC и Windows SDK;
- Microsoft Edge WebView2 Runtime.

```powershell
npm ci
npm run tauri dev
```

## Проверки перед PR

Минимум для frontend-изменений:

```powershell
npm run typecheck
```

Минимум для Rust/Tauri-изменений:

```powershell
cargo check --manifest-path src-tauri/Cargo.toml --locked
```

Для затронутой логики добавьте и запустите focused tests. Полный набор lint/test/build уместен перед release или для изменений широкого охвата.

## Что нельзя коммитить

- `oauth.json`, `.env` и Client Secrets;
- пароли, OAuth-коды, access/refresh tokens и другие credentials;
- реальные письма, вложения, SQLite-базы и каталоги данных приложения;
- `node_modules`, `dist`, `target`, installer и другие build artifacts;
- логи или скриншоты с персональными данными.

Сообщайте об уязвимостях по правилам [SECURITY.md](SECURITY.md), а не через публичный issue с чувствительными деталями.
