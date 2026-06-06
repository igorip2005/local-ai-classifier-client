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
