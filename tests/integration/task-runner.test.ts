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
      if (req.url === '/api/chat') {
        res.setHeader('content-type', 'application/json');
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

  it('runs chat completion tasks against fake Ollama', async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/api/chat') {
        res.setHeader('content-type', 'application/json');
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
});
