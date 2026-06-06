import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { setManualEnabled } from '../../src/control.js';
import { StatusServer } from '../../src/status-server.js';

let ollama: http.Server | null = null;

afterEach(async () => {
  await new Promise<void>((resolve) => ollama?.close(() => resolve()));
  ollama = null;
});

describe('StatusServer', () => {
  it('returns local client status', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'local-ai-status-'));
    await setManualEnabled(dir, false);
    ollama = http.createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/api/version') return res.end(JSON.stringify({ version: '0.21.0' }));
      if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'qwen2.5:0.5b' }] }));
      if (req.url === '/api/ps') return res.end(JSON.stringify({ models: [] }));
      return res.end(JSON.stringify({}));
    });
    await new Promise<void>((resolve) => ollama?.listen(0, '127.0.0.1', resolve));
    const ollamaAddress = ollama.address();
    if (!ollamaAddress || typeof ollamaAddress === 'string') throw new Error('missing ollama port');
    const statusPort = await getFreePort();
    const config = loadConfig({
      CLIENT_DATA_DIR: dir,
      CLIENT_STATUS_PORT: String(statusPort),
      OLLAMA_BASE_URL: `http://127.0.0.1:${ollamaAddress.port}`
    });
    const server = new StatusServer(config, 'host-status', '0.1.0');
    server.start();
    try {
      const response = await fetch(`http://127.0.0.1:${statusPort}/status`);
      const body = await response.json() as { host_id: string; manual_enabled: boolean; models: unknown[] };
      expect(body.host_id).toBe('host-status');
      expect(body.manual_enabled).toBe(false);
      expect(body.models).toHaveLength(1);
    } finally {
      server.stop();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

async function getFreePort(): Promise<number> {
  const server = http.createServer();
  server.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (!address || typeof address === 'string') throw new Error('missing free port');
  return address.port;
}
