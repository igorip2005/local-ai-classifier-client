import 'dotenv/config';
import { z } from 'zod';

const configSchema = z.object({
  nodeEnv: z.string().default('development'),
  routerUrl: z.string().url().default('ws://127.0.0.1:3100/v1/hosts/connect'),
  setupToken: z.string().optional(),
  ollamaBaseUrl: z.string().url().default('http://127.0.0.1:11434'),
  clientName: z.string().min(1).default('local-test-client'),
  buildId: z.string().min(1).default('dev'),
  localLogMode: z.enum(['none', 'metadata', 'full']).default('none'),
  maxConcurrentTasks: z.coerce.number().int().positive().default(1),
  allowModelPull: z.coerce.boolean().default(false),
  manualEnabled: z.coerce.boolean().default(true),
  fastHeartbeatMs: z.coerce.number().int().positive().default(5000),
  fullHeartbeatMs: z.coerce.number().int().positive().default(15000),
  clientDataDir: z.string().min(1).default('/www/projects/local-ai-classifier-client/var'),
  statusPort: z.coerce.number().int().min(0).max(65535).default(0),
  deployEnabled: z.coerce.boolean().default(false),
  deployCommand: z.string().optional(),
  deployTimeoutMs: z.coerce.number().int().positive().default(120_000),
  logLevel: z.string().default('info')
});

export type ClientConfig = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ClientConfig {
  const parsed = configSchema.parse({
    nodeEnv: env.NODE_ENV,
    routerUrl: env.ROUTER_URL,
    setupToken: env.SETUP_TOKEN || undefined,
    ollamaBaseUrl: env.OLLAMA_BASE_URL,
    clientName: env.CLIENT_NAME,
    buildId: env.CLIENT_BUILD_ID,
    localLogMode: env.CLIENT_LOCAL_LOG_MODE,
    maxConcurrentTasks: env.CLIENT_MAX_CONCURRENT_TASKS,
    allowModelPull: env.CLIENT_ALLOW_MODEL_PULL,
    manualEnabled: env.CLIENT_MANUAL_ENABLED,
    fastHeartbeatMs: env.CLIENT_FAST_HEARTBEAT_MS,
    fullHeartbeatMs: env.CLIENT_FULL_HEARTBEAT_MS,
    clientDataDir: env.CLIENT_DATA_DIR,
    statusPort: env.CLIENT_STATUS_PORT,
    deployEnabled: env.CLIENT_DEPLOY_ENABLED,
    deployCommand: env.CLIENT_DEPLOY_COMMAND || undefined,
    deployTimeoutMs: env.CLIENT_DEPLOY_TIMEOUT_MS,
    logLevel: env.LOG_LEVEL
  });
  assertProductionConfig(parsed);
  return parsed;
}

export const config = loadConfig();

function assertProductionConfig(config: ClientConfig): void {
  if (config.nodeEnv !== 'production') return;

  const failures: string[] = [];
  if (config.routerUrl === 'ws://127.0.0.1:3100/v1/hosts/connect') {
    failures.push('ROUTER_URL must point to the production router in production');
  }
  if (config.clientName === 'local-test-client') {
    failures.push('CLIENT_NAME must identify this host in production');
  }
  if (config.buildId === 'dev') {
    failures.push('CLIENT_BUILD_ID must identify the deployed build in production');
  }
  if (config.setupToken && config.setupToken.length < 16) {
    failures.push('SETUP_TOKEN must be at least 16 characters when provided in production');
  }
  if (config.deployEnabled && !config.deployCommand) {
    failures.push('CLIENT_DEPLOY_COMMAND is required when trusted deploy is enabled in production');
  }
  if (failures.length > 0) {
    throw new Error(`Invalid production client configuration: ${failures.join('; ')}`);
  }
}
