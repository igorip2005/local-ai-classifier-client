import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runClientServiceInstall } from '../../src/deploy/install-service.js';

describe('client service installer', () => {
  it('plans user service installation without executing commands by default', async () => {
    const fixture = await createFixture();
    const executed: string[] = [];
    try {
      const report = await runClientServiceInstall({
        repoRoot: fixture.root,
        deployDir: fixture.deployDir,
        userSystemdDir: fixture.userSystemdDir,
        now: new Date('2026-06-07T03:10:00.000Z'),
        execFile: async (file, args) => {
          executed.push([file, ...args].join(' '));
          return { stdout: '', stderr: '' };
        }
      });

      expect(report.mode).toBe('dry_run');
      expect(report.status).toBe('warn');
      expect(report.commands).toContain(`systemctl --user enable --now local-ai-classifier.service`);
      expect(report.steps.every((step) => step.status === 'planned')).toBe(true);
      expect(executed).toEqual([]);
      expect(report.next_commands).toEqual(['CLIENT_DEPLOY_INSTALL_CONFIRM=1 npm run deploy:install-service']);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it('executes user service install commands only when explicitly requested', async () => {
    const fixture = await createFixture();
    const executed: string[] = [];
    try {
      const report = await runClientServiceInstall({
        repoRoot: fixture.root,
        deployDir: fixture.deployDir,
        userSystemdDir: fixture.userSystemdDir,
        execute: true,
        execFile: async (file, args) => {
          executed.push([file, ...args].join(' '));
          return { stdout: 'ok', stderr: '' };
        }
      });

      expect(report.mode).toBe('execute');
      expect(report.status).toBe('warn');
      expect(executed).toContain(`mkdir -p ${fixture.userSystemdDir}`);
      expect(executed.some((command) => command.startsWith('install -m 0644'))).toBe(true);
      expect(executed).toContain('systemctl --user daemon-reload');
      expect(executed).toContain('systemctl --user enable --now local-ai-classifier.service');
      expect(report.steps.every((step) => step.status === 'succeeded')).toBe(true);
      expect(report.next_commands).toEqual(['npm run deploy:service-status']);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it('redacts command stdout, stderr and errors from execution reports', async () => {
    const fixture = await createFixture();
    try {
      const report = await runClientServiceInstall({
        repoRoot: fixture.root,
        deployDir: fixture.deployDir,
        userSystemdDir: fixture.userSystemdDir,
        execute: true,
        execFile: async (file, args) => {
          if (file === 'systemctl' && args.includes('enable')) {
            throw Object.assign(new Error('failed with api_key=raw-error-key'), {
              stdout: 'setup_token=raw-stdout-token',
              stderr: 'GET https://artifact.example/client.tgz?token=raw-stderr-token'
            });
          }
          return { stdout: 'ok', stderr: '' };
        }
      });

      const serialized = JSON.stringify(report);
      expect(report.status).toBe('fail');
      expect(serialized).not.toContain('raw-error-key');
      expect(serialized).not.toContain('raw-stdout-token');
      expect(serialized).not.toContain('raw-stderr-token');
      expect(serialized).toContain('api_key=[redacted]');
      expect(serialized).toContain('setup_token=[redacted]');
      expect(serialized).toContain('https://artifact.example/client.tgz?[redacted]');
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'local-ai-client-install-'));
  const deployDir = path.join(root, 'deploy');
  const userSystemdDir = path.join(root, 'systemd-user');
  await mkdir(deployDir, { recursive: true });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ scripts: { start: 'node dist/src/main.js', build: 'tsc' } }));
  await writeFile(path.join(deployDir, 'local-ai-classifier.service'), [
    '[Service]',
    'Type=simple',
    'WorkingDirectory=/www/projects/local-ai-classifier-client',
    'EnvironmentFile=/www/projects/local-ai-classifier-client/.env',
    'ExecStart=/usr/bin/npm start',
    'Restart=always',
    '[Install]',
    'WantedBy=default.target'
  ].join('\n'));
  return { root, deployDir, userSystemdDir };
}
