import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import type { ClientConfig } from './config.js';
import { buildRegisterPayload } from './capabilities.js';
import { collectResources } from './metrics.js';
import { evaluateAvailability } from './availability.js';
import type { DeployResultPayload, DeployUpdatePayload, Envelope, HeartbeatPayload, TaskErrorPayload, TaskResultPayload, TaskStartPayload } from './protocol.js';
import { runTask } from './task-runner.js';
import { readManualEnabled } from './control.js';
import { runDeployUpdate } from './deploy.js';
import { OllamaClient } from './ollama.js';

export class RouterConnection extends EventEmitter {
  private socket: WebSocket | null = null;
  private fastTimer: NodeJS.Timeout | null = null;
  private fullTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private activeTasks = 0;
  private reconnectAttempt = 0;
  private shouldReconnect = true;
  private loadedModels: string[] = [];
  private capabilitiesSignature = '';

  constructor(
    private readonly config: ClientConfig,
    private readonly hostId: string,
    private readonly version: string
  ) {
    super();
  }

  connect(): void {
    this.clearReconnectTimer();
    this.socket = new WebSocket(this.config.routerUrl, { handshakeTimeout: 10_000 });
    this.socket.on('open', () => void this.register());
    this.socket.on('message', (data) => this.handleMessage(data.toString()));
    this.socket.on('close', () => {
      this.stopHeartbeat();
      this.scheduleReconnect();
    });
    this.socket.on('error', (error) => {
      this.emit('connection_error', error);
      this.socket?.close();
    });
  }

  close(): void {
    this.shouldReconnect = false;
    this.clearReconnectTimer();
    this.stopHeartbeat();
    this.socket?.close();
  }

  private async register(): Promise<void> {
    const payload = await buildRegisterPayload(this.config, this.hostId, this.version);
    this.reconnectAttempt = 0;
    this.loadedModels = payload.capabilities.models.filter((model) => model.loaded).map((model) => model.name);
    this.capabilitiesSignature = signature(payload.capabilities.models.map((model) => `${model.name}:${model.loaded}`).sort());
    this.send({ type: 'register', request_id: randomUUID(), payload });
    this.startHeartbeat();
    this.startCapabilitiesRefresh();
    this.emit('registered_sent', payload);
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect || this.reconnectTimer) return;
    const delayMs = Math.min(30_000, 500 * 2 ** this.reconnectAttempt);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delayMs);
    this.emit('reconnect_scheduled', { delay_ms: delayMs, attempt: this.reconnectAttempt });
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.fastTimer = setInterval(() => void this.sendHeartbeat(), this.config.fastHeartbeatMs);
    void this.sendHeartbeat();
  }

  private stopHeartbeat(): void {
    if (this.fastTimer) clearInterval(this.fastTimer);
    if (this.fullTimer) clearInterval(this.fullTimer);
    this.fastTimer = null;
    this.fullTimer = null;
  }

  private startCapabilitiesRefresh(): void {
    if (this.fullTimer) clearInterval(this.fullTimer);
    this.fullTimer = setInterval(() => void this.refreshCapabilities(), this.config.fullHeartbeatMs);
  }

  private async refreshCapabilities(): Promise<void> {
    const payload = await buildRegisterPayload(this.config, this.hostId, this.version);
    const nextSignature = signature(payload.capabilities.models.map((model) => `${model.name}:${model.loaded}`).sort());
    this.loadedModels = payload.capabilities.models.filter((model) => model.loaded).map((model) => model.name);
    if (nextSignature === this.capabilitiesSignature) return;
    this.capabilitiesSignature = nextSignature;
    this.send({
      type: 'capabilities_update',
      request_id: randomUUID(),
      payload: {
        host_id: this.hostId,
        client_version: this.version,
        build_id: this.config.buildId,
        ollama: payload.ollama,
        capabilities: payload.capabilities
      }
    });
  }

  private async sendHeartbeat(): Promise<void> {
    const ollama = new OllamaClient(this.config.ollamaBaseUrl);
    const [resources, manualEnabled, ollamaHealth] = await Promise.all([
      collectResources(),
      readManualEnabled(this.config.clientDataDir, this.config.manualEnabled),
      ollama.health()
    ]);
    const availability = evaluateAvailability(resources, manualEnabled);
    const processes = typeof resources.processes === 'object' && resources.processes
      ? resources.processes as Record<string, unknown>
      : {};
    const payload: HeartbeatPayload = {
      host_id: this.hostId,
      ts: new Date().toISOString(),
      status: this.activeTasks > 0 ? 'busy' : availability.can_accept_tasks ? 'idle' : 'paused',
      active_tasks: this.activeTasks,
      queue_depth: 0,
      models_loaded: this.loadedModels,
      resources: {
        ...resources,
        processes: { ...processes, ollama_running: ollamaHealth.ok },
        ollama: ollamaHealth,
        availability
      }
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
      if (envelope.type === 'task_start') {
        void this.handleTaskStart(envelope.payload as TaskStartPayload);
      }
      if (envelope.type === 'deploy_update') {
        void this.handleDeployUpdate(envelope.payload as DeployUpdatePayload);
      }
      this.emit(envelope.type, envelope.payload);
    } catch (error) {
      this.emit('protocol_error', error);
    }
  }

  private async handleTaskStart(task: TaskStartPayload): Promise<void> {
    if (this.activeTasks >= this.config.maxConcurrentTasks) {
      this.sendTaskError(task, 'client_busy', 'Client is at max concurrency');
      return;
    }
    this.activeTasks += 1;
    try {
      const result = await runTask(this.config, task);
      this.sendTaskResult(result);
    } catch (error) {
      this.sendTaskError(task, 'task_failed', error instanceof Error ? error.message : 'Task failed');
    } finally {
      this.activeTasks -= 1;
      void this.sendHeartbeat();
    }
  }

  private sendTaskResult(payload: TaskResultPayload): void {
    this.send({ type: 'task_result', request_id: randomUUID(), payload });
  }

  private sendTaskError(task: TaskStartPayload, code: string, message: string): void {
    const payload: TaskErrorPayload = {
      task_id: task.task_id,
      status: 'failed',
      error: { code, message }
    };
    if (task.job_id) payload.job_id = task.job_id;
    this.send({ type: 'task_error', request_id: randomUUID(), payload });
  }

  private async handleDeployUpdate(payload: DeployUpdatePayload): Promise<void> {
    const result = await runDeployUpdate(this.config, this.hostId, this.version, payload);
    this.sendDeployResult(result);
  }

  private sendDeployResult(payload: DeployResultPayload): void {
    this.send({ type: 'deploy_result', request_id: randomUUID(), payload });
  }
}

function signature(values: string[]): string {
  return values.join('|');
}
