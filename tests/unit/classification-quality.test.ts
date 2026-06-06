import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { evaluateKeywordBaseline } from '../../src/classification-baseline.js';
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
});

async function readDataset(): Promise<DatasetItem[]> {
  const content = await readFile('tests/datasets/classification-v0.jsonl', 'utf8');
  return content.trim().split('\n').map((line) => JSON.parse(line) as DatasetItem);
}
