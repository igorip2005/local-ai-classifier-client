import { describe, expect, it } from 'vitest';
import type { ClientDeployPreflightReport } from '../../src/deploy/preflight-service.js';
import { getClientProductionReadiness } from '../../src/deploy/production-readiness.js';
import type { ClientServiceStatusReport } from '../../src/deploy/service-status.js';

describe('getClientProductionReadiness', () => {
  it('passes only when deploy preflight and systemd service status pass', async () => {
    const report = await getClientProductionReadiness({
      now: new Date('2026-06-07T07:05:00.000Z'),
      preflight: preflight('pass'),
      serviceStatus: serviceStatus('pass')
    });

    expect(report.status).toBe('pass');
    expect(report.checked_at).toBe('2026-06-07T07:05:00.000Z');
    expect(report.components).toEqual([
      expect.objectContaining({ name: 'deploy-preflight', status: 'pass', source_status: 'pass' }),
      expect.objectContaining({ name: 'systemd-user-service', status: 'pass', source_status: 'pass' })
    ]);
  });

  it('fails closed when preflight has warnings or failures', async () => {
    const report = await getClientProductionReadiness({
      preflight: preflight('warn'),
      serviceStatus: serviceStatus('pass')
    });

    expect(report.status).toBe('fail');
    expect(report.components).toContainEqual(expect.objectContaining({
      name: 'deploy-preflight',
      status: 'fail',
      source_status: 'warn'
    }));
  });

  it('fails closed when the systemd user service is not passing', async () => {
    const report = await getClientProductionReadiness({
      preflight: preflight('pass'),
      serviceStatus: serviceStatus('fail')
    });

    expect(report.status).toBe('fail');
    expect(report.components).toContainEqual(expect.objectContaining({
      name: 'systemd-user-service',
      status: 'fail',
      source_status: 'fail'
    }));
  });
});

function preflight(status: ClientDeployPreflightReport['status']): ClientDeployPreflightReport {
  return {
    checked_at: '2026-06-07T07:05:00.000Z',
    status,
    checks: [],
    install_commands: []
  };
}

function serviceStatus(status: ClientServiceStatusReport['status']): ClientServiceStatusReport {
  return {
    checked_at: '2026-06-07T07:05:00.000Z',
    status,
    service_file: 'local-ai-classifier.service',
    checks: [],
    active_state: status === 'pass' ? 'active' : 'inactive',
    sub_state: status === 'pass' ? 'running' : 'dead',
    unit_file_state: status === 'pass' ? 'enabled' : 'disabled'
  };
}
