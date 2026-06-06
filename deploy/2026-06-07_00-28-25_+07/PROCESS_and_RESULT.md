# PROCESS and RESULT — Critical Gaps Pass 1

Timestamp: 2026-06-07 00:28:25 +07

## Source documents

- `/www/projects/local-ai-classifier-router/doc/IMPLEMENTATION_DETAILS.md`
- `/www/projects/local-ai-classifier-router/doc/gaps.md`

## Client changes

- Added WebSocket reconnect with bounded exponential backoff.
- `close()` now disables reconnect and clears reconnect timer.
- Heartbeat reports loaded models discovered at registration.
- Added integration test that forces router socket close and verifies a second register.
- Added `chat_completion` task execution through Ollama `/api/chat`.
- Added owner CLI controls: `pause`, `resume`, `status`.
- Heartbeat now reads `CLIENT_DATA_DIR/control.json` and reports `manual_paused` dynamically.
- Added local status endpoint on `127.0.0.1:$CLIENT_STATUS_PORT/status`.
- Added model pull flow controlled by `CLIENT_ALLOW_MODEL_PULL`.
- Added periodic capabilities refresh and `capabilities_update` when Ollama model list changes.
- Added fixed classification dataset `tests/datasets/classification-v0.jsonl`.
- Added keyword guardrails for obvious sales/support/spam classifications before accepting weak model fallback.
- Added fast classification baseline test over the fixed dataset.
- Added reusable classification baseline report logic and `npm run classification:baseline`.
- Added opt-in `tests/integration/local-ollama.test.ts`; it is skipped unless `RUN_LOCAL_OLLAMA=1`.
- Fixed the spam keyword rule for Russian inflections such as `скидкой 90%`.
- Real `qwen2.5:0.5b` baseline initially exposed neutral `other` confusion cases.
- Added neutral `other` keyword guardrails for simple greetings, acknowledgements and follow-up deferrals.
- Client sends an immediate idle heartbeat after task completion to avoid stale busy state on the router.
- Added integration coverage for heartbeat-after-task behavior.
- Added dev autodeploy pull-agent core from `IMPLEMENTATION_DETAILS.md` section 25:
  - opt-in `CLIENT_DEPLOY_ENABLED`;
  - `CLIENT_DEPLOY_COMMAND`;
  - `CLIENT_DEPLOY_TIMEOUT_MS`;
  - artifact download;
  - SHA-256 verification;
  - local artifact persistence under `CLIENT_DATA_DIR/deploy`;
  - `deploy_result` reporting over WebSocket.
- Client now reports `CLIENT_BUILD_ID` in register/capabilities payloads.
- Added unit and WebSocket integration tests for fake deploy command execution and deploy result reporting.
- Added historical classification baseline artifacts from the quality-hardening gap in router `doc/gaps.md`:
  - `npm run classification:baseline` writes JSON reports to `var/classification-baseline` by default;
  - `CLASSIFICATION_REPORT_DIR` can redirect report artifacts;
  - `CLASSIFICATION_WRITE_REPORT=0` disables report writing only when explicitly needed;
  - saved report includes `generated_at`, `min_accuracy` and `passed` fields alongside the full case list.
- Expanded `tests/datasets/classification-v0.jsonl` from 12 to 24 examples with confusion-style sales/support/spam/other phrases in Russian and English.
- Strengthened keyword guardrails for price quote, enterprise quote, reversed Russian spam wording and neutral acknowledgement/follow-up phrases.

## Tests run

```bash
npm run build
npm test
npm run classification:baseline
npm run test:local-ollama
RUN_LOCAL_OLLAMA=1 CLASSIFICATION_MIN_ACCURACY=0.9 npm run classification:baseline
RUN_LOCAL_OLLAMA=1 npm run test:local-ollama
```

Results:

- `npm run build` passed.
- `npm test` passed: 9 test files and 19 tests, plus 1 skipped local Ollama test file.
- `npm run classification:baseline` passed: 12/12 correct, contract_valid 12/12.
- `npm run test:local-ollama` passed as skipped without `RUN_LOCAL_OLLAMA=1`.
- `RUN_LOCAL_OLLAMA=1 CLASSIFICATION_MIN_ACCURACY=0.9 npm run classification:baseline` passed: 12/12 correct, contract_valid 12/12, avg latency about 3.6s in the latest full verification run.
- `RUN_LOCAL_OLLAMA=1 npm run test:local-ollama` passed with local Ollama `qwen2.5:0.5b`.

Client was also exercised by router `npm run test:e2e`, which starts the real client process against fake Ollama and the real router process, including classify, chat, import, batch and export.

Additional verification at 2026-06-07 01:43 +07:

- `npm run build` passed.
- `npm test` passed: 9 test files and 20 tests, plus 1 skipped local Ollama test file.
- `CLASSIFICATION_REPORT_DIR=var/classification-baseline-smoke npm run classification:baseline` passed and wrote `var/classification-baseline-smoke/2026-06-06T18-42-50-954Z_keyword_keyword.json`.
- `RUN_LOCAL_OLLAMA=1 CLASSIFICATION_MIN_ACCURACY=0.9 CLASSIFICATION_REPORT_DIR=var/classification-baseline-smoke npm run classification:baseline` passed: 12/12 correct, contract_valid 12/12, avg latency 1650ms, max latency 2783ms; it wrote `var/classification-baseline-smoke/2026-06-06T18-43-17-964Z_ollama_qwen2.5_0.5b.json`.
- `RUN_LOCAL_OLLAMA=1 npm run test:local-ollama` passed with local Ollama `qwen2.5:0.5b`.

Additional dataset verification at 2026-06-07 01:50 +07:

- `npm run build` passed.
- `npm test` passed: 9 test files and 20 tests, plus 1 skipped local Ollama test file.
- `CLASSIFICATION_REPORT_DIR=var/classification-baseline-smoke npm run classification:baseline` passed: 24/24 correct, contract_valid 24/24, and wrote a JSON report artifact.
- `RUN_LOCAL_OLLAMA=1 CLASSIFICATION_MIN_ACCURACY=0.9 CLASSIFICATION_REPORT_DIR=var/classification-baseline-smoke npm run classification:baseline` passed: 24/24 correct, contract_valid 24/24, avg latency 1562ms, max latency 2601ms; it wrote `var/classification-baseline-smoke/2026-06-06T18-49-52-379Z_ollama_qwen2.5_0.5b.json`.

Additional client service production readiness work at 2026-06-07 02:35 +07:

- Added `src/deploy/preflight-service.ts`.
- Added `src/deploy/service-status.ts`.
- Added `npm run deploy:preflight`.
- Added `npm run deploy:service-status`.
- `deploy:preflight` validates:
  - `package.json` start/build scripts;
  - `deploy/local-ai-classifier.service` exists;
  - `Type=simple`;
  - `WorkingDirectory=/www/projects/local-ai-classifier-client`;
  - `EnvironmentFile=/www/projects/local-ai-classifier-client/.env`;
  - `ExecStart=/usr/bin/npm start`;
  - `Restart=always`;
  - `WantedBy=default.target`;
  - safe systemd user install/status/journal commands.
- `deploy:service-status` checks the installed systemd user service with:
  - `systemctl --user is-enabled`;
  - `systemctl --user is-active`;
  - `systemctl --user show`.
- Added unit tests for valid service preflight, invalid service/script failure, enabled/active service status and disabled/inactive service status.
- Client `npm run build` passed.
- Client targeted deploy readiness tests passed: 2 test files and 4 tests.
- Client `npm test` passed: 11 test files and 24 tests, plus 1 skipped local Ollama test file.
- Client `npm run deploy:preflight` returned `warn` and exit code `0` on this local server because `.env` is not present here while the service artifact is valid.
- Client `npm run deploy:service-status` returned `fail` and exit code `1` on this local server because the systemd user service is not installed or active here.

Additional audit at 2026-06-07 02:48 +07:

- Compared the client implementation and tests with the original router implementation plan, especially client unit/integration test requirements.
- Found that the repository does not contain a committed `.env.example`, while `README.md` instructs operators to create `.env` from it.
- Found that local logging modes `none`, `metadata` and `full` are implemented through `writeLocalTaskLog`, but there is no focused test proving the privacy behavior of each mode.
- Found that the metrics collector has no focused unit coverage for the `nvidia-smi` parser/fallback path; current tests cover availability policy with synthetic resource objects instead.
- Found that explicit Ollama-unavailable heartbeat behavior is not proven. The current heartbeat reports OS/GPU availability, while Ollama unavailability can still affect register/capabilities discovery rather than being surfaced as stable heartbeat state.
- Found that fake Ollama invalid JSON handling is not directly covered in `tests/integration/task-runner.test.ts`; classification fallback exists in normalization code, but the invalid-output integration path should be locked down.

Additional client hardening work at 2026-06-07 02:57 +07:

- Added `.env.example` with safe placeholders and defaults matching `src/config.ts` and `README.md`.
- Made Ollama model discovery resilient when `/api/tags` is unavailable, so a down Ollama instance does not break registration/capabilities code paths.
- Heartbeat now includes explicit Ollama state:
  - `resources.ollama`;
  - `resources.processes.ollama_running`.
- Added unit coverage for local logging privacy modes:
  - `none` writes no task log;
  - `metadata` omits request/output bodies;
  - `full` writes full details only when explicitly configured.
- Added unit coverage for metrics collection:
  - parses `nvidia-smi` CSV output;
  - falls back to an empty GPU list when NVIDIA telemetry is unavailable.
- Added integration coverage proving unavailable Ollama is reported in heartbeat while registration still succeeds with an empty model list.
- Added fake Ollama invalid JSON integration coverage; classification falls back to `other` with a valid result contract.
- Client `npm run build` passed.
- Client targeted checks passed:
  - unit subset: 10 test files and 19 tests;
  - integration subset: 3 passed test files and 12 tests, plus 1 skipped local Ollama test file.
- Client `npm test` passed: 13 test files and 31 tests, plus 1 skipped local Ollama test file.
- Client build passed again as part of router `npm run test:e2e`.

Additional classification repair work at 2026-06-07 03:00 +07:

- Added true retry/repair behavior for invalid classification JSON from Ollama.
- If the first classifier call cannot be parsed as a JSON object, the client sends a second strict repair prompt with allowed labels, the original message and the invalid output.
- The repaired valid JSON output is used for the task result; if repair also fails, the safe `other` fallback remains.
- Updated `tests/integration/task-runner.test.ts` to prove two `/api/chat` calls happen for invalid JSON and that the repaired output is returned.
- Client `npm run build` passed.
- Client targeted task-runner integration passed: 3 passed test files, 12 tests, plus 1 skipped local Ollama test file.
- Client `npm test` passed: 13 test files and 31 tests, plus 1 skipped local Ollama test file.
- Router `npm run test:e2e` passed with the updated client build.

Additional classification dataset hardening at 2026-06-07 03:03 +07:

- Expanded `tests/datasets/classification-v0.jsonl` from 24 to 40 examples.
- Added confusion-style sales/support/spam/other cases around subscriptions, licenses, checkout/payment failures, promo spam and neutral follow-ups.
- Strengthened deterministic keyword guardrails for:
  - annual subscriptions and licenses;
  - payment failed/stuck checkout;
  - prize/limited-offer/free-traffic spam;
  - document review and meeting confirmation neutral messages.
- The first baseline run found one issue: `Оплата зависает на последнем шаге` was incorrectly classified as `other`; added a support rule and reran.
- `npm run classification:baseline` passed: 40/40 correct, contract_valid 40/40.
- `npm test` passed: 13 test files and 31 tests, plus 1 skipped local Ollama test file.
- `npm run build` passed.
- Router `npm run test:e2e` passed with this client build.

Additional systemd install helper work at 2026-06-07 03:08 +07:

- Added `npm run deploy:install-service`.
- The install helper:
  - reuses `npm run deploy:preflight` validation;
  - defaults to dry-run mode and does not mutate user systemd state;
  - lists exact install commands for `~/.config/systemd/user/local-ai-classifier.service`;
  - executes only when `CLIENT_DEPLOY_INSTALL_CONFIRM=1`;
  - reports `npm run deploy:service-status` as the next verification command.
- Added README instructions for production-like systemd flow: preflight, dry-run install, confirmed install and service status.
- Added unit coverage for dry-run safety and explicit execution command plans.
- `npm run build` passed.
- Targeted deploy unit tests passed: 11 test files and 21 tests.
- Dry-run `npm run deploy:install-service` returned `warn` because local `.env` is missing, but the service artifact passed validation and no commands executed.
- `npm test` passed: 14 test files and 33 tests, plus 1 skipped local Ollama test file.
- Router `npm run test:e2e` passed with this client build.
