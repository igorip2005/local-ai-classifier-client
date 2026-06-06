import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFileCallback);
const serviceFile = 'local-ai-classifier.service';

export type ExecFile = (file: string, args: string[]) => Promise<{ stdout: string | Buffer; stderr: string | Buffer }>;

export type ClientServiceStatusCheck = {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
};

export type ClientServiceStatusReport = {
  checked_at: string;
  status: 'pass' | 'warn' | 'fail';
  service_file: string;
  checks: ClientServiceStatusCheck[];
  active_state: string | null;
  sub_state: string | null;
  unit_file_state: string | null;
};

// Production gate for IMPLEMENTATION_DETAILS.md section 25: the client should
// run as a managed host-agent, not as an unobserved shell process on test hosts.
export async function runClientServiceStatus(
  options: { now?: Date; execFile?: ExecFile; serviceName?: string } = {}
): Promise<ClientServiceStatusReport> {
  const execFile = options.execFile ?? defaultExecFile;
  const serviceName = options.serviceName ?? serviceFile;
  const checks: ClientServiceStatusCheck[] = [];
  const enabled = await runSystemctl(execFile, ['--user', 'is-enabled', serviceName]);
  const active = await runSystemctl(execFile, ['--user', 'is-active', serviceName]);
  const show = await runSystemctl(execFile, ['--user', 'show', serviceName, '--property=ActiveState', '--property=SubState', '--property=UnitFileState']);

  checks.push(enabled.ok && enabled.stdout.trim() === 'enabled'
    ? pass('enabled', `${serviceName} is enabled`)
    : fail('enabled', `${serviceName} is not enabled: ${describeCommand(enabled)}`));
  checks.push(active.ok && active.stdout.trim() === 'active'
    ? pass('active', `${serviceName} is active`)
    : fail('active', `${serviceName} is not active: ${describeCommand(active)}`));

  const state = show.ok ? parseSystemctlShow(show.stdout) : {};
  if (!show.ok) checks.push(warn('service metadata', `systemctl show failed: ${describeCommand(show)}`));

  return {
    checked_at: (options.now ?? new Date()).toISOString(),
    status: aggregateStatus(checks),
    service_file: serviceName,
    checks,
    active_state: normalizeState(state.ActiveState),
    sub_state: normalizeState(state.SubState),
    unit_file_state: normalizeState(state.UnitFileState)
  };
}

async function runSystemctl(execFile: ExecFile, args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string; error: string | null }> {
  try {
    const result = await execFile('systemctl', args);
    return { ok: true, stdout: result.stdout.toString(), stderr: result.stderr.toString(), error: null };
  } catch (error) {
    const commandError = error as { stdout?: string | Buffer; stderr?: string | Buffer; message?: string };
    return {
      ok: false,
      stdout: commandError.stdout?.toString() ?? '',
      stderr: commandError.stderr?.toString() ?? '',
      error: commandError.message ?? 'systemctl command failed'
    };
  }
}

function parseSystemctlShow(output: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of output.split(/\r?\n/)) {
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    values[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return values;
}

function normalizeState(value: string | undefined): string | null {
  if (!value || value === 'n/a') return null;
  return value;
}

function describeCommand(result: { stdout: string; stderr: string; error: string | null }): string {
  const details = [result.stdout.trim(), result.stderr.trim(), result.error ?? ''].filter(Boolean);
  return details.join(' | ') || 'no output';
}

function aggregateStatus(checks: ClientServiceStatusCheck[]): ClientServiceStatusReport['status'] {
  if (checks.some((check) => check.status === 'fail')) return 'fail';
  if (checks.some((check) => check.status === 'warn')) return 'warn';
  return 'pass';
}

function pass(name: string, message: string): ClientServiceStatusCheck {
  return { name, status: 'pass', message };
}

function warn(name: string, message: string): ClientServiceStatusCheck {
  return { name, status: 'warn', message };
}

function fail(name: string, message: string): ClientServiceStatusCheck {
  return { name, status: 'fail', message };
}

async function defaultExecFile(file: string, args: string[]): Promise<{ stdout: string | Buffer; stderr: string | Buffer }> {
  return await execFileAsync(file, args);
}
