import { execFile as execFileCallback } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { runClientDeployPreflight, type ClientDeployPreflightReport } from './preflight-service.js';

const execFileAsync = promisify(execFileCallback);
const serviceFile = 'local-ai-classifier.service';

export type ExecFile = (file: string, args: string[]) => Promise<{ stdout: string | Buffer; stderr: string | Buffer }>;

export type InstallCommand = {
  file: string;
  args: string[];
  display: string;
};

export type InstallStep = {
  command: string;
  status: 'planned' | 'succeeded' | 'failed';
  stdout: string | null;
  stderr: string | null;
  error: string | null;
};

export type ClientServiceInstallReport = {
  checked_at: string;
  mode: 'dry_run' | 'execute';
  status: 'pass' | 'warn' | 'fail';
  preflight: ClientDeployPreflightReport;
  commands: string[];
  steps: InstallStep[];
  next_commands: string[];
};

export async function runClientServiceInstall(
  options: {
    repoRoot?: string;
    deployDir?: string;
    userSystemdDir?: string;
    now?: Date;
    execute?: boolean;
    execFile?: ExecFile;
  } = {}
): Promise<ClientServiceInstallReport> {
  const repoRoot = options.repoRoot ?? process.cwd();
  const deployDir = options.deployDir ?? path.join(repoRoot, 'deploy');
  const userSystemdDir = options.userSystemdDir ?? path.join(os.homedir(), '.config/systemd/user');
  const execute = options.execute === true;
  const preflightOptions: Parameters<typeof runClientDeployPreflight>[0] = { repoRoot, deployDir };
  if (options.now) preflightOptions.now = options.now;
  const preflight = await runClientDeployPreflight(preflightOptions);
  const commands = buildClientServiceInstallCommands(deployDir, userSystemdDir);

  if (preflight.status === 'fail') {
    return report(options.now, execute, 'fail', preflight, commands, [], []);
  }

  const steps: InstallStep[] = [];
  if (!execute) {
    steps.push(...commands.map((command) => ({ command: command.display, status: 'planned' as const, stdout: null, stderr: null, error: null })));
    return report(options.now, execute, preflight.status, preflight, commands, steps, ['CLIENT_DEPLOY_INSTALL_CONFIRM=1 npm run deploy:install-service']);
  }

  const execFile = options.execFile ?? defaultExecFile;
  for (const command of commands) {
    steps.push(await runCommand(execFile, command));
  }
  const status = steps.some((step) => step.status === 'failed') ? 'fail' : preflight.status;
  return report(options.now, execute, status, preflight, commands, steps, ['npm run deploy:service-status']);
}

export function buildClientServiceInstallCommands(deployDir: string, userSystemdDir = path.join(os.homedir(), '.config/systemd/user')): InstallCommand[] {
  return [
    { file: 'mkdir', args: ['-p', userSystemdDir], display: `mkdir -p ${quote(userSystemdDir)}` },
    installCommand(path.join(deployDir, serviceFile), path.join(userSystemdDir, serviceFile)),
    { file: 'systemctl', args: ['--user', 'daemon-reload'], display: 'systemctl --user daemon-reload' },
    { file: 'systemctl', args: ['--user', 'enable', '--now', serviceFile], display: `systemctl --user enable --now ${serviceFile}` }
  ];
}

function installCommand(source: string, target: string): InstallCommand {
  return {
    file: 'install',
    args: ['-m', '0644', source, target],
    display: `install -m 0644 ${quote(source)} ${quote(target)}`
  };
}

async function runCommand(execFile: ExecFile, command: InstallCommand): Promise<InstallStep> {
  try {
    const result = await execFile(command.file, command.args);
    return {
      command: command.display,
      status: 'succeeded',
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
      error: null
    };
  } catch (error) {
    const commandError = error as { stdout?: string | Buffer; stderr?: string | Buffer; message?: string };
    return {
      command: command.display,
      status: 'failed',
      stdout: commandError.stdout?.toString() ?? null,
      stderr: commandError.stderr?.toString() ?? null,
      error: commandError.message ?? 'command failed'
    };
  }
}

function report(
  now: Date | undefined,
  execute: boolean,
  status: ClientServiceInstallReport['status'],
  preflight: ClientDeployPreflightReport,
  commands: InstallCommand[],
  steps: InstallStep[],
  nextCommands: string[]
): ClientServiceInstallReport {
  return {
    checked_at: (now ?? new Date()).toISOString(),
    mode: execute ? 'execute' : 'dry_run',
    status,
    preflight,
    commands: commands.map((command) => command.display),
    steps,
    next_commands: nextCommands
  };
}

function quote(value: string): string {
  return value.includes(' ') ? `'${value.replaceAll("'", "'\\''")}'` : value;
}

async function defaultExecFile(file: string, args: string[]): Promise<{ stdout: string | Buffer; stderr: string | Buffer }> {
  return await execFileAsync(file, args);
}
