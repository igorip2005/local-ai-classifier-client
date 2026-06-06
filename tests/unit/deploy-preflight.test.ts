import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runClientDeployPreflight } from '../../src/deploy/preflight-service.js';

describe('client deploy preflight', () => {
  it('validates the production systemd user service artifact', async () => {
    const report = await runClientDeployPreflight({
      repoRoot: process.cwd(),
      envFilePath: path.join(process.cwd(), '.env.missing-for-test'),
      now: new Date('2026-06-07T02:40:00.000Z')
    });

    expect(report.status).toBe('warn');
    expect(report.checked_at).toBe('2026-06-07T02:40:00.000Z');
    expect(report.checks.filter((check) => check.status === 'fail')).toEqual([]);
    expect(report.checks).toContainEqual(expect.objectContaining({ name: 'environment file', status: 'warn' }));
    expect(report.install_commands).toContain('systemctl --user enable --now local-ai-classifier.service');
    expect(report.install_commands).toContain('journalctl --user -u local-ai-classifier.service -n 100 --no-pager');
  });

  it('fails when required npm scripts or service settings are missing', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'local-ai-client-preflight-'));
    const deployDir = path.join(dir, 'deploy');
    await mkdir(deployDir);
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ scripts: { build: 'tsc' } }), 'utf8');
    await writeFile(path.join(deployDir, 'local-ai-classifier.service'), [
      '[Service]',
      'Type=oneshot',
      'WorkingDirectory=/tmp/wrong',
      'ExecStart=/usr/bin/npm run dev',
      ''
    ].join('\n'), 'utf8');

    const report = await runClientDeployPreflight({
      repoRoot: dir,
      deployDir,
      packageJsonPath: path.join(dir, 'package.json'),
      envFilePath: path.join(dir, '.env')
    });

    expect(report.status).toBe('fail');
    expect(report.checks).toContainEqual(expect.objectContaining({ name: 'npm start script', status: 'fail' }));
    expect(report.checks).toContainEqual(expect.objectContaining({ name: 'service type', status: 'fail' }));
    expect(report.checks).toContainEqual(expect.objectContaining({ name: 'working directory', status: 'fail' }));
  });
});
