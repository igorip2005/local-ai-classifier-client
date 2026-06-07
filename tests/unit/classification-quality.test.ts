import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { baselineConsoleReport, evaluateKeywordBaseline, saveBaselineReportArtifact } from '../../src/classification-baseline.js';
import { classifyByKeywords } from '../../src/classification-rules.js';

type DatasetItem = { text: string; expected_label: string };

describe('classification keyword baseline', () => {
  it('keeps baseline accuracy above MVP threshold', async () => {
    const dataset = await readDataset();
    const report = evaluateKeywordBaseline(dataset, ['sales', 'support', 'spam', 'other'], 'tests/datasets/classification-v0.jsonl');
    expect(report.accuracy).toBeGreaterThanOrEqual(0.9);
    expect(report.contract_valid).toBe(report.total);
    expect(report.cases).toHaveLength(dataset.length);
  });

  it('classifies individual guardrail examples deterministically', async () => {
    const dataset = await readDataset();
    for (const item of dataset) {
      const result = classifyByKeywords(item.text, ['sales', 'support', 'spam', 'other']);
      expect(result?.label).toBe(item.expected_label);
    }
  });

  it('persists historical baseline reports as artifacts', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'local-ai-classification-report-'));
    const dir = path.join(root, 'reports');
    try {
      const dataset = await readDataset();
      const report = evaluateKeywordBaseline(dataset, ['sales', 'support', 'spam', 'other'], 'tests/datasets/classification-v0.jsonl');

      const saved = await saveBaselineReportArtifact(report, {
        reportDir: dir,
        minAccuracy: 0.9,
        now: new Date('2026-06-07T01:45:00.000Z')
      });

      const files = await readdir(dir);
      expect(files).toEqual(['2026-06-07T01-45-00-000Z_keyword_keyword.json']);
      const dirInfo = await stat(dir);
      expect(dirInfo.mode & 0o777).toBe(0o700);
      const fileInfo = await stat(saved.path);
      expect(fileInfo.mode & 0o777).toBe(0o600);
      const content = JSON.parse(await readFile(saved.path, 'utf8')) as {
        generated_at: string;
        passed: boolean;
        min_accuracy: number;
        total: number;
      };
      expect(content).toMatchObject({
        generated_at: '2026-06-07T01:45:00.000Z',
        passed: true,
        min_accuracy: 0.9,
        total: dataset.length
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('omits case text from default console report output', async () => {
    const dataset = await readDataset();
    const report = evaluateKeywordBaseline(dataset, ['sales', 'support', 'spam', 'other'], 'tests/datasets/classification-v0.jsonl');

    const summaryOnly = baselineConsoleReport(report);
    const full = baselineConsoleReport(report, { includeCases: true });

    expect(summaryOnly).not.toHaveProperty('cases');
    expect(JSON.stringify(summaryOnly)).not.toContain(dataset[0]!.text);
    expect(full.cases).toHaveLength(dataset.length);
    expect(JSON.stringify(full)).toContain(dataset[0]!.text);
  });
});

async function readDataset(): Promise<DatasetItem[]> {
  const content = await readFile('tests/datasets/classification-v0.jsonl', 'utf8');
  return content.trim().split('\n').map((line) => JSON.parse(line) as DatasetItem);
}
