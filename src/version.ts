import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function readRuntimeVersion(fallback = 'unknown'): Promise<string> {
  const baseVersion = await readPackageBaseVersion(fallback);
  if (baseVersion.split('.').length >= 4) return baseVersion;
  const commitCount = await readGitCommitCount();
  return commitCount ? `${baseVersion}.${commitCount}` : baseVersion;
}

async function readPackageBaseVersion(fallback: string): Promise<string> {
  try {
    const packageJson = JSON.parse(await readFile(path.join(process.cwd(), 'package.json'), 'utf8')) as { version?: unknown };
    return typeof packageJson.version === 'string' && packageJson.version ? packageJson.version : fallback;
  } catch {
    return fallback;
  }
}

async function readGitCommitCount(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-list', '--count', 'HEAD'], {
      cwd: process.cwd(),
      timeout: 3000
    });
    const value = stdout.trim();
    return /^\d+$/.test(value) ? value : null;
  } catch {
    return null;
  }
}
