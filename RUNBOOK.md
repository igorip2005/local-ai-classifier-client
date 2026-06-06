# Local AI Classifier Client Runbook

Operational procedures for the Client host-agent.

Source intent:

- Router `doc/CONCEPT.md` section 19 requires a runbook for connecting a new client and recovery after router/client failures.
- Router `doc/IMPLEMENTATION_DETAILS.md` sections 7, 20, 21, 23, 24 and 25 define client heartbeat, owner safety, privacy, runbooks, tests and trusted dev autodeploy.

Do not print private setup tokens, API keys, admin keys or SSH private keys in logs, process output or tickets.

## Install Client Host

1. Install Ollama on the client machine.
2. Pull the lightweight smoke model if the host will run CPU-only smoke tests:

```bash
ollama pull qwen2.5:0.5b
```

3. Prepare the repository:

```bash
cd /www/projects/local-ai-classifier-client
cp .env.example .env
npm install
npm run build
```

4. Configure `.env`:

```env
ROUTER_URL=ws://router-host:3100/v1/hosts/connect
SETUP_TOKEN=...
OLLAMA_BASE_URL=http://127.0.0.1:11434
CLIENT_LOCAL_LOG_MODE=none
CLIENT_ALLOW_MODEL_PULL=false
CLIENT_MAX_CONCURRENT_TASKS=1
CLIENT_MANUAL_ENABLED=true
CLIENT_STATUS_PORT=0
```

`CLIENT_LOCAL_LOG_MODE=none` is the privacy default. Use `metadata` or `full` only when explicitly approved for debugging.

5. Start a foreground smoke:

```bash
npm start
```

Expected signal on the router:

- host registers with a stable `host_id`;
- capabilities include discovered Ollama models or an explicit unavailable Ollama state;
- heartbeat includes owner availability and resource metrics.

## Install Linux User Service

Run on the client host:

```bash
npm run deploy:preflight
npm run deploy:install-service
CLIENT_DEPLOY_INSTALL_CONFIRM=1 npm run deploy:install-service
npm run deploy:service-status
npm run production:readiness
```

The install command is dry-run unless `CLIENT_DEPLOY_INSTALL_CONFIRM=1` is set.

Expected signal:

- `local-ai-classifier.service` is enabled and active;
- service uses `/www/projects/local-ai-classifier-client/.env`;
- service restarts automatically after failure.

## Production Readiness Gate

Run on each target client host after `.env` is configured and the user service
has been installed:

```bash
npm run production:readiness
```

Expected production signal:

- overall `status` is `pass`;
- `deploy-preflight` is `pass`, proving package scripts, service artifact and target-host `.env` are present;
- `systemd-user-service` is `pass`, proving `local-ai-classifier.service` is enabled and active.

Any `fail` means this client host is not ready for production acceptance. Fix
`deploy:preflight` or `deploy:service-status` before using it as a trusted
deploy/GPU acceptance target.

## Owner Controls

Pause this host before local heavy work:

```bash
npm start -- pause
```

Resume it:

```bash
npm start -- resume
```

Show local control state:

```bash
npm start -- status
```

If `CLIENT_STATUS_PORT` is configured, inspect local status:

```bash
curl -s http://127.0.0.1:$CLIENT_STATUS_PORT/status
```

Expected signal:

- paused host reports `manual_paused`;
- router does not assign new tasks while `can_accept_tasks=false`;
- resume returns the host to the pool after the next heartbeat.

## Ollama And Model Discovery

Check local Ollama:

```bash
curl -s http://127.0.0.1:11434/api/tags
```

When `CLIENT_ALLOW_MODEL_PULL=true`, the client can pull missing requested models before a task. Keep it `false` on production-like hosts unless model installation is intentionally delegated to the agent.

Expected signal:

- available models appear in router `/v1/models`;
- heartbeat `resources.ollama.available` reflects Ollama health;
- unavailable Ollama does not crash the agent and is surfaced in heartbeat.

## Client Recovery

After a client crash or host reboot:

1. Check systemd state:

```bash
npm run deploy:service-status
```

2. If needed, restart the user service:

```bash
systemctl --user restart local-ai-classifier.service
```

3. Confirm `CLIENT_DATA_DIR/host_id` still exists. Do not delete it during normal recovery.
4. Verify router `/v1/hosts` shows the same host online with fresh heartbeat.
5. Run a lightweight classify smoke from the router.

Expected signal:

- same `host_id` reconnects;
- stale socket on router does not replace the active socket;
- running tasks that were interrupted become visible as failed/retryable on the router.

## Debug Router Connection

Check:

1. `ROUTER_URL` uses `ws://` or `wss://` and points to `/v1/hosts/connect`.
2. `SETUP_TOKEN` is configured only for first registration or setup-token rotation.
3. Router is reachable from the client host.
4. Router logs show either `host_registered` or a setup-token/auth error.
5. Client reconnect backoff is active after router restart.

Useful local command:

```bash
npm start
```

Keep foreground output free of real token values.

## Debug Classification Failure

Check:

1. Ollama is reachable.
2. Requested model appears in `/api/tags` or model pull is intentionally enabled.
3. Router task payload has a short enough input for the target model.
4. Client can parse or repair model JSON output.
5. Local task logs are disabled or privacy-approved before collecting evidence.

Useful checks:

```bash
npm run classification:baseline
RUN_LOCAL_OLLAMA=1 CLASSIFICATION_MIN_ACCURACY=0.9 npm run classification:baseline
RUN_LOCAL_OLLAMA=1 npm run test:local-ollama
```

Use `qwen2.5:0.5b` only for lightweight smoke on CPU-only hosts.

## Trusted Dev Deploy Agent

The client deploy agent is opt-in and intended only for trusted test hosts.

Configure:

```env
CLIENT_DEPLOY_ENABLED=true
CLIENT_DEPLOY_COMMAND=/path/to/approved-deploy-script
CLIENT_DEPLOY_TIMEOUT_MS=120000
CLIENT_BUILD_ID=git-sha-or-build-id
```

Deploy command contract:

```text
CLIENT_DEPLOY_COMMAND ARTIFACT_PATH TARGET_VERSION DEPLOY_ID
```

Expected behavior:

- client downloads artifact from router-provided URL;
- SHA-256 must match before command execution;
- artifact is stored under `CLIENT_DATA_DIR/deploy`;
- rollback metadata is stored before command execution:
  - latest manifest: `CLIENT_DATA_DIR/deploy/rollback.json`;
  - per-deploy manifest: `CLIENT_DATA_DIR/deploy/DEPLOY_ID.rollback.json`;
  - manifest includes previous client version, previous build id, target version, local artifact path and artifact SHA-256;
  - manifest does not include the router-provided artifact URL because it may be signed or secret-bearing;
- result is reported as `deploy_result` over WebSocket;
- router marks reconnect success only after the host registers with the target version/build metadata.

Deploy scripts also receive:

```text
LOCAL_AI_DEPLOY_PREVIOUS_VERSION
LOCAL_AI_DEPLOY_PREVIOUS_BUILD_ID
LOCAL_AI_DEPLOY_ROLLBACK_MANIFEST
```

Rollback is manual in the MVP: use `CLIENT_DATA_DIR/deploy/rollback.json` to identify the previous version/build, then reinstall the corresponding trusted package or artifact and restart the user service.
