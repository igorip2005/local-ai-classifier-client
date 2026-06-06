import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { OllamaClient } from '../../src/ollama.js';

let server: http.Server | null = null;

afterEach(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = null;
});

describe('OllamaClient', () => {
  it('parses health and model discovery responses', async () => {
    server = http.createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/api/version') res.end(JSON.stringify({ version: '0.21.0' }));
      if (req.url === '/api/ps') res.end(JSON.stringify({ models: [{ name: 'qwen2.5:0.5b' }] }));
      if (req.url === '/api/tags') {
        res.end(JSON.stringify({ models: [{ name: 'qwen2.5:0.5b', size: 397000000 }] }));
      }
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing server port');

    const client = new OllamaClient(`http://127.0.0.1:${address.port}`);
    await expect(client.health()).resolves.toEqual({ ok: true, version: '0.21.0' });
    const models = await client.discoverModels();
    expect(models[0]).toMatchObject({ name: 'qwen2.5:0.5b', loaded: true });
  });
});
