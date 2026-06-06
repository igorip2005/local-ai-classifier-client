import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { RouterConnection } from '../../src/connection.js';
import { setManualEnabled } from '../../src/control.js';

let server: http.Server | null = null;

afterEach(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = null;
});

describe('RouterConnection', () => {
  it('sends register and heartbeat envelopes to fake router', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'local-ai-client-ws-'));
    const received: string[] = [];
    server = http.createServer();
    const wss = new WebSocketServer({ server });
    wss.on('connection', (socket) => socket.on('message', (data) => received.push(data.toString())));
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing server port');

    const config = loadConfig({
      ROUTER_URL: `ws://127.0.0.1:${address.port}`,
      CLIENT_DATA_DIR: dir,
      CLIENT_FAST_HEARTBEAT_MS: '25',
      CLIENT_FULL_HEARTBEAT_MS: '100',
      CLIENT_NAME: 'test-client'
    });
    const connection = new RouterConnection(config, 'host-test-id', '0.1.0');
    connection.connect();

    await waitFor(() => received.length >= 2);
    connection.close();
    await rm(dir, { recursive: true, force: true });

    expect(JSON.parse(received[0] ?? '{}').type).toBe('register');
    expect(JSON.parse(received[1] ?? '{}').type).toBe('heartbeat');
  });

  it('reconnects with backoff after router closes the socket', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'local-ai-client-reconnect-'));
    let registerCount = 0;
    server = http.createServer();
    const wss = new WebSocketServer({ server });
    wss.on('connection', (socket) => {
      socket.on('message', (data) => {
        const envelope = JSON.parse(data.toString()) as { type: string };
        if (envelope.type !== 'register') return;
        registerCount += 1;
        if (registerCount === 1) socket.close();
      });
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing server port');

    const config = loadConfig({
      ROUTER_URL: `ws://127.0.0.1:${address.port}`,
      CLIENT_DATA_DIR: dir,
      CLIENT_FAST_HEARTBEAT_MS: '50',
      CLIENT_NAME: 'reconnect-client'
    });
    const connection = new RouterConnection(config, 'host-reconnect-id', '0.1.0');
    connection.connect();

    await waitFor(() => registerCount >= 2, 2500);
    connection.close();
    await rm(dir, { recursive: true, force: true });

    expect(registerCount).toBeGreaterThanOrEqual(2);
  });

  it('reflects manual pause control state in heartbeat', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'local-ai-client-paused-'));
    await setManualEnabled(dir, false);
    const received: string[] = [];
    server = http.createServer();
    const wss = new WebSocketServer({ server });
    wss.on('connection', (socket) => socket.on('message', (data) => received.push(data.toString())));
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing server port');

    const config = loadConfig({
      ROUTER_URL: `ws://127.0.0.1:${address.port}`,
      CLIENT_DATA_DIR: dir,
      CLIENT_FAST_HEARTBEAT_MS: '25',
      CLIENT_MANUAL_ENABLED: 'true',
      CLIENT_NAME: 'paused-client'
    });
    const connection = new RouterConnection(config, 'host-paused-id', '0.1.0');
    connection.connect();

    await waitFor(() => received.some((raw) => JSON.parse(raw).type === 'heartbeat'));
    connection.close();
    await rm(dir, { recursive: true, force: true });

    const heartbeat = received.map((raw) => JSON.parse(raw)).find((item) => item.type === 'heartbeat');
    expect(heartbeat.payload.resources.availability.mode).toBe('manual_paused');
    expect(heartbeat.payload.resources.availability.can_accept_tasks).toBe(false);
  });

  it('sends capabilities_update when discovered models change', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'local-ai-client-capabilities-'));
    let tagCallCount = 0;
    const ollama = http.createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/api/version') return res.end(JSON.stringify({ version: '0.21.0' }));
      if (req.url === '/api/ps') return res.end(JSON.stringify({ models: [] }));
      if (req.url === '/api/tags') {
        tagCallCount += 1;
        const models = tagCallCount >= 2 ? [{ name: 'qwen2.5:0.5b' }, { name: 'new-model:latest' }] : [{ name: 'qwen2.5:0.5b' }];
        return res.end(JSON.stringify({ models }));
      }
      return res.end(JSON.stringify({}));
    });
    await new Promise<void>((resolve) => ollama.listen(0, '127.0.0.1', resolve));
    const ollamaAddress = ollama.address();
    if (!ollamaAddress || typeof ollamaAddress === 'string') throw new Error('missing ollama port');
    const received: string[] = [];
    server = http.createServer();
    const wss = new WebSocketServer({ server });
    wss.on('connection', (socket) => socket.on('message', (data) => received.push(data.toString())));
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing server port');

    const config = loadConfig({
      ROUTER_URL: `ws://127.0.0.1:${address.port}`,
      CLIENT_DATA_DIR: dir,
      OLLAMA_BASE_URL: `http://127.0.0.1:${ollamaAddress.port}`,
      CLIENT_FAST_HEARTBEAT_MS: '50',
      CLIENT_FULL_HEARTBEAT_MS: '50',
      CLIENT_NAME: 'capabilities-client'
    });
    const connection = new RouterConnection(config, 'host-capabilities-id', '0.1.0');
    connection.connect();

    await waitFor(() => received.some((raw) => JSON.parse(raw).type === 'capabilities_update'), 1500);
    connection.close();
    await new Promise<void>((resolve) => ollama.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });

    const update = received.map((raw) => JSON.parse(raw)).find((item) => item.type === 'capabilities_update');
    expect(update.payload.capabilities.models.map((model: { name: string }) => model.name)).toContain('new-model:latest');
  });
});

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
