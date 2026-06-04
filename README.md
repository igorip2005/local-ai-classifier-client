# local-ai-classifier

Локальная HTTP-обёртка над Ollama для классификатора. Работает внутри LAN/Tailscale, проксирует запросы в Ollama и пишет в PostgreSQL:

- откуда пришёл запрос: IP, host, user-agent, forwarded-for;
- тело входящего запроса и ответа;
- модель Ollama;
- входящие/исходящие токены (`prompt_eval_count`, `eval_count`);
- длительность обработки в миллисекундах и секундах;
- CPU/system load/memory;
- процессы Ollama и их CPU delta;
- GPU telemetry через `nvidia-smi`: utilization, memory, temperature, power draw, clocks;
- примерную энергию GPU за запрос и CPU RAPL, если доступен `/sys/class/powercap`.

## Быстрый старт

```bash
cd /www/projects/local-ai-classifier
cp .env.example .env
npm install
npm run migrate
npm start
```

По умолчанию сервер слушает `0.0.0.0:3088`, то есть доступен в локалке/Tailscale, но не публикуется наружу сам по себе.

## PostgreSQL

Создай БД и пользователя, если их ещё нет:

```sql
CREATE USER local_ai_classifier WITH PASSWORD 'local_ai_classifier';
CREATE DATABASE local_ai_classifier OWNER local_ai_classifier;
```

Затем:

```bash
npm run migrate
```

## Endpoints

### Health

```bash
curl http://127.0.0.1:3088/health
```

### Chat proxy

```bash
curl -s http://127.0.0.1:3088/v1/chat \
  -H 'Content-Type: application/json' \
  -d '{
    "model":"qwen3:1.7b",
    "think":false,
    "stream":false,
    "messages":[{"role":"user","content":"Классифицируй: привет"}],
    "options":{"temperature":0,"num_ctx":4096}
  }'
```

Также поддерживаются совместимые пути:

- `POST /api/chat`
- `POST /v1/chat`
- `POST /api/generate`
- `POST /v1/generate`

Ответ дополняется:

```json
{
  "wrapper": {
    "request_id": "..."
  }
}
```

По этому id можно посмотреть запись:

```bash
curl http://127.0.0.1:3088/v1/requests/<request_id>
```

Список последних запросов:

```bash
curl http://127.0.0.1:3088/v1/requests?limit=50
```

## Важные env-параметры

```env
PORT=3088
HOST=0.0.0.0
OLLAMA_BASE_URL=http://127.0.0.1:11434
DEFAULT_MODEL=qwen3:1.7b
DEFAULT_THINK=false
DEFAULT_STREAM=false
DATABASE_URL=postgres://local_ai_classifier:local_ai_classifier@127.0.0.1:5432/local_ai_classifier
API_KEY=
NVIDIA_SMI_PATH=/usr/lib/wsl/lib/nvidia-smi
LOG_FULL_BODIES=true
```

Если нужно ограничить доступ ключом:

```env
API_KEY=some-secret
```

И в запросах добавлять:

```bash
-H 'x-api-key: some-secret'
```

## Примечания по электричеству

- GPU power берётся из `nvidia-smi power.draw`, энергия считается приблизительно по среднему power до/после запроса.
- CPU energy берётся из RAPL (`/sys/class/powercap`), если доступно. В WSL2 чаще всего недоступно, тогда поле будет `null`.
- Для точного power metering всего компьютера нужен внешний ваттметр/UPS API; софт внутри WSL не видит всё железо напрямую.
