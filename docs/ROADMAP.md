# Roadmap

## Public Release v0.1.0

- [ ] Выполнить fresh Windows release build из чистого checkout.
- [ ] Вручную проверить установку, первый запуск, обновление/удаление и предупреждение SmartScreen.
- [ ] Создать GitHub Release `v0.1.0` и приложить Windows installer.
- [ ] Подготовить скриншоты интерфейса и добавить их в `docs/screenshots/`.
<!-- TODO: добавить реальные скриншоты перед публикацией v0.1.0; не добавлять broken image references. -->
- [ ] Выполнить финальный README pass после появления release URL и изображений.
- [ ] Опубликовать Privacy Policy и Terms на `morfius.ru` до Google production verification.
- [ ] Перевести Google OAuth app из Testing в In Production, когда публичный релиз будет готов.
- [ ] Пройти Google verification для Gmail scope, если она требуется для выбранного сценария публикации.
- [ ] Рассмотреть code signing Windows installer после первого релиза.
- [ ] Подготовить анонс для GitHub и Reddit.

## После v0.1.0

1. Подгрузка старых писем и pagination без увеличения initial sync.
2. Microsoft OAuth для Outlook/Office 365.
3. Ручной выбор нестандартных папок и улучшение MIME/CID edge cases.
4. IMAP IDLE/push и более эффективная инкрементальная синхронизация.
5. Опциональная подпись installer и безопасный механизм обновлений.

Проект остаётся почтовым клиентом: календарь, задачи, AI и несвязанные сервисы не входят в ближайший scope.
