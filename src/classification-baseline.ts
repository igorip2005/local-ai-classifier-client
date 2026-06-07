import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ClientConfig } from './config.js';
import { classifyByKeywords } from './classification-rules.js';
import { runTask } from './task-runner.js';

export type DatasetItem = {
  text: string;
  expected_label: string;
};

export type BaselineCase = {
  text: string;
  expected_label: string;
  actual_label: string | null;
  correct: boolean;
  contract_valid: boolean;
  duration_ms: number | null;
  reason: string;
};

export type BaselineReport = {
  mode: 'keyword' | 'ollama';
  model: string | null;
  dataset_path: string;
  total: number;
  correct: number;
  accuracy: number;
  contract_valid: number;
  latency_ms: {
    avg: number | null;
    max: number | null;
  };
  cases: BaselineCase[];
};

export type BaselineReportArtifact = BaselineReport & {
  generated_at: string;
  min_accuracy: number;
  passed: boolean;
};

export type BaselineConsoleReport = Omit<BaselineReport, 'cases'> & {
  cases?: BaselineCase[];
};

export async function readClassificationDataset(datasetPath: string): Promise<DatasetItem[]> {
  const content = await readFile(datasetPath, 'utf8');
  return content.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as DatasetItem);
}

export function evaluateKeywordBaseline(
  dataset: DatasetItem[],
  classes: string[],
  datasetPath = 'inline'
): BaselineReport {
  const cases = dataset.map((item) => {
    const result = classifyByKeywords(item.text, classes);
    const actualLabel = result?.label ?? null;
    return {
      text: item.text,
      expected_label: item.expected_label,
      actual_label: actualLabel,
      correct: actualLabel === item.expected_label,
      contract_valid: Boolean(result?.label && typeof result.confidence === 'number' && result.reason),
      duration_ms: null,
      reason: result?.reason ?? 'No classification returned'
    };
  });
  return summarizeReport('keyword', null, datasetPath, cases);
}

export async function evaluateOllamaBaseline(
  config: ClientConfig,
  dataset: DatasetItem[],
  classes: string[],
  model: string,
  datasetPath = 'inline'
): Promise<BaselineReport> {
  const cases: BaselineCase[] = [];
  for (let index = 0; index < dataset.length; index += 1) {
    const item = dataset[index];
    if (!item) continue;
    const started = Date.now();
    const result = await runTask(config, {
      task_id: `classification-baseline-${index + 1}`,
      kind: 'classify_message',
      priority: 80,
      model,
      timeout_ms: 30_000,
      input: { text: item.text, classes },
      options: { temperature: 0, num_ctx: 1024, think: false, stream: false }
    });
    const output = result.output as { label?: unknown; confidence?: unknown; reason?: unknown };
    const actualLabel = typeof output.label === 'string' ? output.label : null;
    cases.push({
      text: item.text,
      expected_label: item.expected_label,
      actual_label: actualLabel,
      correct: actualLabel === item.expected_label,
      contract_valid: actualLabel !== null && typeof output.confidence === 'number' && typeof output.reason === 'string',
      duration_ms: Date.now() - started,
      reason: typeof output.reason === 'string' ? output.reason : 'Missing reason'
    });
  }
  return summarizeReport('ollama', model, datasetPath, cases);
}

export async function saveBaselineReportArtifact(
  report: BaselineReport,
  options: { reportDir: string; minAccuracy: number; now?: Date }
): Promise<{ path: string; artifact: BaselineReportArtifact }> {
  const generatedAt = (options.now ?? new Date()).toISOString();
  const artifact: BaselineReportArtifact = {
    ...report,
    generated_at: generatedAt,
    min_accuracy: options.minAccuracy,
    passed: report.accuracy >= options.minAccuracy && report.contract_valid === report.total
  };
  await mkdir(options.reportDir, { recursive: true, mode: 0o700 });
  const fileName = `${fileTimestamp(generatedAt)}_${report.mode}_${safeFilePart(report.model ?? 'keyword')}.json`;
  const outputPath = path.join(options.reportDir, fileName);
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  return { path: outputPath, artifact };
}

export function baselineConsoleReport(report: BaselineReport, options: { includeCases?: boolean } = {}): BaselineConsoleReport {
  const { cases, ...summary } = report;
  if (options.includeCases) return { ...summary, cases };
  return summary;
}

function summarizeReport(
  mode: BaselineReport['mode'],
  model: string | null,
  datasetPath: string,
  cases: BaselineCase[]
): BaselineReport {
  const total = cases.length;
  const correct = cases.filter((item) => item.correct).length;
  const latencies = cases.map((item) => item.duration_ms).filter((value): value is number => typeof value === 'number');
  return {
    mode,
    model,
    dataset_path: datasetPath,
    total,
    correct,
    accuracy: total > 0 ? correct / total : 0,
    contract_valid: cases.filter((item) => item.contract_valid).length,
    latency_ms: {
      avg: latencies.length ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length) : null,
      max: latencies.length ? Math.max(...latencies) : null
    },
    cases
  };
}

function fileTimestamp(value: string): string {
  return value.replace(/[:.]/g, '-');
}

function safeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '_');
}
