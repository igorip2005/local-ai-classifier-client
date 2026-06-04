import 'dotenv/config';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { collectMetrics, diffMetrics } from './metrics.js';
import { insertAiRequest, pool } from './db.js';

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: process.env.JSON_LIMIT || '2mb' }));

const PORT = Number(process.env.PORT || 3088);
const HOST = process.env.HOST || '0.0.0.0';
const OLLAMA_BASE_URL = (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || 'qwen3:1.7b';
const DEFAULT_THINK = parseBool(process.env.DEFAULT_THINK, false);
const DEFAULT_STREAM = parseBool(process.env.DEFAULT_STREAM, false);
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 120_000);
const LOG_FULL_BODIES = parseBool(process.env.LOG_FULL_BODIES, true);

app.use((req, res, next) => {
  if (!process.env.API_KEY) return next();
  const token = req.get('x-api-key') || req.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (token !== process.env.API_KEY) return res.status(401).json({ error: 'Unauthorized' });
  next();
});

app.get('/health', async (_req, res) => {
  let db = 'ok';
  try { await pool.query('SELECT 1'); } catch (e) { db = e.message; }
  res.json({ ok: true, db, ollamaBaseUrl: OLLAMA_BASE_URL, defaultModel: DEFAULT_MODEL });
});

app.get('/v1/requests/:id', async (req, res) => {
  const result = await pool.query('SELECT * FROM ai_requests WHERE id = $1', [req.params.id]);
  if (!result.rowCount) return res.status(404).json({ error: 'not found' });
  res.json(result.rows[0]);
});

app.get('/v1/requests', async (req, res) => {
  const limit = Math.min(Number(req.query.limit || 50), 500);
  const result = await pool.query('SELECT id, created_at, finished_at, source_ip, path, model, status_code, prompt_tokens, completion_tokens, total_tokens, duration_ms, error FROM ai_requests ORDER BY created_at DESC LIMIT $1', [limit]);
  res.json({ items: result.rows });
});

app.post('/v1/chat', (req, res) => proxyOllama(req, res, '/api/chat'));
app.post('/api/chat', (req, res) => proxyOllama(req, res, '/api/chat'));
app.post('/v1/generate', (req, res) => proxyOllama(req, res, '/api/generate'));
app.post('/api/generate', (req, res) => proxyOllama(req, res, '/api/generate'));

async function proxyOllama(req, res, ollamaPath) {
  const requestId = randomUUID();
  const started = process.hrtime.bigint();
  const createdAt = new Date();
  const source = getSource(req);
  const body = normalizeBody(req.body || {});
  const model = body.model || DEFAULT_MODEL;
  body.model = model;

  const before = await collectMetrics();
  let responseBody = null;
  let statusCode = 0;
  let errorText = null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const response = await fetch(`${OLLAMA_BASE_URL}${ollamaPath}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    statusCode = response.status;
    const text = await response.text();
    responseBody = safeJson(text) ?? { raw: text };
    res.status(statusCode).json({ ...responseBody, wrapper: { request_id: requestId } });
  } catch (error) {
    statusCode = error.name === 'AbortError' ? 504 : 502;
    errorText = error.message;
    responseBody = { error: errorText, wrapper: { request_id: requestId } };
    res.status(statusCode).json(responseBody);
  } finally {
    const finishedAt = new Date();
    const durationMs = Number((process.hrtime.bigint() - started) / 1_000_000n);
    const after = await collectMetrics();
    const delta = diffMetrics(before, after, durationMs);
    const tokenStats = extractTokenStats(responseBody);

    const row = {
      id: requestId,
      created_at: createdAt,
      finished_at: finishedAt,
      source_ip: source.ip,
      source_host: source.host,
      user_agent: source.userAgent,
      forwarded_for: source.forwardedFor,
      path: req.path,
      method: req.method,
      model,
      ollama_base_url: OLLAMA_BASE_URL,
      request_body: LOG_FULL_BODIES ? body : summarizeBody(body),
      response_body: LOG_FULL_BODIES ? responseBody : summarizeBody(responseBody),
      status_code: statusCode,
      error: errorText || responseBody?.error || null,
      prompt_tokens: tokenStats.prompt,
      completion_tokens: tokenStats.completion,
      total_tokens: tokenStats.total,
      ollama_timings: tokenStats.timings,
      duration_ms: durationMs,
      wall_seconds: durationMs / 1000,
      cpu_before: before.cpu,
      cpu_after: after.cpu,
      cpu_delta: delta.cpu,
      gpu_before: before.gpu,
      gpu_after: after.gpu,
      gpu_delta: delta.gpu,
      power_before: before.power,
      power_after: after.power,
      power_delta: delta.power,
      process_before: before.process,
      process_after: after.process,
      process_delta: delta.process,
      meta: { wrapper_version: '0.1.0', ollama_path: ollamaPath },
    };

    insertAiRequest(row).catch((e) => console.error('failed to persist ai request', requestId, e));
  }
}

function normalizeBody(body) {
  const normalized = { ...body };
  if (normalized.think === undefined) normalized.think = DEFAULT_THINK;
  if (normalized.stream === undefined) normalized.stream = DEFAULT_STREAM;
  if (!normalized.options) normalized.options = {};
  if (normalized.options.temperature === undefined) normalized.options.temperature = 0;
  if (normalized.options.num_ctx === undefined) normalized.options.num_ctx = 4096;
  return normalized;
}

function extractTokenStats(body) {
  const prompt = intOrNull(body?.prompt_eval_count ?? body?.prompt_tokens);
  const completion = intOrNull(body?.eval_count ?? body?.completion_tokens);
  const total = intOrNull(body?.total_tokens ?? ((prompt ?? 0) + (completion ?? 0)));
  const timings = {
    total_duration_ns: intOrNull(body?.total_duration),
    load_duration_ns: intOrNull(body?.load_duration),
    prompt_eval_duration_ns: intOrNull(body?.prompt_eval_duration),
    eval_duration_ns: intOrNull(body?.eval_duration),
  };
  return { prompt, completion, total, timings };
}

function getSource(req) {
  return {
    ip: req.ip || req.socket.remoteAddress,
    host: req.hostname,
    userAgent: req.get('user-agent') || null,
    forwardedFor: req.get('x-forwarded-for') || null,
  };
}

function summarizeBody(value) {
  if (!value || typeof value !== 'object') return value;
  return { keys: Object.keys(value), model: value.model, body_bytes: Buffer.byteLength(JSON.stringify(value)) };
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function intOrNull(v) {
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

function parseBool(v, fallback) {
  if (v === undefined || v === null || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

app.listen(PORT, HOST, () => {
  console.log(`local-ai-classifier listening on http://${HOST}:${PORT}`);
});
