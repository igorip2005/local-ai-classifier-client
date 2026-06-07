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

Additional operational runbook and real baseline verification at 2026-06-07 03:17 +07:

- Added client `RUNBOOK.md` from the operational requirements in router `doc/CONCEPT.md` section 19 and `doc/IMPLEMENTATION_DETAILS.md` sections 7, 20, 21, 23, 24 and 25.
- The runbook documents:
  - installing a client host;
  - installing the Linux user service through the safe dry-run/confirmed helper flow;
  - owner pause/resume/status controls;
  - Ollama health and model discovery;
  - client recovery after crash/reboot;
  - router connection debugging;
  - classification failure debugging;
  - trusted dev deploy agent configuration and command contract.
- Added `tests/unit/runbook-docs.test.ts` to keep required sections and critical commands present.
- Refreshed real `qwen2.5:0.5b` baseline on the current 40-case dataset.

Verification:

- Targeted runbook docs test passed: 12 unit test files and 22 tests.
- Real Ollama classification baseline passed: 40/40 correct, contract_valid 40/40, avg latency 1514ms, max latency 4872ms; report written under `var/classification-baseline-smoke`.
- `npm run build` passed.
- `npm test` passed: 15 test files and 34 tests, plus 1 skipped local Ollama test file.
- Router `npm run test:e2e` passed with this client build.

Still external/not locally provable:

- Client user service must still be installed and verified on each target client host.
- Trusted deploy acceptance must run against a configured external trusted host.
- Distributed GPU acceptance must run against 2+ real GPU clients.

Client connection-error log hardening at 2026-06-07 07:36 +07:

- Continued the production log/privacy audit from router `doc/gaps.md`.
- Found that `src/main.ts` logged raw `Error` objects for `router_connection_error`.
- A WebSocket/transport failure can include router URLs, token-like text or local stack traces, so raw serialization is not acceptable for production logs under `doc/IMPLEMENTATION_DETAILS.md` sections 12, 20 and 22.
- Added `safeLogError` in `src/logger.ts`.
- `safeLogError` keeps bounded diagnostic fields and redacts:
  - bearer tokens;
  - API/setup/access token-like values;
  - URL query strings;
  - stack traces.
- `router_connection_error` now logs `error: safeLogError(error)` instead of raw `err`.
- Added logger unit coverage proving secret-bearing connection errors and stack text are not serialized.

Verification:

- Client targeted logger test passed: 1 test file and 2 tests.
- Client `npm run build` passed.
- Client `npm test` passed: 20 passed test files and 58 passed tests, plus 1 skipped opt-in local Ollama test file.
- Router `npm run test:e2e` passed with this client build: classify, chat, JSONL/CSV import, batch, export and deploy.
- Post-fix grep found no client production logger calls that pass raw `err: error`.

Still external/not locally provable:

- Client user service must still be installed and verified on each target client host.
- Trusted deploy acceptance must run against a configured external trusted host.
- Distributed GPU acceptance must run against 2+ real GPU clients.

## Final audit snapshot — 2026-06-07 07:10 +07

User asked to re-find what is not done normally and what is not tested against the initial project documentation.

Checked router `doc/CONCEPT.md`, router `doc/IMPLEMENTATION_DETAILS.md`, current client package scripts and test inventory, client runbook/readiness tooling, and fail-closed client production readiness commands.

Result:

- Client skeleton and local behavior required for MVP are implemented: persistent `host_id`, Ollama health/model discovery, WebSocket register/heartbeat, capabilities updates, owner pause/status controls, local logging modes, task execution, cancellation, model pull, deploy command handling and production service helpers.
- No new local code-only missing phase was identified in this audit.
- Remaining client production gap is target-host evidence, not local source-code presence.

Commands run and observed:

- Client `npm run production:readiness` returned expected exit code `1` with status `fail` and wrote a private production-readiness report artifact.
- Client `npm run deploy:service-status` returned expected exit code `1` with status `fail`; `local-ai-classifier.service` is not enabled/active locally.

Still not verified:

- Target client host `.env` exists and contains real production values.
- `local-ai-classifier.service` is installed, enabled and active on each real client host.
- Trusted deploy acceptance has not been run against a configured external trusted host.
- Distributed GPU acceptance depends on router-side external 2+ GPU clients.
- Classification quality needs ongoing expansion from real production confusion cases beyond the current fixed dataset.

No runtime code changed in this audit snapshot.

## Classification baseline CLI failure redaction — 2026-06-07 07:26 +07

Rechecked `npm run classification:baseline` against router `doc/IMPLEMENTATION_DETAILS.md` sections 21, 24 and 27.

Found:

- The baseline command no longer prints `cases[].text` by default, but top-level command failures were still unhandled.
- Dataset read failures, config validation failures or Ollama/proxy failures could print raw Node stack traces to stderr.
- Risk: a failed command could expose a signed dataset URL, token-like value or copied environment text before the normal summary-only baseline output exists.

Fixed in the client repo:

- Wrapped the baseline command in a top-level safe failure handler.
- Failure output is now a short JSON object with `status: "fail"` and redacted error name/message.
- Redaction uses the existing deploy output redaction helper for signed URL query strings, bearer tokens and token-like fields.
- Added CLI regression coverage for a failing dataset path containing a signed URL token.

Verification:

- Client `npm run build` passed.
- Client targeted classification CLI/quality tests passed: 2 test files and 5 tests.
- Client `npm test` passed: 20 passed test files and 57 passed tests, plus 1 skipped opt-in local Ollama test file.
- Client `git diff --check` passed.

## Audit snapshot — 2026-06-07 07:10 +07

User asked to re-find what is not done normally and what is not tested against the initial project documentation.

Checked:

- router `doc/CONCEPT.md`;
- router `doc/IMPLEMENTATION_DETAILS.md`, especially client skeleton, owner controls, deploy, acceptance and Definition of Done sections;
- current client package scripts and test inventory;
- client runbook/readiness tooling;
- fail-closed client production readiness commands.

Result:

- Client skeleton and local behavior required for MVP are implemented: persistent `host_id`, Ollama health/model discovery, WebSocket register/heartbeat, capabilities updates, owner pause/status controls, local logging modes, task execution, cancellation, model pull, deploy command handling and production service helpers.
- No new local code-only missing phase was identified in this audit.
- Remaining client production gap is target-host evidence, not local source-code presence.

Commands run and observed:

- Client `npm run production:readiness` returned expected exit code `1` with status `fail` and wrote a private production-readiness report artifact.
- Client `npm run deploy:service-status` returned expected exit code `1` with status `fail`; `local-ai-classifier.service` is not enabled/active locally.

Still not verified:

- Target client host `.env` exists and contains real production values.
- `local-ai-classifier.service` is installed, enabled and active on each real client host.
- Trusted deploy acceptance has not been run against a configured external trusted host.
- Distributed GPU acceptance depends on router-side external 2+ GPU clients.
- Classification quality needs ongoing expansion from real production confusion cases beyond the current fixed dataset.

No runtime code changed in this audit snapshot.

Additional client production readiness gate at 2026-06-07 06:46 +07:

- Rechecked the remaining client production gap from router `doc/gaps.md`: client systemd user service is not proven installed/enabled on target client hosts.
- Found that client had `deploy:preflight` and `deploy:service-status`, but no single fail-closed command that says a target client host is production-ready.
- Fixed in the client repo:
  - added `src/deploy/production-readiness.ts`;
  - added `npm run production:readiness`;
  - added unit coverage for pass, preflight-warning fail and service-status fail;
  - updated `RUNBOOK.md` and `README.md`.
- Business logic: build/test success does not prove a client host is ready. The gate returns `pass` only when deploy preflight passes without warnings and the systemd user service is enabled and active.
- Source basis: router `doc/IMPLEMENTATION_DETAILS.md` sections 20, 23, 24 and 25, plus router `doc/gaps.md` target-host client service gap.

Verification:

- Client `npm run build` passed.
- Client targeted production-readiness/runbook/deploy readiness tests passed: 4 test files and 9 tests.
- Client `npm run production:readiness` correctly returned `fail` and exit code `1` on this local server because target `.env` and systemd user service evidence are absent.
- Client `npm test` passed: 18 test files and 52 tests passed, plus 1 skipped opt-in local Ollama test file.
- Client `git diff --check` passed.

Additional client production readiness report artifact work at 2026-06-07 06:57 +07:

- Rechecked client production readiness as target-host evidence.
- Found that `npm run production:readiness` returned live status, but did not persist a durable local report artifact.
- Risk: target client host readiness evidence could be lost unless copied manually from terminal output.
- Fixed in the client repo:
  - added `src/deploy/report-service.ts`;
  - added `npm run deploy:reports`;
  - `npm run production:readiness` now writes a private `production-readiness` JSON artifact under `CLIENT_REPORT_DIR` or `var/reports`;
  - output includes `report_path`;
  - `CLIENT_REPORT_KIND=production-readiness CLIENT_REPORT_LIMIT=1 npm run deploy:reports` lists the latest host-readiness report;
  - updated `RUNBOOK.md` and `README.md`.
- Business logic: client host production readiness from router `doc/IMPLEMENTATION_DETAILS.md` sections 20, 23, 24 and 25 needs durable local evidence on each target host, not only terminal output.

Verification:

- Client `npm run build` passed.
- Client targeted report/readiness/runbook tests passed: 3 test files and 6 tests.
- Client `npm run production:readiness` with a temporary `CLIENT_REPORT_DIR` correctly returned `fail` and exit code `1` on this local server, wrote a private `production-readiness` report artifact and exposed it through `CLIENT_REPORT_KIND=production-readiness CLIENT_REPORT_LIMIT=1 npm run deploy:reports`.
- Client `npm test` passed: 19 test files and 54 tests passed, plus 1 skipped opt-in local Ollama test file.
- Client `git diff --check` passed.

Additional client deploy report output redaction hardening at 2026-06-07 07:01 +07:

- Rechecked the new client `npm run deploy:reports` output path.
- Found that private report artifacts are durable audit files, but report listing returned payload values directly.
- Risk: an older/manual client report artifact could contain a signed artifact URL, bearer token, setup token or API key and print it through `deploy:reports`.
- Fixed in the client repo:
  - added recursive payload redaction in `src/deploy/report-service.ts` when reports are read/listed;
  - sensitive keys and secret-bearing strings are redacted before report payloads are returned;
  - signed URL query strings are redacted;
  - private report files remain unchanged as durable audit sources; only CLI/list output is sanitized;
  - added unit coverage proving old/manual report payloads with raw signed URLs and token-like values are redacted in report listings.

Verification:

- Client `npm run build` passed.
- Client targeted deploy report tests passed: 1 test file and 3 tests.
- Client `npm test` passed: 19 test files and 55 tests passed, plus 1 skipped opt-in local Ollama test file.
- Client `git diff --check` passed.

Additional classification baseline privacy hardening at 2026-06-07 07:06 +07:

- Rechecked `npm run classification:baseline` output and artifacts against router `doc/IMPLEMENTATION_DETAILS.md` sections 20, 22 and 27.
- Found that baseline reports include `cases[].text`, and the CLI printed the full report to stdout by default.
- Found that saved baseline artifacts were not explicitly private files.
- Risk: when operators run the baseline on a real or customer-derived dataset, raw message text could be copied from terminal output or stored with default file permissions.
- Fixed in the client repo:
  - default console output is summary-only and omits `cases`;
  - full case output now requires explicit `CLASSIFICATION_PRINT_CASES=1`;
  - saved baseline report directories use private `0700` mode;
  - saved baseline report files use private `0600` mode;
  - updated `RUNBOOK.md` and `README.md` with the privacy behavior.

Verification:

- Client `npm run build` passed.
- Client targeted classification/runbook tests passed: 2 test files and 5 tests.
- Client `npm run classification:baseline` smoke passed with a temporary `CLASSIFICATION_REPORT_DIR`; stdout omitted `cases`, while the private artifact kept full cases.
- Client `npm test` passed: 19 test files and 56 tests passed, plus 1 skipped opt-in local Ollama test file.
- Client `git diff --check` passed.

Additional client deploy/status output redaction hardening at 2026-06-07 06:36 +07:

- Rechecked client production service tooling against router `doc/IMPLEMENTATION_DETAILS.md` sections 20, 23, 24, 25 and 27.
- Found that `deploy:service-status` and confirmed `deploy:install-service` reports included raw child-process stdout/stderr/error text.
- Risk: if `systemctl` or a local command printed token-like text or a signed artifact URL, the JSON report could leak it into terminal output or tickets.
- Fixed in the client repo:
  - added deploy output redaction helper;
  - `deploy:service-status` redacts systemctl stdout/stderr/error before composing failed check messages;
  - `deploy:install-service` redacts command stdout, stderr and error fields in execution steps;
  - redaction covers bearer tokens, API/admin/setup tokens, generic token/signature fields and signed URL query strings.

Verification:

- Client `npm run build` passed.
- Client targeted deploy status/install tests passed: 2 passed test files and 6 tests.
- Client `npm test` passed: 17 passed test files and 49 passed tests, plus 1 skipped opt-in local Ollama test file.
- Router `npm run test:e2e` passed with this client build: classify, chat, JSONL/CSV import, batch, export and deploy with fake Ollama.
- `git diff --check` passed in both repos.

Additional task failure privacy hardening at 2026-06-07 05:51 +07:

- Rechecked client task error reporting against router `doc/IMPLEMENTATION_DETAILS.md` sections 20 and 22.
- Found that `RouterConnection` forwarded raw task execution `error.message` in outbound `task_error`.
- Risk: local Ollama/proxy failures can include upstream response body text, and that body may contain prompt/message text or secret-like values; router persists task errors.
- Fixed in the client repo:
  - task execution failures are mapped to stable safe codes/messages before being sent to the router;
  - model availability errors use `model_not_available`;
  - unsupported task kind errors use `unsupported_task_kind`;
  - Ollama HTTP failures use `ollama_request_failed`;
  - fetch/abort-style local availability failures use `ollama_unavailable`;
  - generic unexpected failures use `task_failed`;
  - cancellation still returns the explicit safe `task_canceled`.
- Added integration coverage with a fake Ollama 500 response containing prompt text and a secret-like value; outbound `task_error` contains only the safe `ollama_request_failed` message.

Verification:

- Client `npm run build` passed.
- Client targeted router-connection integration passed: 1 test file and 12 tests.

Additional audit verification at 2026-06-07 05:41 +07:

- Rechecked the client side of `doc/IMPLEMENTATION_DETAILS.md` sections 15, 24 and 25 while auditing unfinished/not-tested items.
- No new client code change was needed in this pass.
- Client remains covered for:
  - host_id persistence;
  - fake router WebSocket register/heartbeat/reconnect;
  - Ollama health/model parsing;
  - task execution, cancellation and deploy command handling;
  - local status endpoint;
  - production config hardening and secret redaction.

Verification:

- Client `npm run build` passed.
- Client `npm test` passed: 17 passed test files and 46 passed tests, plus 1 skipped opt-in local Ollama test.
- Client `RUN_LOCAL_OLLAMA=1 npm run test:local-ollama` passed with real `qwen2.5:0.5b`.
- Router local e2e passed with this client build after the router deploy smoke readiness fix.

Still external/not locally provable:

- Client user service must still be installed and verified on each target client host.
- Trusted deploy acceptance must run against a configured external trusted host.
- Distributed GPU acceptance must run against 2+ real GPU clients.

Additional client production config hardening at 2026-06-07 05:04 +07:

- Rechecked client config against router `doc/IMPLEMENTATION_DETAILS.md` sections 15, 17, 20, 21, 24 and 25.
- Found that `.env.example` used `NODE_ENV=production` with local development defaults, and `loadConfig` allowed those defaults in production.
- Risk: a production client could accidentally run as `local-test-client`, report build id `dev`, connect to a local router URL, or enable trusted deploy without a command.
- Fixed in the client repo:
  - production config rejects the local default `ROUTER_URL`;
  - production config rejects default `CLIENT_NAME=local-test-client`;
  - production config rejects default `CLIENT_BUILD_ID=dev`;
  - production config validates optional setup token length when provided;
  - production config requires `CLIENT_DEPLOY_COMMAND` when `CLIENT_DEPLOY_ENABLED=true`;
  - `.env.example` is now local-development by default and documents production replacements.
- Updated README with production config requirements.

Verification:

- Client `npm run build` passed.
- Client targeted config unit test passed: 1 test file and 4 tests.
- Client `npm test` passed: 17 passed test files and 44 passed tests, plus 1 skipped local Ollama test file.
- Router `npm run test:e2e` passed with this client build: classify, chat, import, batch, export and deploy with fake Ollama.

Still external/not locally provable:

- Client user service must still be installed and verified on each target client host.
- Trusted deploy acceptance must run against a configured external trusted host.
- Distributed GPU acceptance must run against 2+ real GPU clients.

Additional audit and logger redaction hardening at 2026-06-07 03:39 +07:

- Rechecked client implementation against router `doc/IMPLEMENTATION_DETAILS.md` testing and privacy requirements.
- Refactored client logger configuration into testable `loggerOptions`/`createLogger`.
- Strengthened structured log redaction for root-level and request-header secrets:
  - `authorization`;
  - `x-api-key`;
  - `setup_token`;
  - `api_key`;
  - generic `token`.
- Added a focused pino JSON output test proving raw setup/API/authorization secrets are removed from structured logs.

Verification:

- Client `npm run build` passed.
- Client targeted logger redaction unit test passed.
- Client `npm test` passed: 16 passed test files and 35 passed tests, plus 1 skipped local Ollama test file.
- Router `npm run test:e2e` passed with this client build: classify, chat, import, batch, export and deploy with fake Ollama.

Still external/not locally provable:

- Client user service must still be installed and verified on each target client host.
- Trusted deploy acceptance must run against a configured external trusted host.
- Distributed GPU acceptance must run against 2+ real GPU clients.

Additional client-side owner safety hardening at 2026-06-07 03:51 +07:

- Rechecked client task execution against router `doc/IMPLEMENTATION_DETAILS.md` sections 7, 20, 21, 23 and 24.
- Found that heartbeat reported manual pause/GPU-busy availability, but a defensive local check before `task_start` execution was not proven.
- Added a client-side task boundary check before running Ollama work:
  - reads current manual owner control state;
  - collects current local resource telemetry;
  - evaluates availability with the same owner/GPU policy used in heartbeat;
  - rejects tasks with `task_error` code `client_unavailable` when the owner paused the client or GPU is currently busy.
- This is defense-in-depth for owner safety: router should avoid assigning such hosts, and client now also refuses work if a stale heartbeat or router bug sends a task anyway.

Verification:

- Client `npm run build` passed.
- Client targeted router-connection integration passed: 1 test file and 9 tests.
- Client `npm test` passed: 16 passed test files and 37 passed tests, plus 1 skipped local Ollama test file.
- Router `npm run test:e2e` passed with this client build: classify, chat, import, batch, export and deploy with fake Ollama.

Still external/not locally provable:

- Client user service must still be installed and verified on each target client host.
- Trusted deploy acceptance must run against a configured external trusted host.
- Distributed GPU acceptance must run against 2+ real GPU clients.

Additional client router-command protocol validation hardening at 2026-06-07 04:13 +07:

- Rechecked client WebSocket command handling against router `doc/IMPLEMENTATION_DETAILS.md` sections 12, 23, 24 and 27.
- Found that inbound router WebSocket messages were parsed and trusted through TypeScript casts.
- Added zod runtime validation for router-to-client command envelopes:
  - `task_start`;
  - `deploy_update`.
- Invalid router command messages now emit `protocol_error` and do not start Ollama task execution or deploy command execution.
- Added integration coverage proving:
  - malformed JSON is rejected;
  - unknown command types are rejected;
  - incomplete `task_start` payloads are rejected without sending `task_error`;
  - invalid `deploy_update` payloads are rejected without sending `deploy_result`.

Verification:

- Client `npm run build` passed.
- Client targeted router-connection integration passed: 1 test file and 10 tests.
- Client `npm test` passed: 16 passed test files and 38 passed tests, plus 1 skipped local Ollama test file.
- Router `npm run test:e2e` passed with this client build: classify, chat, import, batch, export and deploy with fake Ollama.

Still external/not locally provable:

- Client user service must still be installed and verified on each target client host.
- Trusted deploy acceptance must run against a configured external trusted host.
- Distributed GPU acceptance must run against 2+ real GPU clients.

Additional kind-aware task command validation hardening at 2026-06-07 04:18 +07:

- Rechecked client `task_start` validation against router `doc/IMPLEMENTATION_DETAILS.md` sections 8, 12, 23, 24 and 27.
- Found that the new router-command schema validated general envelope shape, but did not yet enforce task input by `kind`.
- Hardened client task command validation:
  - `classify_message` and `classify_batch_item` require non-empty `input.text`;
  - `chat_completion` requires at least one message in `input.messages`;
  - invalid task commands fail at the protocol boundary and do not start Ollama work.
- Extended router-connection integration coverage with:
  - classify task missing text;
  - chat task missing messages.

Verification:

- Client `npm run build` passed.
- Client targeted router-connection integration passed: 1 test file and 10 tests.
- Client `npm test` passed: 16 passed test files and 38 passed tests, plus 1 skipped local Ollama test file.
- Router `npm run test:e2e` first hit a transient post-deploy smoke disconnect, then passed on rerun with this client build: classify, chat, import, batch, export and deploy with fake Ollama.

Still external/not locally provable:

- Client user service must still be installed and verified on each target client host.
- Trusted deploy acceptance must run against a configured external trusted host.
- Distributed GPU acceptance must run against 2+ real GPU clients.

Additional safe deploy failure reporting hardening at 2026-06-07 04:28 +07:

- Rechecked trusted deploy client behavior against router `doc/IMPLEMENTATION_DETAILS.md` sections 20, 23, 24 and 27.
- Found that deploy command failures returned the raw child-process error message to the router.
- Risk: a target-host deploy script could accidentally print a secret or signed artifact URL to stderr, and the client would include that text in `deploy_result.error.message`.
- Hardened deploy failure reporting:
  - known local/config/artifact failures return stable safe error codes and messages;
  - deploy command failures return `deploy_command_failed` without stdout/stderr content;
  - command timeouts return `deploy_command_timeout`;
  - unexpected local failures return generic `deploy_failed`.
- Added unit coverage proving deploy command stderr is not returned in the failure result.

Verification:

- Client `npm run build` passed.
- Client targeted deploy unit test passed: 1 test file and 3 tests.
- Client `npm test` passed: 16 passed test files and 39 passed tests, plus 1 skipped local Ollama test file.
- Router `npm run test:e2e` passed with this client build: classify, chat, import, batch, export and deploy with fake Ollama.

Still external/not locally provable:

- Client user service must still be installed and verified on each target client host.
- Trusted deploy acceptance must run against a configured external trusted host.
- Distributed GPU acceptance must run against 2+ real GPU clients.

Additional task cancellation handling hardening at 2026-06-07 04:39 +07:

- Rechecked router-to-client task protocol against router `doc/IMPLEMENTATION_DETAILS.md` sections 8, 12, 23, 24 and 27.
- Found that `task_cancel` was described in the protocol, but the client did not validate or handle it.
- Found that in-flight Ollama requests could continue after a router job cancel.
- Hardened client task cancellation:
  - inbound router command validation now accepts `task_cancel`;
  - active tasks are tracked with AbortControllers;
  - `OllamaClient.chat` and `OllamaClient.pullModel` accept a parent abort signal while preserving timeout behavior;
  - canceled tasks send `task_error` code `task_canceled`;
  - canceled tasks do not send `task_result`.
- Extended router-connection integration coverage with an in-flight fake Ollama request aborted by `task_cancel`.

Verification:

- Client `npm run build` passed.
- Client targeted router-connection integration passed: 1 test file and 11 tests.
- Router targeted cancellation tests passed: 2 test files and 11 tests.
- Client `npm test` passed: 16 passed test files and 40 passed tests, plus 1 skipped local Ollama test file.
- Router `npm test` passed: 35 passed test files and 91 passed tests, plus 3 skipped opt-in test files.
- Router `npm run test:e2e` passed with this client build: classify, chat, import, batch, export and deploy with fake Ollama.

Still external/not locally provable:

- Client user service must still be installed and verified on each target client host.
- Trusted deploy acceptance must run against a configured external trusted host.
- Distributed GPU acceptance must run against 2+ real GPU clients.

Additional explicit boolean env parsing hardening at 2026-06-07 05:11 +07:

- Rechecked client config against router `doc/IMPLEMENTATION_DETAILS.md` sections 17, 20, 21, 24 and 25.
- Found that `z.coerce.boolean()` treats the string `"false"` as `true`, which made `.env` boolean flags unsafe.
- Risk:
  - `CLIENT_DEPLOY_ENABLED=false` could be parsed as deploy enabled;
  - `CLIENT_ALLOW_MODEL_PULL=false` could be parsed as model pull enabled;
  - `CLIENT_MANUAL_ENABLED=false` could be parsed as manual mode enabled.
- Fixed in the client repo:
  - added explicit env boolean parsing for `true/false`, `1/0`, `yes/no` and `on/off`;
  - invalid boolean values remain invalid instead of being guessed;
  - `.env.example` is parsed through `loadConfig` in unit coverage.
- Added comments in `src/config.ts` documenting the production fail-closed logic and boolean parsing reason, with links to the implementation sections.

Verification:

- Client `npm run build` passed.
- Client targeted config unit test passed: 1 test file and 6 tests.
- Client `npm test` passed: 17 passed test files and 46 passed tests, plus 1 skipped local Ollama test file.
- Router `npm run test:e2e` passed with this client build: classify, chat, import, batch, export and deploy with fake Ollama.

Still external/not locally provable:

- Client user service must still be installed and verified on each target client host.
- Trusted deploy acceptance must run against a configured external trusted host.
- Distributed GPU acceptance must run against 2+ real GPU clients.

Additional trusted deploy rollback metadata at 2026-06-07 05:23 +07:

- Rechecked trusted deploy safety against router `doc/IMPLEMENTATION_DETAILS.md` section 25.
- Found that the client stored the downloaded target artifact, but did not persist the previous client version/build information needed for manual rollback.
- Fixed in the client repo:
  - writes metadata-only rollback manifests before running `CLIENT_DEPLOY_COMMAND`;
  - latest manifest path: `CLIENT_DATA_DIR/deploy/rollback.json`;
  - per-deploy manifest path: `CLIENT_DATA_DIR/deploy/DEPLOY_ID.rollback.json`;
  - manifest records previous client version, previous build id, target version, local artifact path and artifact SHA-256;
  - manifest intentionally does not persist router-provided artifact URL because it may be signed or secret-bearing;
  - deploy command receives `LOCAL_AI_DEPLOY_PREVIOUS_VERSION`, `LOCAL_AI_DEPLOY_PREVIOUS_BUILD_ID` and `LOCAL_AI_DEPLOY_ROLLBACK_MANIFEST`.
- Updated `RUNBOOK.md` with the manual rollback workflow.

Verification:

- Client `npm run build` passed.
- Client targeted deploy unit test passed: 1 test file and 3 tests.
- Client targeted runbook doc coverage passed: 1 test file and 1 test.
- Client `npm test` passed: 17 passed test files and 46 passed tests, plus 1 skipped local Ollama test file.
- Router `npm run test:e2e` initially exposed a router deploy reconnect ordering race, then passed after the router fix with this client build: classify, chat, import, batch, export and deploy with fake Ollama.

Still external/not locally provable:

- Client user service must still be installed and verified on each target client host.
- Trusted deploy acceptance must run against a configured external trusted host.
- Distributed GPU acceptance must run against 2+ real GPU clients.
