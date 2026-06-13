import http from 'node:http';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { OllamaClient } from '../../src/ollama.js';

let server: http.Server | null = null;

afterEach(async () => {
  await new Promise<void>((resolve) => {
    if (!server) resolve();
    else server.close(() => resolve());
  });
  server = null;
  delete process.env.WSL_DISTRO_NAME;
  delete process.env.POWERSHELL_PATH;
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
    await expect(client.health()).resolves.toMatchObject({ ok: true, version: '0.21.0', target_kind: 'http' });
    const models = await client.discoverModels();
    expect(models[0]).toMatchObject({ name: 'qwen2.5:0.5b', loaded: true });
  });

  it('uses PowerShell fallback for WSL clients when Linux HTTP cannot reach Windows Ollama', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'local-ai-ollama-powershell-'));
    try {
      const bin = path.join(dir, 'powershell.exe');
      await writeFile(bin, [
        '#!/bin/sh',
        'printf \'{"version":"0.24.0","models":[{"name":"qwen3:8b-q4_K_M","size":5000000000}]}\'',
        ''
      ].join('\n'));
      await chmod(bin, 0o700);
      process.env.WSL_DISTRO_NAME = 'Ubuntu';
      process.env.POWERSHELL_PATH = bin;

      const client = new OllamaClient('http://127.0.0.1:9');
      await expect(client.health()).resolves.toMatchObject({ ok: true, version: '0.24.0', target_kind: 'windows-powershell' });
      const models = await client.discoverModels();
      expect(models[0]).toMatchObject({ name: 'qwen3:8b-q4_K_M', loaded: true });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('uses the requested install timeout for PowerShell model pulls', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'local-ai-ollama-powershell-pull-'));
    try {
      const bin = path.join(dir, 'powershell.exe');
      const encodedPath = path.join(dir, 'encoded.txt');
      await writeFile(bin, [
        '#!/bin/sh',
        `printf '%s' "$4" > ${JSON.stringify(encodedPath)}`,
        'printf \'{"status":"success"}\'',
        ''
      ].join('\n'));
      await chmod(bin, 0o700);
      process.env.WSL_DISTRO_NAME = 'Ubuntu';
      process.env.POWERSHELL_PATH = bin;

      const client = new OllamaClient('http://127.0.0.1:9');
      await client.pullModel('qwen2.5:1.5b', 123_000);

      const encoded = await readFile(encodedPath, 'utf8');
      const command = Buffer.from(encoded, 'base64').toString('utf16le');
      expect(command).toContain('/api/pull');
      expect(command).toContain('-TimeoutSec 123');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('uses the requested task timeout for PowerShell chat calls', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'local-ai-ollama-powershell-chat-'));
    try {
      const bin = path.join(dir, 'powershell.exe');
      const encodedPath = path.join(dir, 'encoded.txt');
      await writeFile(bin, [
        '#!/bin/sh',
        `printf '%s' "$4" > ${JSON.stringify(encodedPath)}`,
        'printf \'{"message":{"content":"{\\"label\\":\\"other\\",\\"confidence\\":0.9,\\"reason\\":\\"ok\\"}"}}\'',
        ''
      ].join('\n'));
      await chmod(bin, 0o700);
      process.env.WSL_DISTRO_NAME = 'Ubuntu';
      process.env.POWERSHELL_PATH = bin;

      const client = new OllamaClient('http://127.0.0.1:9');
      await client.chat({ model: 'qwen3:1.7b', messages: [], stream: false }, 60_000);

      const encoded = await readFile(encodedPath, 'utf8');
      const command = Buffer.from(encoded, 'base64').toString('utf16le');
      expect(command).toContain('/api/chat');
      expect(command).toContain('-TimeoutSec 60');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
