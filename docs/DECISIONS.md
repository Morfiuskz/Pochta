# Технические решения

- Tauri 2 вместо Electron: native webview и Rust services. React без глобального state framework; простые компоненты и команды.
- Preset iCloud использует SMTP 587/STARTTLS по [документации Apple](https://support.apple.com/en-ie/102525); все параметры можно изменить вручную.
- Системный keyring обязателен. Ошибка vault останавливает сохранение; секреты не уходят в SQLite/config/log.
- TLS валидирует сертификат и hostname; STARTTLS обязателен, без downgrade. None доступен по требованию спецификации и подписан предупреждением в форме.
- SQLite FTS5 unicode61 для локального поиска; приставочный поиск слов, включая кириллицу. Не поиск ещё не загруженной серверной почты.
- Папки определяются по IMAP атрибутам и распространённым названиям. Неизвестные custom folders пока пропускаются. Нет сложного provider framework.
- Первичная синхронизация ограничена 200 письмами на папку и 25 МБ на письмо. Нет silent mark-as-read при sync. Флаги ранее загруженных сообщений обновляются отдельно.
- Delete: UID MOVE при поддержке; иначе UID COPY + Deleted и точечный UID EXPUNGE при UIDPLUS. Никогда не выполняется общий EXPUNGE, затрагивающий чужие удаления.
- SMTP acceptance считается отправкой. Ошибка последующего IMAP APPEND возвращает предупреждение об уже отправленном письме, не предложение повторить отправку. Для smtp.gmail.com APPEND пропущен, поскольку провайдер сохраняет копию сам; другие провайдеры могут создавать дубликат в Sent.
- Локальные drafts не синхронизируются на сервер. Отправка в plain text с MIME-вложениями, чтение HTML/text. Никакого WYSIWYG-редактора.
- Ссылки в письме не активны в MVP; внешние картинки только по кнопке. Нестандартные inline CID-картинки могут не отображаться.
- Фиксируются package-lock.json и Cargo.lock. Windows NSIS installer собирается в CI без подписи и публикации релиза.

Официальные справочники: [Tauri capabilities](https://v2.tauri.app/security/capabilities/), [IMAP Session](https://docs.rs/imap/2.4.1/imap/struct.Session.html), [lettre SMTP](https://docs.rs/lettre/latest/lettre/transport/smtp/index.html), [keyring](https://docs.rs/keyring/3.6.3/keyring/).
