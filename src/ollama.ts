import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { execFile } from 'node:child_process';
import os from 'node:os';
import type { HostModel } from './protocol.js';

const tagsSchema = z.object({
  models: z.array(z.object({
    name: z.string(),
    size: z.number().optional(),
    details: z.object({
      family: z.string().optional(),
      parameter_size: z.string().optional(),
      quantization_level: z.string().optional()
    }).optional()
  })).default([])
});

const psSchema = z.object({
  models: z.array(z.object({ name: z.string() })).default([])
});

export type OllamaHealth = {
  ok: boolean;
  version: string | null;
  target_kind?: OllamaTarget['kind'];
  target_url?: string;
};

export type OllamaRequestDiagnostics = {
  path: string;
  method: string;
  timeout_ms?: number;
  target_kind?: OllamaTarget['kind'];
  target_url?: string;
  started_at?: string;
  finished_at?: string;
  duration_ms?: number;
  request_body?: unknown;
  response_status?: number;
  response_bytes?: number;
  response_text?: string;
  response_json_keys?: string[];
  stdout?: string;
  stderr?: string;
  error?: string;
  attempts?: OllamaRequestDiagnostics[];
};

export class OllamaRequestError extends Error {
  constructor(message: string, readonly diagnostics: OllamaRequestDiagnostics) {
    super(message);
    this.name = 'OllamaRequestError';
  }
}

type OllamaTarget =
  | { kind: 'http'; baseUrl: string }
  | { kind: 'windows-powershell'; baseUrl: string };

export class OllamaClient {
  constructor(private readonly baseUrl: string) {}

  async health(): Promise<OllamaHealth> {
    for (const target of await this.candidateTargets()) {
      try {
        const body = await requestJson(target, '/api/version') as { version?: string };
        return {
          ok: true,
          version: body.version ?? null,
          target_kind: target.kind,
          target_url: target.baseUrl
        };
      } catch {
        // Try the next candidate. WSL clients often need the Windows host gateway
        // or a PowerShell-side HTTP request when Ollama is bound to Windows localhost.
      }
    }
    return { ok: false, version: null };
  }

  async discoverModels(): Promise<HostModel[]> {
    const [tags, loaded] = await Promise.all([this.tags(), this.loadedModelNames()]);
    return tags.map((model) => ({ ...model, loaded: loaded.has(model.name) }));
  }

  async hasModel(modelName: string): Promise<boolean> {
    const models = await this.discoverModels();
    return models.some((model) => model.name === modelName);
  }

  async pullModel(modelName: string, timeoutMs: number, signal?: AbortSignal): Promise<void> {
    await this.pullModelWithDiagnostics(modelName, timeoutMs, signal);
  }

  async pullModelWithDiagnostics(modelName: string, timeoutMs: number, signal?: AbortSignal): Promise<OllamaRequestDiagnostics> {
    const { signal: timeoutSignal, cleanup } = timeoutAbortSignal(timeoutMs, signal);
    try {
      const result = await this.tryRequestJsonDetailed('/api/pull', {
        method: 'POST',
        body: { name: modelName, stream: true },
        signal: timeoutSignal,
        timeoutMs
      });
      return result.diagnostics;
    } finally {
      cleanup();
    }
  }

  async chat(body: Record<string, unknown>, timeoutMs: number, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return (await this.chatWithDiagnostics(body, timeoutMs, signal)).response;
  }

  async chatWithDiagnostics(
    body: Record<string, unknown>,
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<{ response: Record<string, unknown>; diagnostics: OllamaRequestDiagnostics }> {
    const { signal: timeoutSignal, cleanup } = timeoutAbortSignal(timeoutMs, signal);
    try {
      const result = await this.tryRequestJsonDetailed('/api/chat', {
        method: 'POST',
        body,
        signal: timeoutSignal,
        timeoutMs
      });
      return { response: result.body as Record<string, unknown>, diagnostics: result.diagnostics };
    } finally {
      cleanup();
    }
  }

  private async tags(): Promise<Omit<HostModel, 'loaded'>[]> {
    for (const target of await this.candidateTargets()) {
      try {
        const parsed = tagsSchema.parse(await requestJson(target, '/api/tags'));
        return parsed.models.map((model) => {
          const output: Omit<HostModel, 'loaded'> = { name: model.name };
          if (model.size !== undefined) output.size_bytes = model.size;
          if (model.details?.family) output.family = model.details.family;
          if (model.details?.parameter_size) output.parameter_size = model.details.parameter_size;
          if (model.details?.quantization_level) output.quantization = model.details.quantization_level;
          return output;
        });
      } catch {
        // Try the next candidate.
      }
    }
    return [];
  }

  private async loadedModelNames(): Promise<Set<string>> {
    for (const target of await this.candidateTargets()) {
      try {
        const parsed = psSchema.parse(await requestJson(target, '/api/ps'));
        return new Set(parsed.models.map((model) => model.name));
      } catch {
        // Try the next candidate.
      }
    }
    return new Set();
  }

  private async tryRequestJson(
    path: string,
    options: { method?: 'GET' | 'POST'; body?: Record<string, unknown>; signal?: AbortSignal; timeoutMs?: number } = {}
  ): Promise<unknown> {
    return (await this.tryRequestJsonDetailed(path, options)).body;
  }

  private async tryRequestJsonDetailed(
    path: string,
    options: { method?: 'GET' | 'POST'; body?: Record<string, unknown>; signal?: AbortSignal; timeoutMs?: number } = {}
  ): Promise<{ body: unknown; diagnostics: OllamaRequestDiagnostics }> {
    let lastError: unknown = null;
    const attempts: OllamaRequestDiagnostics[] = [];
    for (const target of await this.candidateTargets()) {
      try {
        const result = await requestJsonDetailed(target, path, options);
        return { ...result, diagnostics: { ...result.diagnostics, attempts } };
      } catch (error) {
        lastError = error;
        attempts.push(diagnosticsFromError(error, target, path, options));
      }
    }
    const diagnostics: OllamaRequestDiagnostics = {
      path,
      method: options.method ?? 'GET',
      attempts
    };
    if (options.timeoutMs !== undefined) diagnostics.timeout_ms = options.timeoutMs;
    if (options.body !== undefined) diagnostics.request_body = options.body;
    if (lastError instanceof OllamaRequestError) throw new OllamaRequestError(lastError.message, diagnostics);
    throw new OllamaRequestError(lastError instanceof Error ? lastError.message : 'Ollama request failed', diagnostics);
  }

  private async candidateTargets(): Promise<OllamaTarget[]> {
    const candidates: OllamaTarget[] = [{ kind: 'http', baseUrl: this.baseUrl }];
    if (isWsl()) {
      const gateway = await wslHostGateway();
      if (gateway) candidates.push({ kind: 'http', baseUrl: `http://${gateway}:11434` });
      candidates.push({ kind: 'http', baseUrl: 'http://host.docker.internal:11434' });
      candidates.push({ kind: 'windows-powershell', baseUrl: normalizeWindowsLocalOllamaUrl(this.baseUrl) });
    }
    const seen = new Set<string>();
    return candidates.filter((candidate) => {
      const key = `${candidate.kind}:${candidate.baseUrl}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}

async function requestJson(
  target: OllamaTarget,
  path: string,
  options: { method?: 'GET' | 'POST'; body?: Record<string, unknown>; signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<unknown> {
  return (await requestJsonDetailed(target, path, options)).body;
}

async function requestJsonDetailed(
  target: OllamaTarget,
  path: string,
  options: { method?: 'GET' | 'POST'; body?: Record<string, unknown>; signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<{ body: unknown; diagnostics: OllamaRequestDiagnostics }> {
  const startedMs = Date.now();
  const startedAt = new Date();
  const method = options.method ?? 'GET';
  const baseDiagnostics: OllamaRequestDiagnostics = {
    path,
    method,
    target_kind: target.kind,
    target_url: target.baseUrl,
    started_at: startedAt.toISOString()
  };
  if (options.timeoutMs !== undefined) baseDiagnostics.timeout_ms = options.timeoutMs;
  if (options.body !== undefined) baseDiagnostics.request_body = options.body;
  if (target.kind === 'windows-powershell') {
    try {
      const text = await windowsPowerShellRequest(`${target.baseUrl}${path}`, options);
      const body = parseOllamaText(text);
      return {
        body,
        diagnostics: finishDiagnostics(baseDiagnostics, startedMs, text, body)
      };
    } catch (error) {
      throw augmentOllamaError(error, baseDiagnostics, startedMs);
    }
  }

  const init: RequestInit = { method };
  if (options.body) {
    init.headers = { 'content-type': 'application/json' };
    init.body = JSON.stringify(options.body);
  }
  if (options.signal) init.signal = options.signal;
  try {
    const response = await fetch(`${target.baseUrl}${path}`, init);
    const text = await response.text();
    const body = parseOllamaText(text);
    const diagnostics = finishDiagnostics({ ...baseDiagnostics, response_status: response.status }, startedMs, text, body);
    if (!response.ok) {
      throw new OllamaRequestError(`Ollama returned ${response.status}: ${text.slice(0, 500)}`, diagnostics);
    }
    return { body, diagnostics };
  } catch (error) {
    throw augmentOllamaError(error, baseDiagnostics, startedMs);
  }
}

async function windowsPowerShellRequest(
  url: string,
  options: { method?: 'GET' | 'POST'; body?: Record<string, unknown>; signal?: AbortSignal; timeoutMs?: number }
): Promise<string> {
  const method = options.method ?? 'GET';
  const body = options.body ? JSON.stringify(options.body) : null;
  const bodyLine = body === null ? '' : ` -Body ${psString(body)} -ContentType 'application/json'`;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const timeoutSec = Math.max(1, Math.ceil(timeoutMs / 1000));
  const command = [
    "$ErrorActionPreference = 'Stop'",
    "$ProgressPreference = 'SilentlyContinue'",
    `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8`,
    `$response = Invoke-WebRequest -UseBasicParsing -Uri ${psString(url)} -Method ${psString(method)} -TimeoutSec ${timeoutSec}${bodyLine}`,
    '[Console]::Out.Write($response.Content)'
  ].join('; ');
  const encoded = Buffer.from(command, 'utf16le').toString('base64');
  const powershell = await windowsPowerShellBin();
  return new Promise((resolve, reject) => {
    execFile(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      encoding: 'utf8',
      timeout: timeoutMs + 1000,
      maxBuffer: 5 * 1024 * 1024,
      signal: options.signal
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new OllamaRequestError(formatPowerShellError(error, stderr, timeoutMs), {
          path: new URL(url).pathname,
          method,
          timeout_ms: timeoutMs,
          stdout: stdout.slice(0, 20_000),
          stderr: stderr.slice(0, 20_000),
          error: error.message
        }));
        return;
      }
      resolve(stdout);
    });
  });
}

function parseOllamaText(text: string): Record<string, unknown> {
  const direct = safeJson(text);
  if (direct) return direct;
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const events = lines.map((line) => safeJson(line) ?? { raw: line });
  return events.length ? { stream_events: events } : {};
}

function finishDiagnostics(
  base: OllamaRequestDiagnostics,
  startedMs: number,
  responseText: string,
  body: unknown
): OllamaRequestDiagnostics {
  const finishedAt = new Date();
  const diagnostics: OllamaRequestDiagnostics = {
    ...base,
    finished_at: finishedAt.toISOString(),
    duration_ms: finishedAt.getTime() - startedMs,
    response_bytes: Buffer.byteLength(responseText, 'utf8'),
    response_text: responseText.slice(0, 50_000)
  };
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    diagnostics.response_json_keys = Object.keys(body as Record<string, unknown>);
  }
  return diagnostics;
}

function augmentOllamaError(
  error: unknown,
  base: OllamaRequestDiagnostics,
  startedMs: number
): OllamaRequestError {
  if (error instanceof OllamaRequestError) {
    return new OllamaRequestError(error.message, {
      ...base,
      ...error.diagnostics,
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - startedMs
    });
  }
  return new OllamaRequestError(error instanceof Error ? error.message : 'Ollama request failed', {
    ...base,
    finished_at: new Date().toISOString(),
    duration_ms: Date.now() - startedMs,
    error: error instanceof Error ? error.message : String(error)
  });
}

function diagnosticsFromError(
  error: unknown,
  target: OllamaTarget,
  path: string,
  options: { method?: 'GET' | 'POST'; body?: Record<string, unknown>; timeoutMs?: number }
): OllamaRequestDiagnostics {
  if (error instanceof OllamaRequestError) return error.diagnostics;
  const diagnostics: OllamaRequestDiagnostics = {
    path,
    method: options.method ?? 'GET',
    target_kind: target.kind,
    target_url: target.baseUrl,
    error: error instanceof Error ? error.message : String(error)
  };
  if (options.timeoutMs !== undefined) diagnostics.timeout_ms = options.timeoutMs;
  if (options.body !== undefined) diagnostics.request_body = options.body;
  return diagnostics;
}

function formatPowerShellError(error: Error & { killed?: boolean; signal?: string; code?: unknown }, stderr: string, timeoutMs: number): string {
  const detail = stderr.trim() || error.message;
  if (error.killed || error.signal === 'SIGTERM' || detail.includes('ETIMEDOUT')) {
    return `Windows PowerShell Ollama request timed out after ${timeoutMs}ms`;
  }
  return detail;
}

async function windowsPowerShellBin(): Promise<string> {
  if (process.env.POWERSHELL_PATH) return process.env.POWERSHELL_PATH;
  const candidates = [
    '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',
    '/mnt/c/Windows/SysWOW64/WindowsPowerShell/v1.0/powershell.exe',
    '/mnt/c/Program Files/PowerShell/7/pwsh.exe',
    'powershell.exe'
  ];
  for (const candidate of candidates) {
    if (!candidate.startsWith('/')) return candidate;
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next common Windows PowerShell path.
    }
  }
  return 'powershell.exe';
}

function psString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function normalizeWindowsLocalOllamaUrl(baseUrl: string): string {
  try {
    const parsed = new URL(baseUrl);
    return `${parsed.protocol}//127.0.0.1:${parsed.port || '11434'}`;
  } catch {
    return 'http://127.0.0.1:11434';
  }
}

function safeJson(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isWsl(): boolean {
  return os.platform() === 'linux' && (
    os.release().toLowerCase().includes('microsoft')
    || Boolean(process.env.WSL_DISTRO_NAME)
  );
}

async function wslHostGateway(): Promise<string | null> {
  try {
    const resolv = await readFile('/etc/resolv.conf', 'utf8');
    const match = resolv.match(/^nameserver\s+(\S+)/m);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function timeoutAbortSignal(timeoutMs: number, parentSignal?: AbortSignal): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  if (parentSignal?.aborted) abort();
  else parentSignal?.addEventListener('abort', abort, { once: true });
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      parentSignal?.removeEventListener('abort', abort);
    }
  };
}
