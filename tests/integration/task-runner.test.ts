import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { runTask } from '../../src/task-runner.js';

let server: http.Server | null = null;

afterEach(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = null;
});

describe('runTask', () => {
  it('calls fake Ollama and normalizes classification JSON', async () => {
    server = http.createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'qwen2.5:0.5b' }] }));
      if (req.url === '/api/ps') return res.end(JSON.stringify({ models: [] }));
      if (req.url === '/api/chat') {
        res.end(JSON.stringify({
          message: { content: '{"label":"sales","confidence":0.88,"reason":"price question"}' },
          prompt_eval_count: 20,
          eval_count: 10
        }));
      }
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing server port');
    const config = loadConfig({ OLLAMA_BASE_URL: `http://127.0.0.1:${address.port}` });

    const result = await runTask(config, {
      task_id: 'task-1',
      kind: 'classify_message',
      priority: 80,
      model: 'qwen2.5:0.5b',
      timeout_ms: 5000,
      input: { text: 'Сколько стоит?', classes: ['sales', 'support', 'spam', 'other'] },
      options: { temperature: 0, num_ctx: 1024, think: false, stream: false }
    });

    expect(result.output).toMatchObject({ label: 'sales', confidence: 0.88 });
    expect(result.metering.prompt_tokens).toBe(20);
  });

  it('repairs invalid fake Ollama classification JSON with a second strict request', async () => {
    let chatCalls = 0;
    server = http.createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'qwen2.5:0.5b' }] }));
      if (req.url === '/api/ps') return res.end(JSON.stringify({ models: [] }));
      if (req.url === '/api/chat') {
        chatCalls += 1;
        return res.end(JSON.stringify({
          message: {
            content: chatCalls === 1
              ? 'not valid json'
              : '{"label":"support","confidence":0.77,"reason":"repair produced valid JSON"}'
          }
        }));
      }
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing server port');
    const config = loadConfig({ OLLAMA_BASE_URL: `http://127.0.0.1:${address.port}` });

    const result = await runTask(config, {
      task_id: 'invalid-json-task-1',
      kind: 'classify_message',
      priority: 80,
      model: 'qwen2.5:0.5b',
      timeout_ms: 5000,
      input: { text: 'unmatched message', classes: ['sales', 'support', 'spam', 'other'] },
      options: { temperature: 0, num_ctx: 1024, think: false, stream: false }
    });

    expect(chatCalls).toBe(2);
    expect(result.output).toMatchObject({
      label: 'support',
      confidence: 0.77,
      reason: 'repair produced valid JSON'
    });
    expect(result.raw_model_response).toHaveProperty('initial');
    expect(result.raw_model_response).toHaveProperty('repair');
  });

  it('runs chat completion tasks against fake Ollama', async () => {
    server = http.createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'qwen2.5:0.5b' }] }));
      if (req.url === '/api/ps') return res.end(JSON.stringify({ models: [] }));
      if (req.url === '/api/chat') {
        res.end(JSON.stringify({ message: { content: 'hello from model' }, prompt_eval_count: 4, eval_count: 5 }));
      }
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing server port');
    const config = loadConfig({ OLLAMA_BASE_URL: `http://127.0.0.1:${address.port}` });

    const result = await runTask(config, {
      task_id: 'chat-task-1',
      kind: 'chat_completion',
      priority: 70,
      model: 'qwen2.5:0.5b',
      timeout_ms: 5000,
      input: { messages: [{ role: 'user', content: 'hello' }] },
      options: { temperature: 0, num_ctx: 1024, think: false, stream: false }
    });

    expect(result.output.content).toBe('hello from model');
    expect(result.metering.completion_tokens).toBe(5);
  });

  it('pulls missing model when model pull is enabled', async () => {
    let pulled = false;
    server = http.createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/api/tags') {
        return res.end(JSON.stringify({ models: pulled ? [{ name: 'missing:latest' }] : [] }));
      }
      if (req.url === '/api/ps') return res.end(JSON.stringify({ models: [] }));
      if (req.url === '/api/pull') {
        pulled = true;
        req.resume();
        return res.end(JSON.stringify({ status: 'success' }));
      }
      if (req.url === '/api/chat') {
        return res.end(JSON.stringify({ message: { content: '{"label":"other","confidence":0.5,"reason":"ok"}' } }));
      }
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing server port');
    const config = loadConfig({ OLLAMA_BASE_URL: `http://127.0.0.1:${address.port}`, CLIENT_ALLOW_MODEL_PULL: 'true' });

    await runTask(config, {
      task_id: 'pull-task-1',
      kind: 'classify_message',
      priority: 80,
      model: 'missing:latest',
      timeout_ms: 5000,
      input: { text: 'hello', classes: ['other'] },
      options: { temperature: 0, num_ctx: 1024, think: false, stream: false }
    });

    expect(pulled).toBe(true);
  });
});
