import { describe, expect, it } from 'vitest';
import { runClientServiceStatus, type ExecFile } from '../../src/deploy/service-status.js';

describe('client service status', () => {
  it('passes when systemd user service is enabled and active', async () => {
    const execFile = fakeSystemctl({
      '--user is-enabled local-ai-classifier.service': 'enabled\n',
      '--user is-active local-ai-classifier.service': 'active\n',
      '--user show local-ai-classifier.service --property=ActiveState --property=SubState --property=UnitFileState': [
        'ActiveState=active',
        'SubState=running',
        'UnitFileState=enabled',
        ''
      ].join('\n')
    });

    const report = await runClientServiceStatus({
      now: new Date('2026-06-07T02:41:00.000Z'),
      execFile
    });

    expect(report.status).toBe('pass');
    expect(report.active_state).toBe('active');
    expect(report.sub_state).toBe('running');
    expect(report.unit_file_state).toBe('enabled');
  });

  it('fails when systemd user service is disabled or inactive', async () => {
    const execFile = fakeSystemctl({
      '--user is-enabled local-ai-classifier.service': commandFailure('disabled', 'not enabled'),
      '--user is-active local-ai-classifier.service': commandFailure('inactive', 'not active'),
      '--user show local-ai-classifier.service --property=ActiveState --property=SubState --property=UnitFileState': [
        'ActiveState=inactive',
        'SubState=dead',
        'UnitFileState=disabled',
        ''
      ].join('\n')
    });

    const report = await runClientServiceStatus({ execFile });

    expect(report.status).toBe('fail');
    expect(report.checks).toContainEqual(expect.objectContaining({ name: 'enabled', status: 'fail' }));
    expect(report.checks).toContainEqual(expect.objectContaining({ name: 'active', status: 'fail' }));
    expect(report.active_state).toBe('inactive');
  });

  it('redacts secret-like systemctl failure output from status reports', async () => {
    const execFile = fakeSystemctl({
      '--user is-enabled local-ai-classifier.service': commandFailure('', 'token=raw-service-token'),
      '--user is-active local-ai-classifier.service': commandFailure('', 'Authorization: Bearer raw-bearer-token'),
      '--user show local-ai-classifier.service --property=ActiveState --property=SubState --property=UnitFileState': commandFailure('', 'https://artifact.example/client.tgz?token=raw-url-token')
    });

    const report = await runClientServiceStatus({ execFile });
    const serialized = JSON.stringify(report);

    expect(report.status).toBe('fail');
    expect(serialized).not.toContain('raw-service-token');
    expect(serialized).not.toContain('raw-bearer-token');
    expect(serialized).not.toContain('raw-url-token');
    expect(serialized).toContain('token=[redacted]');
    expect(serialized).toContain('Bearer [redacted]');
    expect(serialized).toContain('https://artifact.example/client.tgz?[redacted]');
  });
});

function fakeSystemctl(responses: Record<string, string | Error>): ExecFile {
  return async (file, args) => {
    expect(file).toBe('systemctl');
    const key = args.join(' ');
    if (!(key in responses)) throw commandFailure('', `unexpected command: ${key}`);
    const response = responses[key]!;
    if (response instanceof Error) throw response;
    return { stdout: response, stderr: '' };
  };
}

function commandFailure(stdout: string, stderr: string): Error {
  return Object.assign(new Error(stderr), { stdout, stderr });
}
