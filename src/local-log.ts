import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { ClientConfig } from './config.js';

export async function writeLocalTaskLog(
  config: ClientConfig,
  entry: Record<string, unknown>
): Promise<void> {
  if (config.localLogMode === 'none') return;
  await mkdir(config.clientDataDir, { recursive: true, mode: 0o700 });
  const safeEntry = config.localLogMode === 'metadata' ? summarize(entry) : entry;
  await appendFile(path.join(config.clientDataDir, 'task-log.jsonl'), `${JSON.stringify(safeEntry)}\n`);
}

function summarize(entry: Record<string, unknown>): Record<string, unknown> {
  return {
    task_id: entry.task_id,
    model: entry.model,
    status: entry.status,
    duration_ms: entry.duration_ms,
    at: new Date().toISOString()
  };
}
