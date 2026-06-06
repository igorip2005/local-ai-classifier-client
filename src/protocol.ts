export type Envelope<TPayload = unknown> = {
  type: string;
  request_id: string;
  payload: TPayload;
};

export type RegisterPayload = {
  host_id: string;
  setup_token?: string;
  client_version: string;
  hostname: string;
  platform: { os: string; arch: string };
  ollama: { base_url: string; version: string | null; ok: boolean };
  capabilities: HostCapabilities;
};

export type HostCapabilities = {
  models: HostModel[];
  resources: Record<string, unknown>;
};

export type HostModel = {
  name: string;
  size_bytes?: number;
  family?: string;
  parameter_size?: string;
  quantization?: string;
  loaded: boolean;
};

export type HeartbeatPayload = {
  host_id: string;
  ts: string;
  status: 'idle' | 'busy' | 'paused';
  active_tasks: number;
  queue_depth: number;
  models_loaded: string[];
  resources: Record<string, unknown>;
};
