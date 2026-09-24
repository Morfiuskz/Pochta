# OAuth: настройка владельцем приложения

В сборке нет чужих или выдуманных Client ID. Без регистрации приложения OAuth-кнопка возвращает понятное сообщение; пароль приложения остаётся отдельным способом входа.

Создайте `oauth.json` рядом с `mail.db` в каталоге данных **существующего** identifier `com.morfius.mail`:

- Windows: `%APPDATA%\com.morfius.mail\oauth.json`.
- macOS: `~/Library/Application Support/com.morfius.mail/oauth.json`.

Формат (пустые значения нужно заполнить; отсутствующий провайдер отключён):

```json
{
  "yandex": {
    "clientId": "",
    "redirectUri": "http://127.0.0.1:43821/oauth/callback"
  },
  "mail": {
    "clientId": "",
    "redirectUri": "http://127.0.0.1:43822/oauth/callback",
    "brokerUrl": ""
  }
}
```

Это публичная конфигурация, **не место для client secret, access/refresh tokens**. Файл читается при входе, пересборка не нужна. Redirect URI регистрируется у провайдера в точности, включая порт и отсутствие завершающего `/`. Callback слушает только IPv4 loopback, ждёт до 3 минут; занятый порт даёт понятную ошибку.

## Яндекс / Яндекс 360

Зарегистрируйте приложение в [Яндекс OAuth](https://oauth.yandex.ru/), получите собственный Client ID, разрешите `mail:imap_full` и `mail:smtp`, зарегистрируйте callback. Реализованы browser authorization code + PKCE S256, проверка state, обмен кода без client secret и IMAP/SMTP XOAUTH2. После входа оба сервера проверяются с указанным email: выбор другого аккаунта в браузере не сохраняет неработающее подключение. Домены Яндекса распознаются preset; для собственного домена выберите «Яндекс / Яндекс 360» после discovery.

[Официальный PKCE flow](https://yandex.ru/dev/id/doc/ru/codes/code-url) разрешает обмен кода без секрета. [Документация refresh](https://yandex.ru/dev/id/doc/ru/tokens/refresh-client) требует аутентификации приложения: по умолчанию по истечении токена нужен повторный вход, а не небезопасно встроенный secret. Для автоматического refresh можно добавить HTTPS `brokerUrl` по контракту ниже. [Mail XOAUTH2](https://yandex.ru/support/yandex-360/business/mail/ru/web/security/oauth).

## Mail / VK Mail

[Официальная документация Mail OAuth](https://oauth.mail.ru/docs) теперь перенаправляет в документацию VK ID: OAuth Mail остаётся для продуктового доступа к почте. Нужны зарегистрированное приложение Mail, собственный Client ID, Client Secret на сервере владельца, зарегистрированный redirect и разрешение `openid mail.imap offline_access` (`prompt=consent`). Обычный социальный вход VK ID не заменяет доступ к IMAP.

Клиентская часть реализована: OpenID discovery `https://account.mail.ru/.well-known/openid-configuration`, PKCE/state, browser callback, запрос обмена/refresh, secure storage и XOAUTH2. Официальный обмен кода требует server-side Basic authentication с Client Secret. Поэтому Mail включается **только с настроенным HTTPS brokerUrl**. В репозитории нет развёрнутого broker-сервиса: владелец должен предоставить его вместе с зарегистрированными credentials. До этого Mail OAuth не готов к реальному использованию; app-password IMAP/SMTP работает независимо.

### Контракт HTTPS broker

Один доверенный endpoint владельца принимает `POST application/x-www-form-urlencoded`:

- `grant_type=authorization_code`, `client_id`, `redirect_uri`, `code`, `code_verifier`;
- либо `grant_type=refresh_token`, `client_id`, `refresh_token`.

Сервер закрепляет собственные client ID и допустимые redirect URI, ограничивает размер/частоту запросов, не логирует тела/токены и не сохраняет их. Он получает актуальный token endpoint из официального Mail OpenID discovery, добавляет Basic `client_id:client_secret`, делает HTTPS POST и возвращает только `{ "access_token": "…", "refresh_token": "…", "expires_in": 3600 }`. Секрет хранится в серверном secret manager. Ошибки — HTTP 4xx/5xx без секретов. Ответы — `Cache-Control: no-store`. Broker не должен быть произвольным HTTP-прокси. Для Яндекса аналогичный endpoint обращается к официальному `/token`, добавляя credentials приложения; при PKCE сохраняет `code_verifier` в запросе.

Broker получает токены по необходимости обмена. Его эксплуатация и доверие к владельцу — обязательное условие этого варианта. Для полностью локальной установки используйте Яндекс PKCE с повторным входом или пароль приложения.

## Хранение и ограничения

Access/refresh token, срок действия и привязка к email/provider/client ID лежат одной записью `id:oauth` в системном vault. В SQLite только `auth.method` и provider. Токены не возвращаются в React и не выводятся в логи. Серверы OAuth закреплены за провайдером; редактирование сервера не может отправить токен другому хосту. Истёкший или отозванный доступ требует refresh либо повторного входа. Отзыв разрешения у провайдера выполняет пользователь; удаление аккаунта удаляет локальную запись vault.

Google/Microsoft представлены в provider model; их OAuth-адаптеры пока не реализованы. Gmail допускает пароль приложения при соответствующих настройках аккаунта. Outlook требует OAuth и не предлагает пароль как рабочую замену.

Реальная выдача токенов, ограничения регистрации loopback redirect, Mail IMAP/SMTP scope, refresh/отзыв и Windows Credential Manager требуют проверки с собственными зарегистрированными приложениями. Локальные проверки не подменяют такую проверку.
