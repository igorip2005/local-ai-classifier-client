import 'dotenv/config';
import { z } from 'zod';

const configSchema = z.object({
  nodeEnv: z.string().default('development'),
  routerUrl: z.string().url().default('ws://127.0.0.1:3100/v1/hosts/connect'),
  setupToken: z.string().optional(),
  ollamaBaseUrl: z.string().url().default('http://127.0.0.1:11434'),
  clientName: z.string().min(1).default('local-test-client'),
  localLogMode: z.enum(['none', 'metadata', 'full']).default('none'),
  maxConcurrentTasks: z.coerce.number().int().positive().default(1),
  allowModelPull: z.coerce.boolean().default(false),
  manualEnabled: z.coerce.boolean().default(true),
  fastHeartbeatMs: z.coerce.number().int().positive().default(5000),
  fullHeartbeatMs: z.coerce.number().int().positive().default(15000),
  clientDataDir: z.string().min(1).default('/www/projects/local-ai-classifier-client/var'),
  logLevel: z.string().default('info')
});

export type ClientConfig = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ClientConfig {
  return configSchema.parse({
    nodeEnv: env.NODE_ENV,
    routerUrl: env.ROUTER_URL,
    setupToken: env.SETUP_TOKEN || undefined,
    ollamaBaseUrl: env.OLLAMA_BASE_URL,
    clientName: env.CLIENT_NAME,
    localLogMode: env.CLIENT_LOCAL_LOG_MODE,
    maxConcurrentTasks: env.CLIENT_MAX_CONCURRENT_TASKS,
    allowModelPull: env.CLIENT_ALLOW_MODEL_PULL,
    manualEnabled: env.CLIENT_MANUAL_ENABLED,
    fastHeartbeatMs: env.CLIENT_FAST_HEARTBEAT_MS,
    fullHeartbeatMs: env.CLIENT_FULL_HEARTBEAT_MS,
    clientDataDir: env.CLIENT_DATA_DIR,
    logLevel: env.LOG_LEVEL
  });
}

export const config = loadConfig();
