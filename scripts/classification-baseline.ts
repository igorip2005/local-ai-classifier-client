import { loadConfig } from '../src/config.js';
import {
  evaluateKeywordBaseline,
  evaluateOllamaBaseline,
  readClassificationDataset
} from '../src/classification-baseline.js';

const datasetPath = process.env.CLASSIFICATION_DATASET_PATH ?? 'tests/datasets/classification-v0.jsonl';
const classes = (process.env.CLASSIFICATION_CLASSES ?? 'sales,support,spam,other')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
const model = process.env.OLLAMA_MODEL ?? 'qwen2.5:0.5b';
const mode = process.env.RUN_LOCAL_OLLAMA === '1' ? 'ollama' : 'keyword';
const minAccuracy = Number(process.env.CLASSIFICATION_MIN_ACCURACY ?? '0.9');

const dataset = await readClassificationDataset(datasetPath);
const report = mode === 'ollama'
  ? await evaluateOllamaBaseline(loadConfig(process.env), dataset, classes, model, datasetPath)
  : evaluateKeywordBaseline(dataset, classes, datasetPath);

console.log(JSON.stringify(report, null, 2));

if (report.accuracy < minAccuracy) {
  process.stderr.write(`classification baseline accuracy ${report.accuracy} is below ${minAccuracy}\n`);
  process.exit(1);
}
if (report.contract_valid !== report.total) {
  process.stderr.write(`classification baseline contract failures: ${report.total - report.contract_valid}\n`);
  process.exit(1);
}
