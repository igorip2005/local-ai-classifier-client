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
```

`host_id` создаётся один раз и хранится в `CLIENT_DATA_DIR/host_id`.

## Примечания по электричеству

- Client отправляет только исходящее WebSocket-соединение к router.
- Локальное логирование запросов выключено режимом `CLIENT_LOCAL_LOG_MODE=none`.
- GPU telemetry берётся из `nvidia-smi`, если он доступен.
- Бизнес-логика взята из `/www/projects/local-ai-classifier-router/doc/IMPLEMENTATION_DETAILS.md`, разделы 5, 7, 15, 20, 21 и 24.
