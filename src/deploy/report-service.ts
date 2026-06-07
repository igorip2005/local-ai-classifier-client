import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type ClientDeployReportKind = 'production-readiness';

export type ClientDeployReportEnvelope<TPayload> = {
  kind: ClientDeployReportKind;
  generated_at: string;
  payload: TPayload;
};

export type ClientDeployReportItem = ClientDeployReportEnvelope<unknown> & {
  file_name: string;
};

export async function writeClientDeployReport<TPayload>(
  kind: ClientDeployReportKind,
  payload: TPayload,
  options: { reportDir?: string; now?: Date } = {}
): Promise<{ path: string; envelope: ClientDeployReportEnvelope<TPayload> }> {
  const generatedAt = (options.now ?? new Date()).toISOString();
  const reportDir = options.reportDir ?? defaultReportDir();
  const envelope = { kind, generated_at: generatedAt, payload };
  await mkdir(reportDir, { recursive: true, mode: 0o700 });
  const filePath = path.join(reportDir, `${fileTimestamp(generatedAt)}_${kind}.json`);
  await writeFile(filePath, `${JSON.stringify(envelope, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  return { path: filePath, envelope };
}

export async function listClientDeployReports(
  options: { reportDir?: string; kind?: ClientDeployReportKind; limit?: number } = {}
): Promise<{ items: ClientDeployReportItem[] }> {
  const reportDir = options.reportDir ?? defaultReportDir();
  const limit = Math.max(1, Math.min(options.limit ?? 20, 100));
  const entries = await readdir(reportDir, { withFileTypes: true }).catch(() => []);
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort()
    .reverse();
  const items: ClientDeployReportItem[] = [];
  for (const fileName of files) {
    const item = await readClientDeployReport(path.join(reportDir, fileName), fileName).catch(() => null);
    if (!item) continue;
    if (options.kind && item.kind !== options.kind) continue;
    items.push(item);
    if (items.length >= limit) break;
  }
  return { items };
}

function defaultReportDir(): string {
  return process.env.CLIENT_REPORT_DIR ?? path.join(process.cwd(), 'var', 'reports');
}

function fileTimestamp(value: string): string {
  return value.replace(/[:.]/g, '-');
}

async function readClientDeployReport(filePath: string, fileName: string): Promise<ClientDeployReportItem | null> {
  const parsed = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
  if (!parsed || typeof parsed !== 'object') return null;
  const item = parsed as { kind?: unknown; generated_at?: unknown; payload?: unknown };
  if (item.kind !== 'production-readiness' || typeof item.generated_at !== 'string') return null;
  return {
    file_name: fileName,
    kind: item.kind,
    generated_at: item.generated_at,
    payload: redactReportValue(item.payload)
  };
}

function redactReportValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return redactReportText(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= 6) return '[redacted-depth-limit]';
  if (Array.isArray(value)) return value.map((item) => redactReportValue(item, depth + 1));
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => {
    if (isSensitiveReportKey(key)) return [key, '[redacted]'];
    return [key, redactReportValue(item, depth + 1)];
  }));
}

function redactReportText(value: string): string {
  return value
    .replace(/https?:\/\/[^\s"']+/gi, (match) => redactReportUrl(match))
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[redacted]')
    .replace(/((?:x-api-key|x-internal-admin-key)\s*[:=]\s*)[^\s,;}]+/gi, '$1[redacted]')
    .replace(/((?:api_key|admin_key|access_token|setup_token|token|signature|sig|artifact_url)\s*[:=]\s*)[^\s,;}]+/gi, '$1[redacted]')
    .slice(0, 1000);
}

function redactReportUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}${url.search ? '?[redacted]' : ''}`;
  } catch {
    return '[redacted-url]';
  }
}

function isSensitiveReportKey(key: string): boolean {
  return /(?:api[_-]?key|admin[_-]?key|authorization|bearer|access[_-]?token|setup[_-]?token|token|signature|sig|artifact[_-]?url)/i.test(key);
}
