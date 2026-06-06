import { describe, expect, it } from 'vitest';
import { evaluateOllamaBaseline, readClassificationDataset } from '../../src/classification-baseline.js';
import { loadConfig } from '../../src/config.js';
import { OllamaClient } from '../../src/ollama.js';

const runLocalOllama = process.env.RUN_LOCAL_OLLAMA === '1';
const describeLocal = runLocalOllama ? describe : describe.skip;

describeLocal('local Ollama qwen2.5:0.5b smoke', () => {
  it('classifies the fixed dataset with a valid contract and recorded latency', async () => {
    const model = process.env.OLLAMA_MODEL ?? 'qwen2.5:0.5b';
    const ollamaBaseUrl = process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434';
    const datasetPath = process.env.CLASSIFICATION_DATASET_PATH ?? 'tests/datasets/classification-v0.jsonl';
    const config = loadConfig({
      ...process.env,
      OLLAMA_BASE_URL: ollamaBaseUrl,
      CLIENT_ALLOW_MODEL_PULL: process.env.LOCAL_OLLAMA_ALLOW_PULL ?? 'false',
      CLIENT_LOCAL_LOG_MODE: 'none'
    });

    const ollama = new OllamaClient(ollamaBaseUrl);
    const health = await ollama.health();
    expect(health.ok, `Ollama is not reachable at ${ollamaBaseUrl}`).toBe(true);

    const dataset = await readClassificationDataset(datasetPath);
    const report = await evaluateOllamaBaseline(config, dataset, ['sales', 'support', 'spam', 'other'], model, datasetPath);

    expect(report.total).toBe(dataset.length);
    expect(report.contract_valid).toBe(report.total);
    expect(report.latency_ms.avg).not.toBeNull();
    expect(report.latency_ms.max).not.toBeNull();
    expect(report.accuracy).toBeGreaterThanOrEqual(Number(process.env.CLASSIFICATION_MIN_ACCURACY ?? '0.75'));
  }, 120_000);
});
