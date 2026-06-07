import { loadConfig } from '../src/config.js';
import {
  baselineConsoleReport,
  evaluateKeywordBaseline,
  evaluateOllamaBaseline,
  readClassificationDataset,
  saveBaselineReportArtifact
} from '../src/classification-baseline.js';
import { redactDeployText } from '../src/deploy/redaction.js';

const datasetPath = process.env.CLASSIFICATION_DATASET_PATH ?? 'tests/datasets/classification-v0.jsonl';
const classes = (process.env.CLASSIFICATION_CLASSES ?? 'sales,support,spam,other')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
const model = process.env.OLLAMA_MODEL ?? 'qwen2.5:0.5b';
const mode = process.env.RUN_LOCAL_OLLAMA === '1' ? 'ollama' : 'keyword';
const minAccuracy = Number(process.env.CLASSIFICATION_MIN_ACCURACY ?? '0.9');
const reportDir = process.env.CLASSIFICATION_REPORT_DIR ?? 'var/classification-baseline';
const writeReport = process.env.CLASSIFICATION_WRITE_REPORT !== '0';
const printCases = process.env.CLASSIFICATION_PRINT_CASES === '1';

try {
  const dataset = await readClassificationDataset(datasetPath);
  const report = mode === 'ollama'
    ? await evaluateOllamaBaseline(loadConfig(process.env), dataset, classes, model, datasetPath)
    : evaluateKeywordBaseline(dataset, classes, datasetPath);

  console.log(JSON.stringify(baselineConsoleReport(report, { includeCases: printCases }), null, 2));

  const failed = report.accuracy < minAccuracy || report.contract_valid !== report.total;
  if (writeReport) {
    const artifact = await saveBaselineReportArtifact(report, { reportDir, minAccuracy });
    process.stderr.write(`classification baseline report written: ${artifact.path}\n`);
  }

  if (report.accuracy < minAccuracy) {
    process.stderr.write(`classification baseline accuracy ${report.accuracy} is below ${minAccuracy}\n`);
    process.exit(1);
  }
  if (report.contract_valid !== report.total) {
    process.stderr.write(`classification baseline contract failures: ${report.total - report.contract_valid}\n`);
    process.exit(1);
  }
  if (failed) process.exit(1);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    status: 'fail',
    error: safeBaselineError(error)
  }, null, 2)}\n`);
  process.exit(1);
}

function safeBaselineError(error: unknown): { name: string; message: string } {
  if (error instanceof Error) {
    return {
      name: error.name || 'Error',
      message: redactDeployText(error.message)
    };
  }
  return {
    name: 'Error',
    message: redactDeployText(String(error))
  };
}
