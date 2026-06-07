import { z } from 'zod';
import { readFile } from 'node:fs/promises';
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

export type OllamaHealth = { ok: boolean; version: string | null };

export class OllamaClient {
  constructor(private readonly baseUrl: string) {}

  async health(): Promise<OllamaHealth> {
    for (const baseUrl of await this.candidateBaseUrls()) {
      try {
        const response = await fetch(`${baseUrl}/api/version`);
        if (!response.ok) continue;
        const body = await response.json() as { version?: string };
        return { ok: true, version: body.version ?? null };
      } catch {
        // Try the next candidate. WSL clients often need the Windows host gateway
        // instead of localhost when Ollama runs on the Windows side.
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
      const response = await fetch(`${this.baseUrl}/api/pull`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: modelName, stream: false }),
        signal: timeoutSignal
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`Ollama pull returned ${response.status}: ${text.slice(0, 200)}`);
    } finally {
      cleanup();
    }
  }

  async chat(body: Record<string, unknown>, timeoutMs: number, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const { signal: timeoutSignal, cleanup } = timeoutAbortSignal(timeoutMs, signal);
    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: timeoutSignal
      });
      const text = await response.text();
      const parsed = safeJson(text);
      if (!response.ok) {
        throw new Error(`Ollama returned ${response.status}: ${text.slice(0, 200)}`);
      }
      return parsed ?? { raw: text };
    } finally {
      cleanup();
    }
  }

  private async tags(): Promise<Omit<HostModel, 'loaded'>[]> {
    for (const baseUrl of await this.candidateBaseUrls()) {
      try {
        const response = await fetch(`${baseUrl}/api/tags`);
        if (!response.ok) continue;
        const parsed = tagsSchema.parse(await response.json());
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
    for (const baseUrl of await this.candidateBaseUrls()) {
      try {
        const response = await fetch(`${baseUrl}/api/ps`);
        if (!response.ok) continue;
        const parsed = psSchema.parse(await response.json());
        return new Set(parsed.models.map((model) => model.name));
      } catch {
        // Try the next candidate.
      }
    }
    return new Set();
  }

  private async candidateBaseUrls(): Promise<string[]> {
    const candidates = [this.baseUrl];
    if (isWsl()) {
      const gateway = await wslHostGateway();
      if (gateway) candidates.push(`http://${gateway}:11434`);
      candidates.push('http://host.docker.internal:11434');
    }
    return Array.from(new Set(candidates));
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
