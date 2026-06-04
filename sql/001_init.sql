CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS ai_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  source_ip TEXT,
  source_host TEXT,
  user_agent TEXT,
  forwarded_for TEXT,
  path TEXT NOT NULL,
  method TEXT NOT NULL,
  model TEXT NOT NULL,
  ollama_base_url TEXT NOT NULL,
  request_body JSONB,
  response_body JSONB,
  status_code INTEGER,
  error TEXT,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  ollama_timings JSONB,
  duration_ms INTEGER,
  wall_seconds NUMERIC,
  cpu_before JSONB,
  cpu_after JSONB,
  cpu_delta JSONB,
  gpu_before JSONB,
  gpu_after JSONB,
  gpu_delta JSONB,
  power_before JSONB,
  power_after JSONB,
  power_delta JSONB,
  process_before JSONB,
  process_after JSONB,
  process_delta JSONB,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_ai_requests_created_at ON ai_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_requests_model ON ai_requests(model);
CREATE INDEX IF NOT EXISTS idx_ai_requests_source_ip ON ai_requests(source_ip);
CREATE INDEX IF NOT EXISTS idx_ai_requests_status_code ON ai_requests(status_code);
