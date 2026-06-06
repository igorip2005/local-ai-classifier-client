import { z } from 'zod';

export type Envelope<TPayload = unknown> = {
  type: string;
  request_id: string;
  payload: TPayload;
};

export type RegisterPayload = {
  host_id: string;
  setup_token?: string;
  client_version: string;
  build_id?: string;
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

export type CapabilitiesUpdatePayload = {
  host_id: string;
  client_version: string;
  build_id?: string;
  ollama: { base_url: string; version: string | null; ok: boolean };
  capabilities: HostCapabilities;
};

export type TaskStartPayload = {
  task_id: string;
  job_id?: string;
  kind: 'classify_message' | 'classify_batch_item' | 'chat_completion';
  priority: number;
  model: string;
  timeout_ms: number;
  input: {
    text?: string;
    messages?: { role: string; content: string }[];
    classes?: string[];
    metadata?: Record<string, unknown>;
  };
  options: { temperature: number; num_ctx: number; think: boolean; stream: boolean };
};

export type TaskResultPayload = {
  task_id: string;
  job_id?: string;
  status: 'succeeded';
  output: Record<string, unknown>;
  metering: Record<string, unknown>;
  raw_model_response: unknown;
};

export type TaskErrorPayload = {
  task_id: string;
  job_id?: string;
  status: 'failed';
  error: { code: string; message: string; details?: unknown };
};

export type TaskCancelPayload = {
  task_id: string;
  job_id?: string;
  reason: string;
};

export type DeployUpdatePayload = {
  deploy_id: string;
  target_version: string;
  artifact_url: string;
  artifact_sha256: string;
};

export type DeployResultPayload = {
  deploy_id: string;
  host_id: string;
  status: 'succeeded' | 'failed';
  client_version?: string;
  error?: { code: string; message: string };
};

const jsonObject = z.record(z.string(), z.unknown());

const taskOptionsSchema = z.object({
  temperature: z.number(),
  num_ctx: z.number().int().positive(),
  think: z.boolean(),
  stream: z.boolean()
});

const classifyTaskStartPayloadSchema = z.object({
  task_id: z.string().min(1),
  job_id: z.string().min(1).optional(),
  kind: z.enum(['classify_message', 'classify_batch_item']),
  priority: z.number().int(),
  model: z.string().min(1),
  timeout_ms: z.number().int().positive(),
  input: z.object({
    text: z.string().min(1),
    classes: z.array(z.string().min(1)).optional(),
    metadata: jsonObject.optional()
  }),
  options: taskOptionsSchema
});

const chatTaskStartPayloadSchema = z.object({
  task_id: z.string().min(1),
  job_id: z.string().min(1).optional(),
  kind: z.literal('chat_completion'),
  priority: z.number().int(),
  model: z.string().min(1),
  timeout_ms: z.number().int().positive(),
  input: z.object({
    messages: z.array(z.object({
      role: z.string().min(1),
      content: z.string().min(1)
    })).min(1),
    metadata: jsonObject.optional()
  }),
  options: taskOptionsSchema
});

const taskStartPayloadSchema = z.discriminatedUnion('kind', [
  classifyTaskStartPayloadSchema,
  chatTaskStartPayloadSchema
]);

const deployUpdatePayloadSchema = z.object({
  deploy_id: z.string().min(1),
  target_version: z.string().min(1),
  artifact_url: z.string().url(),
  artifact_sha256: z.string().regex(/^[a-f0-9]{64}$/i)
});

const taskCancelPayloadSchema = z.object({
  task_id: z.string().min(1),
  job_id: z.string().min(1).optional(),
  reason: z.string().min(1)
});

export const inboundRouterEnvelopeSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('task_start'),
    request_id: z.string().min(1),
    payload: taskStartPayloadSchema
  }),
  z.object({
    type: z.literal('task_cancel'),
    request_id: z.string().min(1),
    payload: taskCancelPayloadSchema
  }),
  z.object({
    type: z.literal('deploy_update'),
    request_id: z.string().min(1),
    payload: deployUpdatePayloadSchema
  })
]);

export type InboundRouterEnvelope = z.infer<typeof inboundRouterEnvelopeSchema>;

export function parseInboundRouterEnvelope(raw: string): InboundRouterEnvelope {
  return inboundRouterEnvelopeSchema.parse(JSON.parse(raw) as unknown);
}
