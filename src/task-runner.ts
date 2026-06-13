import type { ClientConfig } from './config.js';
import { OllamaClient, OllamaRequestError, type OllamaRequestDiagnostics } from './ollama.js';
import type { TaskClientTraceEvent, TaskResultPayload, TaskStartPayload } from './protocol.js';
import { writeLocalTaskLog } from './local-log.js';
import { applyClassificationGuardrails, type Classification } from './classification-rules.js';

export async function runTask(config: ClientConfig, task: TaskStartPayload, signal?: AbortSignal): Promise<TaskResultPayload> {
  const traceEvents: TaskClientTraceEvent[] = [];
  try {
    traceEvents.push(...await ensureTaskModel(config, task.model, task.timeout_ms, signal));
    if (task.kind === 'chat_completion') return await runChatCompletion(config, task, traceEvents, signal);
    if (task.kind !== 'classify_message' && task.kind !== 'classify_batch_item') {
      throw new Error(`Unsupported task kind: ${task.kind}`);
    }

    const started = Date.now();
    const ollama = new OllamaClient(config.ollamaBaseUrl);
    const body = buildClassifyChatBody(task);
    const initial = await runOllamaChat(ollama, body, task.timeout_ms, 'ollama_chat_initial', traceEvents, signal);
    const raw = initial.response;
    const classes = task.input.classes ?? ['sales', 'support', 'spam', 'other'];
    const normalized = normalizeModelResponse(raw, classes);
    traceEvents.push(traceEvent('model_response_normalized', 'ok', null, {
      valid_json: normalized.validJson,
      output_label: normalized.output.label,
      output_confidence: normalized.output.confidence
    }));
    let finalRaw = raw;
    let modelOutput = normalized.output;
    if (!normalized.validJson) {
      const repair = await runOllamaChat(
        ollama,
        buildRepairChatBody(task.model, normalized.rawContent, task.input.text ?? '', classes),
        task.timeout_ms,
        'ollama_chat_repair',
        traceEvents,
        signal
      );
      finalRaw = repair.response;
      modelOutput = normalizeModelResponse(finalRaw, classes).output;
    }
    const output = applyClassificationGuardrails(
      modelOutput,
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
      metering: extractMetering(finalRaw, durationMs),
      raw_model_response: finalRaw === raw ? raw : { initial: raw, repair: finalRaw },
      trace_events: traceEvents
    };
    if (task.job_id) result.job_id = task.job_id;
    return result;
  } catch (error) {
    throw taskExecutionError(error, traceEvents);
  }
}

async function ensureTaskModel(config: ClientConfig, model: string, timeoutMs: number, signal?: AbortSignal): Promise<TaskClientTraceEvent[]> {
  const traceEvents: TaskClientTraceEvent[] = [];
  const ollama = new OllamaClient(config.ollamaBaseUrl);
  const checkStarted = new Date();
  const installed = await ollama.hasModel(model);
  traceEvents.push(traceEvent('ollama_model_check', 'ok', checkStarted, { model, installed }));
  if (installed) return traceEvents;
  if (!config.allowModelPull) {
    throw new Error(`Model is not installed locally and model pull is disabled: ${model}`);
  }
  const pullStarted = new Date();
  const diagnostics = await ollama.pullModelWithDiagnostics(model, timeoutMs, signal);
  traceEvents.push(traceEvent('ollama_model_pull', 'ok', pullStarted, { model, diagnostics }));
  return traceEvents;
}

async function runChatCompletion(
  config: ClientConfig,
  task: TaskStartPayload,
  traceEvents: TaskClientTraceEvent[],
  signal?: AbortSignal
): Promise<TaskResultPayload> {
  const started = Date.now();
  const ollama = new OllamaClient(config.ollamaBaseUrl);
  const raw = (await runOllamaChat(ollama, {
    model: task.model,
    stream: false,
    think: false,
    options: { temperature: task.options.temperature, num_ctx: task.options.num_ctx ?? 2048 },
    messages: task.input.messages ?? []
  }, task.timeout_ms, 'ollama_chat_completion', traceEvents, signal)).response;
  const durationMs = Date.now() - started;
  const content = typeof raw.message === 'object' && raw.message
    ? String((raw.message as { content?: unknown }).content ?? '')
    : String(raw.response ?? '');
  const result: TaskResultPayload = {
    task_id: task.task_id,
    status: 'succeeded',
    output: { content },
    metering: extractMetering(raw, durationMs),
    raw_model_response: raw,
    trace_events: traceEvents
  };
  if (task.job_id) result.job_id = task.job_id;
  return result;
}

async function runOllamaChat(
  ollama: OllamaClient,
  body: Record<string, unknown>,
  timeoutMs: number,
  phase: string,
  traceEvents: TaskClientTraceEvent[],
  signal?: AbortSignal
): Promise<{ response: Record<string, unknown>; diagnostics: OllamaRequestDiagnostics }> {
  const started = new Date();
  try {
    const result = await ollama.chatWithDiagnostics(body, timeoutMs, signal);
    traceEvents.push(traceEvent(phase, 'ok', started, { diagnostics: result.diagnostics }));
    return result;
  } catch (error) {
    const meta: Record<string, unknown> = {};
    if (error instanceof OllamaRequestError) meta.diagnostics = error.diagnostics;
    traceEvents.push(traceEvent(phase, 'failed', started, meta));
    throw error;
  }
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

function buildRepairChatBody(model: string, rawContent: string | null, text: string, classes: string[]): Record<string, unknown> {
  return {
    model,
    stream: false,
    think: false,
    options: { temperature: 0, num_ctx: 1024 },
    messages: [
      { role: 'system', content: 'Repair the previous classifier output. Return only compact valid JSON. No markdown. No extra text.' },
      {
        role: 'user',
        content: [
          'Allowed labels:',
          classes.join(', '),
          'Required schema: {"label":"one_label","confidence":0.0,"reason":"short reason"}.',
          `Original message: ${JSON.stringify(text)}`,
          `Invalid model output: ${JSON.stringify(rawContent ?? '')}`
        ].join('\n')
      }
    ]
  };
}

function normalizeModelResponse(raw: Record<string, unknown>, classes: string[]): { output: Classification; validJson: boolean; rawContent: string | null } {
  const content = extractModelContent(raw);
  const parsed = typeof content === 'string' ? parseJsonObject(content) : null;
  if (!parsed) {
    return {
      output: { label: 'other', confidence: 0, reason: 'Model did not return valid JSON' },
      validJson: false,
      rawContent: typeof content === 'string' ? content : null
    };
  }

  const label = typeof parsed.label === 'string' && classes.includes(parsed.label) ? parsed.label : 'other';
  const confidence = typeof parsed.confidence === 'number' ? clamp(parsed.confidence, 0, 1) : 0;
  const reason = typeof parsed.reason === 'string' ? parsed.reason : '';
  return { output: { label, confidence, reason }, validJson: true, rawContent: typeof content === 'string' ? content : null };
}

function extractModelContent(raw: Record<string, unknown>): unknown {
  return typeof raw.message === 'object' && raw.message
    ? (raw.message as { content?: unknown }).content
    : raw.response;
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

function traceEvent(
  phase: string,
  status: TaskClientTraceEvent['status'],
  startedAt: Date | null,
  meta?: Record<string, unknown>
): TaskClientTraceEvent {
  const finishedAt = new Date();
  const event: TaskClientTraceEvent = {
    phase,
    finished_at: finishedAt.toISOString()
  };
  if (status !== undefined) event.status = status;
  if (startedAt) {
    event.started_at = startedAt.toISOString();
    event.duration_ms = Math.max(0, finishedAt.getTime() - startedAt.getTime());
  }
  if (meta) event.meta = meta;
  return event;
}

export class TaskExecutionError extends Error {
  constructor(
    cause: unknown,
    readonly traceEvents: TaskClientTraceEvent[],
    readonly details?: unknown
  ) {
    super(cause instanceof Error ? cause.message : 'Task failed');
    this.name = 'TaskExecutionError';
    this.cause = cause;
  }
}

function taskExecutionError(error: unknown, traceEvents: TaskClientTraceEvent[]): TaskExecutionError {
  const details = error instanceof OllamaRequestError ? { diagnostics: error.diagnostics } : undefined;
  return new TaskExecutionError(error, traceEvents, details);
}
