import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import type { ClientConfig } from './config.js';
import { buildRegisterPayload } from './capabilities.js';
import { collectResources } from './metrics.js';
import { evaluateAvailability, type Availability } from './availability.js';
import {
  parseInboundRouterEnvelope,
  type DeployResultPayload,
  type DeployUpdatePayload,
  type Envelope,
  type HeartbeatPayload,
  type ModelInstallPayload,
  type ModelInstallResultPayload,
  type TaskErrorPayload,
  type TaskCancelPayload,
  type TaskResultPayload,
  type TaskStartPayload
} from './protocol.js';
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
  private readonly taskControllers = new Map<string, AbortController>();

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
      client_version: this.version,
      build_id: this.config.buildId,
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
      const envelope = parseInboundRouterEnvelope(raw);
      if (envelope.type === 'task_start') {
        void this.handleTaskStart(envelope.payload as TaskStartPayload);
      }
      if (envelope.type === 'task_cancel') {
        this.handleTaskCancel(envelope.payload as TaskCancelPayload);
      }
      if (envelope.type === 'deploy_update') {
        void this.handleDeployUpdate(envelope.payload as DeployUpdatePayload);
      }
      if (envelope.type === 'model_install') {
        void this.handleModelInstall(envelope.payload as ModelInstallPayload);
      }
      this.emit(envelope.type, envelope.payload);
    } catch (error) {
      this.emit('protocol_error', error);
    }
  }

  private async handleTaskStart(task: TaskStartPayload): Promise<void> {
    const availability = await this.currentAvailability();
    if (!availability.can_accept_tasks) {
      this.sendTaskError(task, 'client_unavailable', `Client is unavailable: ${availability.mode}`);
      void this.sendHeartbeat();
      return;
    }
    if (this.activeTasks >= this.config.maxConcurrentTasks) {
      this.sendTaskError(task, 'client_busy', 'Client is at max concurrency');
      return;
    }
    this.activeTasks += 1;
    const controller = new AbortController();
    this.taskControllers.set(task.task_id, controller);
    try {
      const result = await runTask(this.config, task, controller.signal);
      if (!controller.signal.aborted) this.sendTaskResult(result);
    } catch (error) {
      if (controller.signal.aborted) {
        this.sendTaskError(task, 'task_canceled', 'Task canceled by router');
      } else {
        const safeError = safeTaskFailure(error);
        this.sendTaskError(task, safeError.code, safeError.message);
      }
    } finally {
      this.taskControllers.delete(task.task_id);
      this.activeTasks -= 1;
      void this.sendHeartbeat();
    }
  }

  private handleTaskCancel(payload: TaskCancelPayload): void {
    this.taskControllers.get(payload.task_id)?.abort();
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

  private async handleModelInstall(payload: ModelInstallPayload): Promise<void> {
    try {
      if (!this.config.allowModelPull) {
        throw new Error('Model install is disabled by CLIENT_ALLOW_MODEL_PULL=false');
      }
      const resources = await collectResources();
      const compatibility = evaluateModelInstallCompatibility(resources, payload.requirements);
      if (!compatibility.compatible) throw new Error(compatibility.reason);
      const ollama = new OllamaClient(this.config.ollamaBaseUrl);
      await ollama.pullModel(payload.model, payload.timeout_ms);
      await this.refreshCapabilities();
      void this.sendHeartbeat();
      this.sendModelInstallResult({ command_id: payload.command_id, host_id: this.hostId, model: payload.model, status: 'succeeded' });
    } catch (error) {
      this.sendModelInstallResult({
        command_id: payload.command_id,
        host_id: this.hostId,
        model: payload.model,
        status: 'failed',
        error: safeModelInstallFailure(error)
      });
    }
  }

  private sendModelInstallResult(payload: ModelInstallResultPayload): void {
    this.send({ type: 'model_install_result', request_id: randomUUID(), payload });
  }

  private async currentAvailability(): Promise<Availability> {
    const [resources, manualEnabled] = await Promise.all([
      collectResources(),
      readManualEnabled(this.config.clientDataDir, this.config.manualEnabled)
    ]);
    return evaluateAvailability(resources, manualEnabled);
  }
}

function evaluateModelInstallCompatibility(
  resources: Record<string, unknown>,
  requirements: ModelInstallPayload['requirements']
): { compatible: boolean; reason: string } {
  const ramTotalMb = numberOrNull(resources.ram_total_mb);
  const gpu = Array.isArray(resources.gpu) ? resources.gpu : [];
  const maxVramMb = maxNumber(gpu.map((item) => item && typeof item === 'object' ? numberOrNull((item as Record<string, unknown>).vram_total_mb) : null));
  const hasRam = ramTotalMb !== null && ramTotalMb >= requirements.min_ram_mb;
  const hasVram = requirements.min_vram_mb === undefined || (maxVramMb !== null && maxVramMb >= requirements.min_vram_mb);
  if (hasRam || hasVram) return { compatible: true, reason: 'compatible' };
  return {
    compatible: false,
    reason: `Host resources do not satisfy model requirements: RAM ${formatMb(ramTotalMb)} / required ${formatMb(requirements.min_ram_mb)}, VRAM ${formatMb(maxVramMb)} / required ${requirements.min_vram_mb === undefined ? 'optional' : formatMb(requirements.min_vram_mb)}`
  };
}

function safeModelInstallFailure(error: unknown): { code: string; message: string } {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('CLIENT_ALLOW_MODEL_PULL=false')) return { code: 'model_install_disabled', message: 'Model install is disabled on this client' };
  if (message.startsWith('Host resources do not satisfy')) return { code: 'model_incompatible', message };
  if (message.startsWith('Ollama pull returned')) return { code: 'ollama_pull_failed', message: 'Ollama model pull failed' };
  if (message.includes('fetch failed') || message.includes('aborted')) return { code: 'ollama_unavailable', message: 'Ollama is unavailable' };
  return { code: 'model_install_failed', message: 'Model install failed' };
}

function numberOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function maxNumber(values: Array<number | null>): number | null {
  const numbers = values.filter((value): value is number => value !== null);
  return numbers.length ? Math.max(...numbers) : null;
}

function formatMb(value: number | null): string {
  if (value === null) return 'unknown';
  return value >= 1024 ? `${Math.round((value / 1024) * 10) / 10}GB` : `${value}MB`;
}

function signature(values: string[]): string {
  return values.join('|');
}

function safeTaskFailure(error: unknown): { code: string; message: string } {
  // Router persists task_error payloads. IMPLEMENTATION_DETAILS.md sections 20
  // and 22 require privacy-aware failure reporting, so never forward raw Ollama
  // error bodies because they may include prompt or message text.
  const message = error instanceof Error ? error.message : '';
  if (message.startsWith('Model is not installed locally')) {
    return { code: 'model_not_available', message: 'Requested model is not installed locally' };
  }
  if (message.startsWith('Unsupported task kind')) {
    return { code: 'unsupported_task_kind', message: 'Unsupported task kind' };
  }
  if (message.startsWith('Ollama returned') || message.startsWith('Ollama pull returned')) {
    return { code: 'ollama_request_failed', message: 'Ollama request failed' };
  }
  if (message.includes('fetch failed') || message.includes('aborted')) {
    return { code: 'ollama_unavailable', message: 'Ollama is unavailable' };
  }
  return { code: 'task_failed', message: 'Task failed' };
}
