import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import type { ClientConfig } from './config.js';
import { buildRegisterPayload } from './capabilities.js';
import { collectResources } from './metrics.js';
import { evaluateAvailability } from './availability.js';
import type { Envelope, HeartbeatPayload } from './protocol.js';

export class RouterConnection extends EventEmitter {
  private socket: WebSocket | null = null;
  private fastTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly config: ClientConfig,
    private readonly hostId: string,
    private readonly version: string
  ) {
    super();
  }

  connect(): void {
    this.socket = new WebSocket(this.config.routerUrl, { handshakeTimeout: 10_000 });
    this.socket.on('open', () => void this.register());
    this.socket.on('message', (data) => this.handleMessage(data.toString()));
    this.socket.on('close', () => this.stopHeartbeat());
    this.socket.on('error', (error) => this.emit('connection_error', error));
  }

  close(): void {
    this.stopHeartbeat();
    this.socket?.close();
  }

  private async register(): Promise<void> {
    const payload = await buildRegisterPayload(this.config, this.hostId, this.version);
    this.send({ type: 'register', request_id: randomUUID(), payload });
    this.startHeartbeat();
    this.emit('registered_sent', payload);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.fastTimer = setInterval(() => void this.sendHeartbeat(), this.config.fastHeartbeatMs);
    void this.sendHeartbeat();
  }

  private stopHeartbeat(): void {
    if (this.fastTimer) clearInterval(this.fastTimer);
    this.fastTimer = null;
  }

  private async sendHeartbeat(): Promise<void> {
    const resources = await collectResources();
    const availability = evaluateAvailability(resources, this.config.manualEnabled);
    const payload: HeartbeatPayload = {
      host_id: this.hostId,
      ts: new Date().toISOString(),
      status: availability.can_accept_tasks ? 'idle' : 'paused',
      active_tasks: 0,
      queue_depth: 0,
      models_loaded: [],
      resources: { ...resources, availability }
    };
    this.send({ type: 'heartbeat', request_id: randomUUID(), payload });
  }

  private send(envelope: Envelope): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(envelope));
    }
  }

  private handleMessage(raw: string): void {
    try {
      const envelope = JSON.parse(raw) as Envelope;
      this.emit(envelope.type, envelope.payload);
    } catch (error) {
      this.emit('protocol_error', error);
    }
  }
}
