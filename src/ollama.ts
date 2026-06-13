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
    const { signal: timeoutSignal, cleanup } = timeoutAbortSignal(timeoutMs, signal);
    try {
      await this.tryRequestJson('/api/pull', {
        method: 'POST',
        body: { name: modelName, stream: false },
        signal: timeoutSignal,
        timeoutMs
      });
    } finally {
      cleanup();
    }
  }

  async chat(body: Record<string, unknown>, timeoutMs: number, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const { signal: timeoutSignal, cleanup } = timeoutAbortSignal(timeoutMs, signal);
    try {
      return await this.tryRequestJson('/api/chat', {
        method: 'POST',
        body,
        signal: timeoutSignal,
        timeoutMs
      }) as Record<string, unknown>;
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
    let lastError: unknown = null;
    for (const target of await this.candidateTargets()) {
      try {
        return await requestJson(target, path, options);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Ollama request failed');
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
  if (target.kind === 'windows-powershell') {
    const text = await windowsPowerShellRequest(`${target.baseUrl}${path}`, options);
    return safeJson(text) ?? {};
  }

  const init: RequestInit = { method: options.method ?? 'GET' };
  if (options.body) {
    init.headers = { 'content-type': 'application/json' };
    init.body = JSON.stringify(options.body);
  }
  if (options.signal) init.signal = options.signal;
  const response = await fetch(`${target.baseUrl}${path}`, init);
  const text = await response.text();
  if (!response.ok) throw new Error(`Ollama returned ${response.status}: ${text.slice(0, 200)}`);
  return safeJson(text) ?? {};
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
        reject(new Error(formatPowerShellError(error, stderr, timeoutMs)));
        return;
      }
      resolve(stdout);
    });
  });
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
