import { z } from 'zod';
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
    try {
      const response = await fetch(`${this.baseUrl}/api/version`);
      if (!response.ok) return { ok: false, version: null };
      const body = await response.json() as { version?: string };
      return { ok: true, version: body.version ?? null };
    } catch {
      return { ok: false, version: null };
    }
  }

  async discoverModels(): Promise<HostModel[]> {
    const [tags, loaded] = await Promise.all([this.tags(), this.loadedModelNames()]);
    return tags.map((model) => ({ ...model, loaded: loaded.has(model.name) }));
  }

  async hasModel(modelName: string): Promise<boolean> {
    const models = await this.discoverModels();
    return models.some((model) => model.name === modelName);
  }

  async pullModel(modelName: string, timeoutMs: number): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}/api/pull`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: modelName, stream: false }),
        signal: controller.signal
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`Ollama pull returned ${response.status}: ${text.slice(0, 200)}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  async chat(body: Record<string, unknown>, timeoutMs: number): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      const text = await response.text();
      const parsed = safeJson(text);
      if (!response.ok) {
        throw new Error(`Ollama returned ${response.status}: ${text.slice(0, 200)}`);
      }
      return parsed ?? { raw: text };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async tags(): Promise<Omit<HostModel, 'loaded'>[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) return [];
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
      return [];
    }
  }

  private async loadedModelNames(): Promise<Set<string>> {
    try {
      const response = await fetch(`${this.baseUrl}/api/ps`);
      if (!response.ok) return new Set();
      const parsed = psSchema.parse(await response.json());
      return new Set(parsed.models.map((model) => model.name));
    } catch {
      return new Set();
    }
  }
}

function safeJson(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}
