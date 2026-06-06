import type { ClientConfig } from './config.js';
import { OllamaClient } from './ollama.js';
import type { TaskResultPayload, TaskStartPayload } from './protocol.js';
import { writeLocalTaskLog } from './local-log.js';
import { applyClassificationGuardrails, type Classification } from './classification-rules.js';

export async function runTask(config: ClientConfig, task: TaskStartPayload): Promise<TaskResultPayload> {
  await ensureTaskModel(config, task.model, task.timeout_ms);
  if (task.kind === 'chat_completion') return await runChatCompletion(config, task);
  if (task.kind !== 'classify_message' && task.kind !== 'classify_batch_item') {
    throw new Error(`Unsupported task kind: ${task.kind}`);
  }

  const started = Date.now();
  const ollama = new OllamaClient(config.ollamaBaseUrl);
  const body = buildClassifyChatBody(task);
  const raw = await ollama.chat(body, task.timeout_ms);
  const classes = task.input.classes ?? ['sales', 'support', 'spam', 'other'];
  const output = applyClassificationGuardrails(
    normalizeModelResponse(raw, classes),
    task.input.text ?? '',
    classes
  );
  const durationMs = Date.now() - started;

  await writeLocalTaskLog(config, {
    task_id: task.task_id,
    model: task.model,
    status: 'succeeded',
    duration_ms: durationMs,
    output
  });

  const result: TaskResultPayload = {
    task_id: task.task_id,
    status: 'succeeded',
    output,
    metering: extractMetering(raw, durationMs),
    raw_model_response: raw
  };
  if (task.job_id) result.job_id = task.job_id;
  return result;
}

async function ensureTaskModel(config: ClientConfig, model: string, timeoutMs: number): Promise<void> {
  const ollama = new OllamaClient(config.ollamaBaseUrl);
  if (await ollama.hasModel(model)) return;
  if (!config.allowModelPull) {
    throw new Error(`Model is not installed locally and model pull is disabled: ${model}`);
  }
  await ollama.pullModel(model, timeoutMs);
}

async function runChatCompletion(config: ClientConfig, task: TaskStartPayload): Promise<TaskResultPayload> {
  const started = Date.now();
  const ollama = new OllamaClient(config.ollamaBaseUrl);
  const raw = await ollama.chat({
    model: task.model,
    stream: false,
    think: false,
    options: { temperature: task.options.temperature, num_ctx: task.options.num_ctx ?? 2048 },
    messages: task.input.messages ?? []
  }, task.timeout_ms);
  const durationMs = Date.now() - started;
  const content = typeof raw.message === 'object' && raw.message
    ? String((raw.message as { content?: unknown }).content ?? '')
    : String(raw.response ?? '');
  const result: TaskResultPayload = {
    task_id: task.task_id,
    status: 'succeeded',
    output: { content },
    metering: extractMetering(raw, durationMs),
    raw_model_response: raw
  };
  if (task.job_id) result.job_id = task.job_id;
  return result;
}

function buildClassifyChatBody(task: TaskStartPayload): Record<string, unknown> {
  const classes = task.input.classes ?? ['sales', 'support', 'spam', 'other'];
  const text = task.input.text ?? '';
  return {
    model: task.model,
    stream: false,
    think: false,
    options: { temperature: 0, num_ctx: task.options.num_ctx ?? 1024 },
    messages: [
      { role: 'system', content: 'Return only compact valid JSON. No markdown. No extra text.' },
      { role: 'user', content: buildPrompt(text, classes) }
    ]
  };
}

function buildPrompt(text: string, classes: string[]): string {
  return [
    'Classify the message into exactly one of these labels:',
    classes.join(', '),
    'Return JSON with schema: {"label":"one_label","confidence":0.0,"reason":"short reason"}.',
    'Use "other" when none of the labels clearly fit.',
    '',
    `Message: ${JSON.stringify(text)}`
  ].join('\n');
}

function normalizeModelResponse(raw: Record<string, unknown>, classes: string[]): Classification {
  const content = typeof raw.message === 'object' && raw.message
    ? (raw.message as { content?: unknown }).content
    : raw.response;
  const parsed = typeof content === 'string' ? parseJsonObject(content) : null;
  if (!parsed) return { label: 'other', confidence: 0, reason: 'Model did not return valid JSON' };

  const label = typeof parsed.label === 'string' && classes.includes(parsed.label) ? parsed.label : 'other';
  const confidence = typeof parsed.confidence === 'number' ? clamp(parsed.confidence, 0, 1) : 0;
  const reason = typeof parsed.reason === 'string' ? parsed.reason : '';
  return { label, confidence, reason };
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const direct = safeJson(text);
  if (direct) return direct;
  const match = text.match(/\{[\s\S]*\}/);
  return match ? safeJson(match[0]) : null;
}

function safeJson(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function extractMetering(raw: Record<string, unknown>, durationMs: number): Record<string, unknown> {
  return {
    prompt_tokens: numberOrNull(raw.prompt_eval_count),
    completion_tokens: numberOrNull(raw.eval_count),
    compute_ms: durationMs,
    total_ms: durationMs
  };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
