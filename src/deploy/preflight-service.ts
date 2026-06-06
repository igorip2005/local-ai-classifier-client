import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

export type ClientDeployPreflightCheck = {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
};

export type ClientDeployPreflightReport = {
  checked_at: string;
  status: 'pass' | 'warn' | 'fail';
  checks: ClientDeployPreflightCheck[];
  install_commands: string[];
};

const serviceFile = 'local-ai-classifier.service';

export async function runClientDeployPreflight(
  options: {
    repoRoot?: string;
    deployDir?: string;
    packageJsonPath?: string;
    envFilePath?: string;
    now?: Date;
  } = {}
): Promise<ClientDeployPreflightReport> {
  const repoRoot = options.repoRoot ?? process.cwd();
  const deployDir = options.deployDir ?? path.join(repoRoot, 'deploy');
  const packageJsonPath = options.packageJsonPath ?? path.join(repoRoot, 'package.json');
  const envFilePath = options.envFilePath ?? path.join(repoRoot, '.env');
  const checks: ClientDeployPreflightCheck[] = [];

  const scripts = await readPackageScripts(packageJsonPath, checks);
  if (scripts) {
    checks.push(scripts.start ? pass('npm start script', 'package.json defines start') : fail('npm start script', 'package.json is missing start'));
    checks.push(scripts.build ? pass('npm build script', 'package.json defines build') : fail('npm build script', 'package.json is missing build'));
  }

  const service = await readDeployFile(path.join(deployDir, serviceFile), checks);
  if (service) validateService(service, checks);

  checks.push(await fileExists(envFilePath)
    ? pass('environment file', 'client .env exists on this host')
    : warn('environment file', 'client .env is not present here; create it on each deployment host and keep secrets out of git'));

  return {
    checked_at: (options.now ?? new Date()).toISOString(),
    status: aggregateStatus(checks),
    checks,
    install_commands: [
      'mkdir -p ~/.config/systemd/user',
      `cp deploy/${serviceFile} ~/.config/systemd/user/${serviceFile}`,
      'systemctl --user daemon-reload',
      `systemctl --user enable --now ${serviceFile}`,
      `systemctl --user status ${serviceFile} --no-pager`,
      `journalctl --user -u ${serviceFile} -n 100 --no-pager`
    ]
  };
}

async function readPackageScripts(packageJsonPath: string, checks: ClientDeployPreflightCheck[]): Promise<Record<string, string> | null> {
  try {
    const parsed = JSON.parse(await readFile(packageJsonPath, 'utf8')) as { scripts?: unknown };
    if (!parsed.scripts || typeof parsed.scripts !== 'object') {
      checks.push(fail('package.json', 'package.json has no scripts object'));
      return null;
    }
    checks.push(pass('package.json', 'package.json scripts loaded'));
    return parsed.scripts as Record<string, string>;
  } catch (error) {
    checks.push(fail('package.json', error instanceof Error ? error.message : 'failed to read package.json'));
    return null;
  }
}

async function readDeployFile(filePath: string, checks: ClientDeployPreflightCheck[]): Promise<string | null> {
  try {
    const content = await readFile(filePath, 'utf8');
    checks.push(pass('systemd service file', `${path.basename(filePath)} exists`));
    return content;
  } catch (error) {
    checks.push(fail('systemd service file', error instanceof Error ? error.message : `missing ${filePath}`));
    return null;
  }
}

function validateService(content: string, checks: ClientDeployPreflightCheck[]): void {
  checks.push(hasLine(content, '[Service]') ? pass('service section', 'has [Service] section') : fail('service section', 'missing [Service] section'));
  checks.push(hasLine(content, 'Type=simple') ? pass('service type', 'uses Type=simple') : fail('service type', 'must use Type=simple'));
  checks.push(/WorkingDirectory=\/www\/projects\/local-ai-classifier-client/.test(content)
    ? pass('working directory', 'points to client project directory')
    : fail('working directory', 'WorkingDirectory must point to client project directory'));
  checks.push(/EnvironmentFile=\/www\/projects\/local-ai-classifier-client\/\.env/.test(content)
    ? pass('environment file reference', 'uses client .env EnvironmentFile')
    : fail('environment file reference', 'missing client .env EnvironmentFile'));
  checks.push(/ExecStart=\/usr\/bin\/npm start(?:\s|$)/.test(content)
    ? pass('exec start', 'runs npm start')
    : fail('exec start', 'ExecStart must run npm start'));
  checks.push(hasLine(content, 'Restart=always') ? pass('restart policy', 'uses Restart=always') : fail('restart policy', 'must restart always'));
  checks.push(hasLine(content, '[Install]') && hasLine(content, 'WantedBy=default.target')
    ? pass('install section', 'installs into default.target for systemd user service')
    : fail('install section', 'missing default.target install section'));
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function hasLine(content: string, line: string): boolean {
  return content.split(/\r?\n/).some((item) => item.trim() === line);
}

function aggregateStatus(checks: ClientDeployPreflightCheck[]): ClientDeployPreflightReport['status'] {
  if (checks.some((check) => check.status === 'fail')) return 'fail';
  if (checks.some((check) => check.status === 'warn')) return 'warn';
  return 'pass';
}

function pass(name: string, message: string): ClientDeployPreflightCheck {
  return { name, status: 'pass', message };
}

function warn(name: string, message: string): ClientDeployPreflightCheck {
  return { name, status: 'warn', message };
}

function fail(name: string, message: string): ClientDeployPreflightCheck {
  return { name, status: 'fail', message };
}
