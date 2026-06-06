import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { writeLocalTaskLog } from '../../src/local-log.js';

describe('writeLocalTaskLog', () => {
  it('does not persist task logs when local logging is disabled', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'local-ai-log-none-'));
    try {
      const config = loadConfig({ CLIENT_DATA_DIR: dir, CLIENT_LOCAL_LOG_MODE: 'none' });
      await writeLocalTaskLog(config, { task_id: 'task-1', input: { text: 'private text' } });

      await expect(readFile(path.join(dir, 'task-log.jsonl'), 'utf8')).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('persists only metadata in metadata mode', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'local-ai-log-metadata-'));
    try {
      const config = loadConfig({ CLIENT_DATA_DIR: dir, CLIENT_LOCAL_LOG_MODE: 'metadata' });
      await writeLocalTaskLog(config, {
        task_id: 'task-1',
        model: 'qwen2.5:0.5b',
        status: 'succeeded',
        duration_ms: 42,
        input: { text: 'private text' },
        output: { reason: 'private output' }
      });

      const line = await readFile(path.join(dir, 'task-log.jsonl'), 'utf8');
      const parsed = JSON.parse(line) as Record<string, unknown>;
      expect(parsed).toMatchObject({ task_id: 'task-1', model: 'qwen2.5:0.5b', status: 'succeeded', duration_ms: 42 });
      expect(parsed).not.toHaveProperty('input');
      expect(parsed).not.toHaveProperty('output');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('persists full task details only in full mode', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'local-ai-log-full-'));
    try {
      const config = loadConfig({ CLIENT_DATA_DIR: dir, CLIENT_LOCAL_LOG_MODE: 'full' });
      await writeLocalTaskLog(config, {
        task_id: 'task-1',
        input: { text: 'private text' },
        output: { label: 'sales' }
      });

      const line = await readFile(path.join(dir, 'task-log.jsonl'), 'utf8');
      expect(JSON.parse(line)).toMatchObject({
        task_id: 'task-1',
        input: { text: 'private text' },
        output: { label: 'sales' }
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
