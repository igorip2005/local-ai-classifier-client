import http from 'node:http';
import type { ClientConfig } from './config.js';
import { readManualEnabled } from './control.js';
import { collectResources } from './metrics.js';
import { OllamaClient } from './ollama.js';

export class StatusServer {
  private server: http.Server | null = null;

  constructor(
    private readonly config: ClientConfig,
    private readonly hostId: string,
    private readonly version: string
  ) {}

  start(): void {
    if (this.config.statusPort === 0) return;
    this.server = http.createServer((req, res) => void this.handle(req, res));
    this.server.listen(this.config.statusPort, '127.0.0.1');
  }

  stop(): void {
    this.server?.close();
    this.server = null;
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (req.url !== '/status') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found' }));
      return;
    }
    const ollama = new OllamaClient(this.config.ollamaBaseUrl);
    const [manualEnabled, health, models, resources] = await Promise.all([
      readManualEnabled(this.config.clientDataDir, this.config.manualEnabled),
      ollama.health(),
      ollama.discoverModels(),
      collectResources()
    ]);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      host_id: this.hostId,
      client_version: this.version,
      manual_enabled: manualEnabled,
      ollama: health,
      models,
      resources
    }));
  }
}
