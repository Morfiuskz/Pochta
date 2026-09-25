# Mail OAuth broker

Минимальный stateless broker для `https://oauth.morfius.ru/mail/token`. Он принимает только два OAuth grant (`authorization_code` и `refresh_token`), закрепляет Client ID и redirect URI приложения «Почта», добавляет Client Secret через HTTP Basic и обращается только к `https://o2.mail.ru/api/v1/oidc/token/issue`.

Broker не хранит почту или токены, не использует БД и не логирует запросы. Секрет читается только из `MAIL_OAUTH_CLIENT_SECRET`. Встроенный rate limit — 30 token-запросов в минуту на IP для одного процесса; nginx дополнительно ограничивает внешний endpoint.

## Локальная проверка сборки

Требуется Node.js 22:

```sh
cd broker
npm ci
npm run typecheck
npm run build
MAIL_OAUTH_CLIENT_SECRET=test-only node dist/server.js
curl --fail http://127.0.0.1:8787/health
```

Не отправляйте тестовый token request с настоящим authorization code без необходимости: код одноразовый.

## Ubuntu VPS

DNS-запись `oauth.morfius.ru` должна указывать на VPS; TCP 80/443 должны быть доступны извне.

```sh
sudo apt-get update
sudo apt-get install -y ca-certificates curl rsync nginx certbot python3-certbot-nginx
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

sudo useradd --system --home /opt/pochta-oauth-broker --shell /usr/sbin/nologin pochta-oauth
sudo mkdir -p /opt/pochta-oauth-broker
sudo rsync -a --delete --exclude node_modules --exclude dist broker/ /opt/pochta-oauth-broker/
sudo chown -R pochta-oauth:pochta-oauth /opt/pochta-oauth-broker
sudo -u pochta-oauth npm ci --prefix /opt/pochta-oauth-broker
sudo -u pochta-oauth npm run build --prefix /opt/pochta-oauth-broker
```

Создайте секрет вне репозитория:

```sh
sudo install -m 600 -o root -g root /dev/null /etc/pochta-oauth-broker.env
sudoedit /etc/pochta-oauth-broker.env
```

Содержимое файла:

```dotenv
MAIL_OAUTH_CLIENT_SECRET=<секрет из кабинета OAuth Mail>
```

Установите unit и nginx-конфигурацию из репозитория:

```sh
sudo cp broker/deploy/pochta-oauth-broker.service /etc/systemd/system/
sudo cp broker/deploy/nginx.conf /etc/nginx/sites-available/pochta-oauth-broker
sudo ln -s /etc/nginx/sites-available/pochta-oauth-broker /etc/nginx/sites-enabled/pochta-oauth-broker
sudo nginx -t
sudo systemctl daemon-reload
sudo systemctl enable --now pochta-oauth-broker
sudo systemctl reload nginx
curl --fail http://127.0.0.1:8787/health
```

После успешного HTTP-запуска получите сертификат и проверьте внешний health endpoint:

```sh
sudo certbot --nginx -d oauth.morfius.ru --redirect
curl --fail https://oauth.morfius.ru/health
```

Обновление после `git pull`:

```sh
sudo rsync -a --delete --exclude node_modules --exclude dist broker/ /opt/pochta-oauth-broker/
sudo chown -R pochta-oauth:pochta-oauth /opt/pochta-oauth-broker
sudo -u pochta-oauth npm ci --prefix /opt/pochta-oauth-broker
sudo -u pochta-oauth npm run build --prefix /opt/pochta-oauth-broker
sudo systemctl restart pochta-oauth-broker
```

Не выводите environment-файл через `cat`, не добавляйте request-body logging в Node/nginx и не передавайте Client Secret в desktop `oauth.json`.
