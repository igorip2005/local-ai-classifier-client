import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { RouterConnection } from '../../src/connection.js';

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
});

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
