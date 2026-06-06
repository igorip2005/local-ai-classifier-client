import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { listClientDeployReports, writeClientDeployReport } from '../../src/deploy/report-service.js';

describe('client deploy reports', () => {
  it('persists private production readiness reports', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'local-ai-client-reports-'));
    try {
      const saved = await writeClientDeployReport('production-readiness', {
        status: 'fail',
        components: [{ name: 'systemd-user-service', status: 'fail' }]
      }, {
        reportDir: dir,
        now: new Date('2026-06-07T07:10:00.000Z')
      });

      expect(path.basename(saved.path)).toBe('2026-06-07T07-10-00-000Z_production-readiness.json');
      const info = await stat(saved.path);
      expect(info.mode & 0o777).toBe(0o600);
      const content = JSON.parse(await readFile(saved.path, 'utf8')) as unknown;
      expect(content).toEqual({
        kind: 'production-readiness',
        generated_at: '2026-06-07T07:10:00.000Z',
        payload: {
          status: 'fail',
          components: [{ name: 'systemd-user-service', status: 'fail' }]
        }
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('lists newest reports with kind filtering', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'local-ai-client-report-list-'));
    try {
      await writeClientDeployReport('production-readiness', { status: 'fail', sequence: 1 }, {
        reportDir: dir,
        now: new Date('2026-06-07T07:10:00.000Z')
      });
      await writeClientDeployReport('production-readiness', { status: 'pass', sequence: 2 }, {
        reportDir: dir,
        now: new Date('2026-06-07T07:11:00.000Z')
      });
      await writeFile(path.join(dir, 'invalid.json'), '{not json', 'utf8');

      const reports = await listClientDeployReports({ reportDir: dir, kind: 'production-readiness', limit: 1 });

      expect(reports.items).toHaveLength(1);
      expect(reports.items[0]).toMatchObject({
        kind: 'production-readiness',
        file_name: '2026-06-07T07-11-00-000Z_production-readiness.json',
        payload: { status: 'pass', sequence: 2 }
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
