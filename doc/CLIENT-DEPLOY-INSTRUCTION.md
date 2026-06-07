# Local AI Classifier Client deploy instruction

Цель: развернуть client-агент Local AI Classifier на дочернем Linux-хосте в стандартный путь `/www/projects/local-ai-classifier-client`, подключить его к router и поставить user systemd service.

Не печатай приватный deploy key, `SETUP_TOKEN`, API keys или содержимое `.env` в чат/лог. Если команда падает, показывай только redacted error.

## Входные данные

Перед стартом нужны:

- `ROUTER_URL` в формате `ws://HOST:3100/v1/hosts/connect` или `wss://HOST/v1/hosts/connect`;
- `SETUP_TOKEN` для первой регистрации host;
- приватный deploy key для repo `igorip2005/local-ai-classifier-client`, переданный отдельно как secret;
- имя машины для `CLIENT_NAME`, например `gpu-client-01`.

## Команды deploy

Выполнять на дочернем client-хосте:

```bash
set -euo pipefail

APP_USER="${APP_USER:-igor}"
APP_DIR="/www/projects/local-ai-classifier-client"
APP_HOME="$(getent passwd "$APP_USER" | cut -d: -f6)"
KEY_DIR="$APP_HOME/.ssh/local-ai-classifier-client"
KEY_PATH="$KEY_DIR/local_ai_classifier_client_github_ed25519"
KNOWN_HOSTS="$KEY_DIR/known_hosts"

sudo mkdir -p /www/projects
sudo chown -R "$APP_USER:$APP_USER" /www/projects

sudo -u "$APP_USER" mkdir -p "$KEY_DIR"
sudo -u "$APP_USER" chmod 700 "$KEY_DIR"

# Вставь приватный deploy key вместо <CLIENT_DEPLOY_PRIVATE_KEY>.
# Не отправляй этот ключ в общий чат и не коммить его в git.
sudo -u "$APP_USER" tee "$KEY_PATH" >/dev/null <<'EOF'
<CLIENT_DEPLOY_PRIVATE_KEY>
EOF
sudo -u "$APP_USER" chmod 600 "$KEY_PATH"

sudo -u "$APP_USER" ssh-keyscan github.com >> "$KNOWN_HOSTS"
sudo -u "$APP_USER" chmod 600 "$KNOWN_HOSTS"

if [ ! -d "$APP_DIR/.git" ]; then
  sudo -u "$APP_USER" GIT_SSH_COMMAND="ssh -i $KEY_PATH -o IdentitiesOnly=yes -o UserKnownHostsFile=$KNOWN_HOSTS" \
    git clone git@github.com:igorip2005/local-ai-classifier-client.git "$APP_DIR"
else
  sudo -u "$APP_USER" git -C "$APP_DIR" remote set-url origin git@github.com:igorip2005/local-ai-classifier-client.git
  sudo -u "$APP_USER" GIT_SSH_COMMAND="ssh -i $KEY_PATH -o IdentitiesOnly=yes -o UserKnownHostsFile=$KNOWN_HOSTS" \
    git -C "$APP_DIR" pull --ff-only origin main
fi
sudo -u "$APP_USER" git -C "$APP_DIR" config core.sshCommand "ssh -i $KEY_PATH -o IdentitiesOnly=yes -o UserKnownHostsFile=$KNOWN_HOSTS"

cd "$APP_DIR"
```

Если на хосте еще нет Node.js/npm, установить Node.js 20+ или 24 LTS. Для Ubuntu/Debian простой вариант:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
node --version || curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
node --version || sudo apt-get install -y nodejs
npm --version
```

Дальше настроить и собрать client:

```bash
cd /www/projects/local-ai-classifier-client
cp .env.example .env

# Отредактируй значения под конкретный host.
nano .env
```

Минимальный production-like `.env`:

```env
NODE_ENV=production
ROUTER_URL=ws://ROUTER_HOST:3100/v1/hosts/connect
SETUP_TOKEN=PASTE_SETUP_TOKEN_HERE
OLLAMA_BASE_URL=http://127.0.0.1:11434

CLIENT_NAME=gpu-client-01
CLIENT_BUILD_ID=git-main
CLIENT_LOCAL_LOG_MODE=none
CLIENT_MAX_CONCURRENT_TASKS=1
CLIENT_ALLOW_MODEL_PULL=false
CLIENT_MANUAL_ENABLED=true
CLIENT_FAST_HEARTBEAT_MS=5000
CLIENT_FULL_HEARTBEAT_MS=15000
CLIENT_DATA_DIR=/www/projects/local-ai-classifier-client/var
CLIENT_STATUS_PORT=0

CLIENT_DEPLOY_ENABLED=false
CLIENT_DEPLOY_TIMEOUT_MS=120000
LOG_LEVEL=info
```

Установить зависимости, собрать и проверить:

```bash
cd /www/projects/local-ai-classifier-client
npm ci
npm run build
npm test
npm run deploy:preflight
```

Поставить user systemd service:

```bash
cd /www/projects/local-ai-classifier-client
npm run deploy:install-service
CLIENT_DEPLOY_INSTALL_CONFIRM=1 npm run deploy:install-service
npm run deploy:service-status
npm run production:readiness
CLIENT_REPORT_KIND=production-readiness CLIENT_REPORT_LIMIT=1 npm run deploy:reports
```

Если user service не стартует после logout, включить linger для пользователя:

```bash
sudo loginctl enable-linger "$APP_USER"
systemctl --user daemon-reload
systemctl --user restart local-ai-classifier.service
```

## Проверка результата

На client-хосте:

```bash
systemctl --user status local-ai-classifier.service --no-pager
journalctl --user -u local-ai-classifier.service -n 100 --no-pager
npm run deploy:service-status
npm run production:readiness
```

Ожидаемый результат:

- `local-ai-classifier.service` enabled и active;
- `production:readiness` возвращает overall `pass`;
- router видит новый host с тем же `CLIENT_NAME`;
- client heartbeat показывает Ollama state и `manual_paused=false`;
- `CLIENT_LOCAL_LOG_MODE=none`, тексты запросов локально не пишутся.

## Управление host

```bash
cd /www/projects/local-ai-classifier-client
npm start -- status
npm start -- pause
npm start -- resume
```

`pause` использовать перед тяжелой локальной работой на GPU/CPU. `resume` возвращает машину в pool после следующего heartbeat.

## Recovery

```bash
cd /www/projects/local-ai-classifier-client
git pull --ff-only origin main
npm ci
npm run build
systemctl --user restart local-ai-classifier.service
npm run production:readiness
```

Не удаляй `/www/projects/local-ai-classifier-client/var/host_id` при обычном recovery, иначе router увидит host как новую машину.
