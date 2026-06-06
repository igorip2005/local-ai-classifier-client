import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { classifyByKeywords } from '../../src/classification-rules.js';

type DatasetItem = { text: string; expected_label: string };

describe('classification keyword baseline', () => {
  it('keeps baseline accuracy above MVP threshold', async () => {
    const dataset = await readDataset();
    let correct = 0;
    for (const item of dataset) {
      const result = classifyByKeywords(item.text, ['sales', 'support', 'spam', 'other']);
      if (result?.label === item.expected_label) correct += 1;
    }
    const accuracy = correct / dataset.length;
    expect(accuracy).toBeGreaterThanOrEqual(0.9);
  });
});

async function readDataset(): Promise<DatasetItem[]> {
  const content = await readFile('tests/datasets/classification-v0.jsonl', 'utf8');
  return content.trim().split('\n').map((line) => JSON.parse(line) as DatasetItem);
}
