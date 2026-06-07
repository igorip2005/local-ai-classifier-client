import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFile = promisify(execFileCallback);

describe('classification baseline CLI', () => {
  it('redacts top-level failure output before printing to stderr', async () => {
    const result = await execFile('npx', ['tsx', 'scripts/classification-baseline.ts'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CLASSIFICATION_DATASET_PATH: 'https://artifact.example/dataset.jsonl?token=raw-url-token',
        CLASSIFICATION_WRITE_REPORT: '0'
      }
    }).then(
      () => ({ stdout: '', stderr: '', code: 0 }),
      (error: { stdout?: string; stderr?: string; code?: number }) => ({
        stdout: error.stdout ?? '',
        stderr: error.stderr ?? '',
        code: error.code ?? 1
      })
    );

    const combined = `${result.stdout}\n${result.stderr}`;
    expect(result.code).toBe(1);
    expect(combined).not.toContain('raw-url-token');
    expect(combined).not.toContain('Error: ENOENT');
    expect(combined).toContain('"status": "fail"');
    expect(combined).toContain('https://artifact.example/dataset.jsonl?[redacted]');
  });
});
