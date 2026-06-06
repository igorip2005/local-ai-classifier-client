# local-ai-classifier-client

Локальный host-agent для проекта Local AI Classifier Router.

Client запускается на машине владельца рядом с Ollama, держит исходящее WebSocket-соединение с Router, сообщает `host_id`, capabilities, heartbeat и состояние доступности машины. В MVP client не открывает входящий публичный порт и по умолчанию не хранит локальные тексты запросов.

## Быстрый старт

```bash
cd /www/projects/local-ai-classifier-client
cp .env.example .env
npm install
npm start
```

По умолчанию client подключается к `ws://127.0.0.1:3100/v1/hosts/connect` и использует локальную Ollama `http://127.0.0.1:11434`.

Для production-like запуска `NODE_ENV=production` теперь требует явные host-настройки:

- `ROUTER_URL` должен указывать на реальный router, не local default;
- `CLIENT_NAME` должен идентифицировать конкретный host;
- `CLIENT_BUILD_ID` должен быть build/git id, не `dev`;
- если `CLIENT_DEPLOY_ENABLED=true`, нужно задать `CLIENT_DEPLOY_COMMAND`.

## Важные env-параметры

```env
ROUTER_URL=ws://127.0.0.1:3100/v1/hosts/connect
SETUP_TOKEN=
OLLAMA_BASE_URL=http://127.0.0.1:11434
CLIENT_NAME=local-test-client
CLIENT_LOCAL_LOG_MODE=none
CLIENT_MAX_CONCURRENT_TASKS=1
CLIENT_ALLOW_MODEL_PULL=false
CLIENT_MANUAL_ENABLED=true
CLIENT_FAST_HEARTBEAT_MS=5000
CLIENT_FULL_HEARTBEAT_MS=15000
CLIENT_DATA_DIR=/www/projects/local-ai-classifier-client/var
CLIENT_STATUS_PORT=0
```

`host_id` создаётся один раз и хранится в `CLIENT_DATA_DIR/host_id`.

## Owner controls

Владелец машины может временно выключить или включить участие client в обработке задач:

```bash
npm start -- pause
npm start -- resume
npm start -- status
```

Состояние хранится в `CLIENT_DATA_DIR/control.json` и отражается в heartbeat как `manual_paused`.

Если задан `CLIENT_STATUS_PORT`, client поднимает локальный status endpoint только на `127.0.0.1`:

```bash
curl http://127.0.0.1:$CLIENT_STATUS_PORT/status
```

## Примечания по электричеству

- Client отправляет только исходящее WebSocket-соединение к router.
- Локальное логирование запросов выключено режимом `CLIENT_LOCAL_LOG_MODE=none`.
- GPU telemetry берётся из `nvidia-smi`, если он доступен.
- Бизнес-логика взята из `/www/projects/local-ai-classifier-router/doc/IMPLEMENTATION_DETAILS.md`, разделы 5, 7, 15, 20, 21 и 24.

## Systemd deploy

Production-like установка client service на Linux test host выполняется явно и безопасно:

```bash
npm run deploy:preflight
npm run deploy:install-service
CLIENT_DEPLOY_INSTALL_CONFIRM=1 npm run deploy:install-service
npm run deploy:service-status
```

Без `CLIENT_DEPLOY_INSTALL_CONFIRM=1` install command работает как dry-run и только показывает planned commands.
