import os from 'node:os';
import type { ClientConfig } from './config.js';
import { collectResources } from './metrics.js';
import { OllamaClient } from './ollama.js';
import type { RegisterPayload } from './protocol.js';

export async function buildRegisterPayload(
  config: ClientConfig,
  hostId: string,
  version: string
): Promise<RegisterPayload> {
  const ollama = new OllamaClient(config.ollamaBaseUrl);
  const [health, models, resources] = await Promise.all([
    ollama.health(),
    ollama.discoverModels(),
    collectResources()
  ]);

  const payload: RegisterPayload = {
    host_id: hostId,
    client_version: version,
    build_id: config.buildId,
    hostname: config.clientName || os.hostname(),
    platform: { os: os.platform(), arch: os.arch() },
    ollama: { base_url: config.ollamaBaseUrl, version: health.version, ok: health.ok },
    capabilities: { models, resources }
  };
  if (config.setupToken) payload.setup_token = config.setupToken;
  return payload;
}
