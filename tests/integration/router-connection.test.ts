import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
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
    const heartbeat = JSON.parse(received[1] ?? '{}');
    expect(heartbeat.type).toBe('heartbeat');
    expect(heartbeat.payload).toMatchObject({ client_version: '0.1.0', build_id: 'dev' });
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

  it('rejects invalid router command envelopes before running task or deploy work', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'local-ai-client-protocol-validation-'));
    const received: string[] = [];
    const protocolErrors: unknown[] = [];
    server = http.createServer();
    const wss = new WebSocketServer({ server });
    wss.on('connection', (socket) => {
      socket.on('message', (data) => {
        const raw = data.toString();
        received.push(raw);
        const envelope = JSON.parse(raw) as { type: string };
        if (envelope.type === 'register') {
          socket.send('{not-json');
          socket.send(JSON.stringify({ type: 'unknown_command', request_id: 'unknown-1', payload: {} }));
          socket.send(JSON.stringify({
            type: 'task_start',
            request_id: 'invalid-task-1',
            payload: {
              task_id: 'task-invalid-1',
              kind: 'classify_message',
              priority: 80,
              model: 'qwen2.5:0.5b',
              timeout_ms: 5000,
              options: { temperature: 0, num_ctx: 1024, think: false, stream: false }
            }
          }));
          socket.send(JSON.stringify({
            type: 'task_start',
            request_id: 'invalid-task-2',
            payload: {
              task_id: 'task-invalid-2',
              kind: 'classify_message',
              priority: 80,
              model: 'qwen2.5:0.5b',
              timeout_ms: 5000,
              input: { classes: ['sales', 'support', 'spam', 'other'] },
              options: { temperature: 0, num_ctx: 1024, think: false, stream: false }
            }
          }));
          socket.send(JSON.stringify({
            type: 'task_start',
            request_id: 'invalid-task-3',
            payload: {
              task_id: 'task-invalid-3',
              kind: 'chat_completion',
              priority: 70,
              model: 'qwen2.5:0.5b',
              timeout_ms: 5000,
              input: { metadata: { invalid: true } },
              options: { temperature: 0, num_ctx: 1024, think: false, stream: false }
            }
          }));
          socket.send(JSON.stringify({
            type: 'deploy_update',
            request_id: 'invalid-deploy-1',
            payload: {
              deploy_id: 'deploy-invalid-1',
              target_version: '0.1.1',
              artifact_url: 'not-a-url',
              artifact_sha256: 'bad'
            }
          }));
        }
      });
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing server port');

    const config = loadConfig({
      ROUTER_URL: `ws://127.0.0.1:${address.port}`,
      CLIENT_DATA_DIR: dir,
      OLLAMA_BASE_URL: 'http://127.0.0.1:9',
      CLIENT_FAST_HEARTBEAT_MS: '1000',
      CLIENT_DEPLOY_ENABLED: 'true',
      CLIENT_DEPLOY_COMMAND: process.execPath,
      CLIENT_NAME: 'protocol-validation-client'
    });
    const connection = new RouterConnection(config, 'host-protocol-validation-id', '0.1.0');
    connection.on('protocol_error', (error) => protocolErrors.push(error));
    connection.connect();

    await waitFor(() => protocolErrors.length >= 6, 1500);
    await new Promise((resolve) => setTimeout(resolve, 50));
    connection.close();
    await rm(dir, { recursive: true, force: true });

    expect(protocolErrors).toHaveLength(6);
    const outboundTypes = received.map((raw) => JSON.parse(raw).type);
    expect(outboundTypes).not.toContain('task_error');
    expect(outboundTypes).not.toContain('deploy_result');
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

  it('rejects task_start while owner has manually paused the client', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'local-ai-client-paused-task-'));
    await setManualEnabled(dir, false);
    const received: string[] = [];
    server = http.createServer();
    const wss = new WebSocketServer({ server });
    wss.on('connection', (socket) => {
      socket.on('message', (data) => {
        const raw = data.toString();
        received.push(raw);
        const envelope = JSON.parse(raw) as { type: string };
        if (envelope.type === 'register') {
          socket.send(JSON.stringify({
            type: 'task_start',
            request_id: 'task-request-paused',
            payload: {
              task_id: 'task-paused-1',
              kind: 'classify_message',
              priority: 80,
              model: 'qwen2.5:0.5b',
              timeout_ms: 5000,
              input: { text: 'Сколько стоит?', classes: ['sales', 'support', 'spam', 'other'] },
              options: { temperature: 0, num_ctx: 1024, think: false, stream: false }
            }
          }));
        }
      });
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing server port');

    const config = loadConfig({
      ROUTER_URL: `ws://127.0.0.1:${address.port}`,
      CLIENT_DATA_DIR: dir,
      OLLAMA_BASE_URL: 'http://127.0.0.1:9',
      CLIENT_FAST_HEARTBEAT_MS: '1000',
      CLIENT_MANUAL_ENABLED: 'true',
      CLIENT_NAME: 'paused-task-client'
    });
    const connection = new RouterConnection(config, 'host-paused-task-id', '0.1.0');
    connection.connect();

    await waitFor(() => received.some((raw) => JSON.parse(raw).type === 'task_error'), 1500);
    connection.close();
    await rm(dir, { recursive: true, force: true });

    const error = received.map((raw) => JSON.parse(raw)).find((item) => item.type === 'task_error');
    expect(error.payload.task_id).toBe('task-paused-1');
    expect(error.payload.error).toMatchObject({
      code: 'client_unavailable',
      message: 'Client is unavailable: manual_paused'
    });
  });

  it('rejects task_start while local GPU telemetry is busy', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'local-ai-client-gpu-busy-task-'));
    const nvidiaSmi = path.join(dir, 'nvidia-smi');
    await writeFile(nvidiaSmi, '#!/bin/sh\nprintf "RTX Test, 95, 1000, 12000\\n"\n');
    await chmod(nvidiaSmi, 0o700);
    const originalNvidiaSmiPath = process.env.NVIDIA_SMI_PATH;
    process.env.NVIDIA_SMI_PATH = nvidiaSmi;
    const received: string[] = [];
    server = http.createServer();
    const wss = new WebSocketServer({ server });
    wss.on('connection', (socket) => {
      socket.on('message', (data) => {
        const raw = data.toString();
        received.push(raw);
        const envelope = JSON.parse(raw) as { type: string };
        if (envelope.type === 'register') {
          socket.send(JSON.stringify({
            type: 'task_start',
            request_id: 'task-request-gpu-busy',
            payload: {
              task_id: 'task-gpu-busy-1',
              kind: 'classify_message',
              priority: 80,
              model: 'qwen2.5:0.5b',
              timeout_ms: 5000,
              input: { text: 'Сколько стоит?', classes: ['sales', 'support', 'spam', 'other'] },
              options: { temperature: 0, num_ctx: 1024, think: false, stream: false }
            }
          }));
        }
      });
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing server port');

    const config = loadConfig({
      ROUTER_URL: `ws://127.0.0.1:${address.port}`,
      CLIENT_DATA_DIR: dir,
      OLLAMA_BASE_URL: 'http://127.0.0.1:9',
      CLIENT_FAST_HEARTBEAT_MS: '1000',
      CLIENT_NAME: 'gpu-busy-task-client'
    });
    const connection = new RouterConnection(config, 'host-gpu-busy-task-id', '0.1.0');
    try {
      connection.connect();
      await waitFor(() => received.some((raw) => JSON.parse(raw).type === 'task_error'), 1500);
    } finally {
      connection.close();
      if (originalNvidiaSmiPath === undefined) delete process.env.NVIDIA_SMI_PATH;
      else process.env.NVIDIA_SMI_PATH = originalNvidiaSmiPath;
      await rm(dir, { recursive: true, force: true });
    }

    const error = received.map((raw) => JSON.parse(raw)).find((item) => item.type === 'task_error');
    expect(error.payload.task_id).toBe('task-gpu-busy-1');
    expect(error.payload.error).toMatchObject({
      code: 'client_unavailable',
      message: 'Client is unavailable: gpu_busy'
    });
  });

  it('reports Ollama unavailable in heartbeat without breaking registration', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'local-ai-client-ollama-down-'));
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
      OLLAMA_BASE_URL: 'http://127.0.0.1:9',
      CLIENT_FAST_HEARTBEAT_MS: '25',
      CLIENT_NAME: 'ollama-down-client'
    });
    const connection = new RouterConnection(config, 'host-ollama-down-id', '0.1.0');
    connection.connect();

    await waitFor(() => received.some((raw) => JSON.parse(raw).type === 'heartbeat'), 1500);
    connection.close();
    await rm(dir, { recursive: true, force: true });

    const register = received.map((raw) => JSON.parse(raw)).find((item) => item.type === 'register');
    expect(register.payload.ollama.ok).toBe(false);
    expect(register.payload.capabilities.models).toEqual([]);
    const heartbeat = received.map((raw) => JSON.parse(raw)).find((item) => item.type === 'heartbeat');
    expect(heartbeat.payload.resources.ollama.ok).toBe(false);
    expect(heartbeat.payload.resources.processes.ollama_running).toBe(false);
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

  it('sends a fresh idle heartbeat after a task finishes', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'local-ai-client-task-heartbeat-'));
    const ollama = http.createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/api/version') return res.end(JSON.stringify({ version: '0.21.0' }));
      if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'qwen2.5:0.5b' }] }));
      if (req.url === '/api/ps') return res.end(JSON.stringify({ models: [] }));
      if (req.url === '/api/chat') return res.end(JSON.stringify({ message: { content: '{"label":"sales","confidence":0.9,"reason":"price"}' } }));
      return res.end(JSON.stringify({}));
    });
    await new Promise<void>((resolve) => ollama.listen(0, '127.0.0.1', resolve));
    const ollamaAddress = ollama.address();
    if (!ollamaAddress || typeof ollamaAddress === 'string') throw new Error('missing ollama port');
    const received: string[] = [];
    server = http.createServer();
    const wss = new WebSocketServer({ server });
    wss.on('connection', (socket) => {
      socket.on('message', (data) => {
        const raw = data.toString();
        received.push(raw);
        const envelope = JSON.parse(raw) as { type: string };
        if (envelope.type === 'register') {
          socket.send(JSON.stringify({
            type: 'task_start',
            request_id: 'task-request-1',
            payload: {
              task_id: 'task-heartbeat-1',
              kind: 'classify_message',
              priority: 80,
              model: 'qwen2.5:0.5b',
              timeout_ms: 5000,
              input: { text: 'Сколько стоит?', classes: ['sales', 'support', 'spam', 'other'] },
              options: { temperature: 0, num_ctx: 1024, think: false, stream: false }
            }
          }));
        }
      });
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing server port');

    const config = loadConfig({
      ROUTER_URL: `ws://127.0.0.1:${address.port}`,
      CLIENT_DATA_DIR: dir,
      OLLAMA_BASE_URL: `http://127.0.0.1:${ollamaAddress.port}`,
      CLIENT_FAST_HEARTBEAT_MS: '1000',
      CLIENT_NAME: 'task-heartbeat-client'
    });
    const connection = new RouterConnection(config, 'host-task-heartbeat-id', '0.1.0');
    connection.connect();

    await waitFor(() => received.some((raw) => JSON.parse(raw).type === 'task_result'), 1500);
    await waitFor(() => received.some((raw) => {
      const envelope = JSON.parse(raw);
      return envelope.type === 'heartbeat' && envelope.payload.active_tasks === 0 && envelope.payload.status === 'idle';
    }), 1500);
    connection.close();
    await new Promise<void>((resolve) => ollama.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  });

  it('sends safe task_error plus detailed Ollama diagnostics back to the router', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'local-ai-client-safe-task-error-'));
    const sensitiveText = 'customer message with api_key=secret-123';
    const ollama = http.createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/api/version') return res.end(JSON.stringify({ version: '0.21.0' }));
      if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'qwen2.5:0.5b' }] }));
      if (req.url === '/api/ps') return res.end(JSON.stringify({ models: [] }));
      if (req.url === '/api/chat') {
        res.statusCode = 500;
        return res.end(`model failed while handling ${sensitiveText}`);
      }
      return res.end(JSON.stringify({}));
    });
    await new Promise<void>((resolve) => ollama.listen(0, '127.0.0.1', resolve));
    const ollamaAddress = ollama.address();
    if (!ollamaAddress || typeof ollamaAddress === 'string') throw new Error('missing ollama port');

    const received: string[] = [];
    server = http.createServer();
    const wss = new WebSocketServer({ server });
    wss.on('connection', (socket) => {
      socket.on('message', (data) => {
        const raw = data.toString();
        received.push(raw);
        const envelope = JSON.parse(raw) as { type: string };
        if (envelope.type === 'register') {
          socket.send(JSON.stringify({
            type: 'task_start',
            request_id: 'task-request-safe-failure',
            payload: {
              task_id: 'task-safe-failure-1',
              kind: 'classify_message',
              priority: 80,
              model: 'qwen2.5:0.5b',
              timeout_ms: 5000,
              input: { text: sensitiveText, classes: ['sales', 'support', 'spam', 'other'] },
              options: { temperature: 0, num_ctx: 1024, think: false, stream: false }
            }
          }));
        }
      });
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing server port');

    const config = loadConfig({
      ROUTER_URL: `ws://127.0.0.1:${address.port}`,
      CLIENT_DATA_DIR: dir,
      OLLAMA_BASE_URL: `http://127.0.0.1:${ollamaAddress.port}`,
      CLIENT_FAST_HEARTBEAT_MS: '1000',
      CLIENT_NAME: 'safe-task-error-client'
    });
    const connection = new RouterConnection(config, 'host-safe-task-error-id', '0.1.0');
    try {
      connection.connect();
      await waitFor(() => received.some((raw) => JSON.parse(raw).type === 'task_error'), 1500);
    } finally {
      connection.close();
      await new Promise<void>((resolve) => ollama.close(() => resolve()));
      await rm(dir, { recursive: true, force: true });
    }

    const errorEnvelope = received.map((raw) => JSON.parse(raw)).find((item) => item.type === 'task_error');
    expect(errorEnvelope.payload.error).toMatchObject({
      code: 'ollama_request_failed',
      message: 'Ollama request failed'
    });
    expect(errorEnvelope.payload.error.details.diagnostics.path).toBe('/api/chat');
    expect(errorEnvelope.payload.error.details.diagnostics.attempts[0].response_status).toBe(500);
    expect(JSON.stringify(errorEnvelope.payload.error.details)).toContain(sensitiveText);
    expect(errorEnvelope.payload.trace_events).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: 'ollama_chat_initial', status: 'failed' })
    ]));
  });

  it('aborts an in-flight task when the router sends task_cancel', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'local-ai-client-task-cancel-'));
    let chatStarted = false;
    let chatRequestClosed = false;
    const ollama = http.createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/api/version') return res.end(JSON.stringify({ version: '0.21.0' }));
      if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'qwen2.5:0.5b' }] }));
      if (req.url === '/api/ps') return res.end(JSON.stringify({ models: [] }));
      if (req.url === '/api/chat') {
        chatStarted = true;
        req.on('close', () => {
          chatRequestClosed = true;
        });
        return;
      }
      return res.end(JSON.stringify({}));
    });
    await new Promise<void>((resolve) => ollama.listen(0, '127.0.0.1', resolve));
    const ollamaAddress = ollama.address();
    if (!ollamaAddress || typeof ollamaAddress === 'string') throw new Error('missing ollama port');

    let routerSocket: WebSocket | null = null;
    const received: string[] = [];
    server = http.createServer();
    const wss = new WebSocketServer({ server });
    wss.on('connection', (socket) => {
      routerSocket = socket;
      socket.on('message', (data) => {
        const raw = data.toString();
        received.push(raw);
        const envelope = JSON.parse(raw) as { type: string };
        if (envelope.type === 'register') {
          socket.send(JSON.stringify({
            type: 'task_start',
            request_id: 'task-request-cancel',
            payload: {
              task_id: 'task-cancel-1',
              kind: 'classify_message',
              priority: 80,
              model: 'qwen2.5:0.5b',
              timeout_ms: 5000,
              input: { text: 'Сколько стоит?', classes: ['sales', 'support', 'spam', 'other'] },
              options: { temperature: 0, num_ctx: 1024, think: false, stream: false }
            }
          }));
        }
      });
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing server port');

    const config = loadConfig({
      ROUTER_URL: `ws://127.0.0.1:${address.port}`,
      CLIENT_DATA_DIR: dir,
      OLLAMA_BASE_URL: `http://127.0.0.1:${ollamaAddress.port}`,
      CLIENT_FAST_HEARTBEAT_MS: '1000',
      CLIENT_NAME: 'task-cancel-client'
    });
    const connection = new RouterConnection(config, 'host-task-cancel-id', '0.1.0');
    try {
      connection.connect();
      await waitFor(() => chatStarted && routerSocket !== null, 1500);
      routerSocket?.send(JSON.stringify({
        type: 'task_cancel',
        request_id: 'task-cancel-request-1',
        payload: { task_id: 'task-cancel-1', reason: 'Job canceled' }
      }));
      await waitFor(() => received.some((raw) => JSON.parse(raw).type === 'task_error'), 1500);
    } finally {
      connection.close();
      await new Promise<void>((resolve) => ollama.close(() => resolve()));
      await rm(dir, { recursive: true, force: true });
    }

    const outboundTypes = received.map((raw) => JSON.parse(raw).type);
    const error = received.map((raw) => JSON.parse(raw)).find((item) => item.type === 'task_error');
    expect(error.payload).toMatchObject({
      task_id: 'task-cancel-1',
      error: { code: 'task_canceled', message: 'Task canceled by router' }
    });
    expect(outboundTypes).not.toContain('task_result');
    expect(chatRequestClosed).toBe(true);
  });

  it('runs enabled deploy_update commands and reports deploy_result', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'local-ai-client-deploy-ws-'));
    const command = path.join(dir, 'deploy-command.sh');
    await writeFile(command, '#!/bin/sh\nexit 0\n');
    await chmod(command, 0o700);
    const artifact = Buffer.from('client artifact');
    const artifactServer = http.createServer((_req, res) => res.end(artifact));
    await new Promise<void>((resolve) => artifactServer.listen(0, '127.0.0.1', resolve));
    const artifactAddress = artifactServer.address();
    if (!artifactAddress || typeof artifactAddress === 'string') throw new Error('missing artifact port');
    const received: string[] = [];
    server = http.createServer();
    const wss = new WebSocketServer({ server });
    wss.on('connection', (socket) => {
      socket.on('message', (data) => {
        const raw = data.toString();
        received.push(raw);
        const envelope = JSON.parse(raw) as { type: string };
        if (envelope.type === 'register') {
          socket.send(JSON.stringify({
            type: 'deploy_update',
            request_id: 'deploy-request-1',
            payload: {
              deploy_id: 'deploy-1',
              target_version: '0.1.1',
              artifact_url: `http://127.0.0.1:${artifactAddress.port}/client.tgz`,
              artifact_sha256: createHash('sha256').update(artifact).digest('hex')
            }
          }));
        }
      });
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing server port');

    const config = loadConfig({
      ROUTER_URL: `ws://127.0.0.1:${address.port}`,
      CLIENT_DATA_DIR: dir,
      CLIENT_DEPLOY_ENABLED: 'true',
      CLIENT_DEPLOY_COMMAND: command,
      CLIENT_NAME: 'deploy-client'
    });
    const connection = new RouterConnection(config, 'host-deploy-id', '0.1.0');
    connection.connect();

    await waitFor(() => received.some((raw) => {
      const envelope = JSON.parse(raw);
      return envelope.type === 'deploy_result' && envelope.payload.status === 'succeeded';
    }), 1500);
    connection.close();
    await new Promise<void>((resolve) => artifactServer.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  });

  it('runs command-only deploy_update for git autodeploy and reports current package version', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'local-ai-client-git-deploy-ws-'));
    const marker = path.join(dir, 'git-deploy-marker.json');
    const command = path.join(dir, 'autodeploy.sh');
    await writeFile(command, [
      '#!/bin/sh',
      `printf '{"artifact":"%s","target":"%s","deploy":"%s"}' "$1" "$2" "$3" > "${marker}"`,
      ''
    ].join('\n'));
    await chmod(command, 0o700);
    const received: string[] = [];
    server = http.createServer();
    const wss = new WebSocketServer({ server });
    wss.on('connection', (socket) => {
      socket.on('message', (data) => {
        const raw = data.toString();
        received.push(raw);
        const envelope = JSON.parse(raw) as { type: string };
        if (envelope.type === 'register') {
          socket.send(JSON.stringify({
            type: 'deploy_update',
            request_id: 'deploy-request-1',
            payload: {
              deploy_id: 'deploy-git-1'
            }
          }));
        }
      });
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing server port');

    const config = loadConfig({
      ROUTER_URL: `ws://127.0.0.1:${address.port}`,
      CLIENT_DATA_DIR: dir,
      CLIENT_DEPLOY_ENABLED: 'true',
      CLIENT_DEPLOY_COMMAND: command,
      CLIENT_NAME: 'git-deploy-client'
    });
    const connection = new RouterConnection(config, 'host-git-deploy-id', '0.1.0');
    connection.connect();

    await waitFor(() => received.some((raw) => {
      const envelope = JSON.parse(raw);
      return envelope.type === 'deploy_result' && envelope.payload.status === 'succeeded';
    }), 1500);
    connection.close();
    const deployResult = received.map((raw) => JSON.parse(raw)).find((item) => item.type === 'deploy_result');
    expect(deployResult.payload.client_version).toMatch(/^0\.2\.2\.\d+$/);
    expect(JSON.parse(await readFile(marker, 'utf8'))).toMatchObject({ artifact: '', target: '', deploy: 'deploy-git-1' });
    await rm(dir, { recursive: true, force: true });
  });

  it('runs guarded model_install commands and reports model_install_result', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'local-ai-client-model-install-'));
    let pulled = false;
    const ollama = http.createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/api/version') return res.end(JSON.stringify({ version: '0.21.0' }));
      if (req.url === '/api/ps') return res.end(JSON.stringify({ models: [] }));
      if (req.url === '/api/tags') return res.end(JSON.stringify({ models: pulled ? [{ name: 'qwen2.5:0.5b' }] : [] }));
      if (req.url === '/api/pull') {
        pulled = true;
        return res.end(JSON.stringify({ status: 'success' }));
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'not found' }));
    });
    await new Promise<void>((resolve) => ollama.listen(0, '127.0.0.1', resolve));
    const ollamaAddress = ollama.address();
    if (!ollamaAddress || typeof ollamaAddress === 'string') throw new Error('missing ollama port');

    const received: string[] = [];
    server = http.createServer();
    const wss = new WebSocketServer({ server });
    wss.on('connection', (socket) => {
      socket.on('message', (data) => {
        const raw = data.toString();
        received.push(raw);
        const envelope = JSON.parse(raw) as { type: string };
        if (envelope.type === 'register') {
          socket.send(JSON.stringify({
            type: 'model_install',
            request_id: 'model-install-request-1',
            payload: {
              command_id: 'model-command-1',
              model: 'qwen2.5:0.5b',
              timeout_ms: 120000,
              requirements: { min_ram_mb: 512 }
            }
          }));
        }
      });
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing server port');

    const config = loadConfig({
      ROUTER_URL: `ws://127.0.0.1:${address.port}`,
      OLLAMA_BASE_URL: `http://127.0.0.1:${ollamaAddress.port}`,
      CLIENT_DATA_DIR: dir,
      CLIENT_ALLOW_MODEL_PULL: 'true',
      CLIENT_NAME: 'model-install-client'
    });
    const connection = new RouterConnection(config, 'host-model-install-id', '0.1.0');
    connection.connect();

    await waitFor(() => received.some((raw) => {
      const envelope = JSON.parse(raw);
      return envelope.type === 'model_install_result' && envelope.payload.status === 'succeeded';
    }), 1500);
    expect(pulled).toBe(true);
    const result = received.map((raw) => JSON.parse(raw)).find((item) => item.type === 'model_install_result');
    expect(result.payload.telemetry).toMatchObject({
      command_id: 'model-command-1',
      model: 'qwen2.5:0.5b',
      status: 'succeeded',
      installed_after: true
    });
    const heartbeat = received.map((raw) => JSON.parse(raw)).find((item) => {
      return item.type === 'heartbeat' && item.payload.resources.model_install;
    });
    expect(heartbeat.payload.resources.model_install.allow_model_pull).toBe(true);
    connection.close();
    await new Promise<void>((resolve) => ollama.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  });
});

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
