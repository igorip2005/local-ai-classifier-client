import { describe, expect, it } from 'vitest';
import { runClientReportedCommand, safeClientReportedError } from '../../src/deploy/reported-command.js';

describe('client reported commands', () => {
  it('writes readiness reports and returns non-zero for fail status', async () => {
    const output: string[] = [];
    const exitCode = await runClientReportedCommand('production-readiness', async () => ({
      status: 'fail',
      components: [{ name: 'systemd-user-service', status: 'fail' }]
    }), {
      writeReport: async (kind, payload) => ({
        path: `/tmp/${kind}.json`,
        envelope: { kind, generated_at: '2026-06-07T00:00:00.000Z', payload }
      }),
      writeOutput: (text) => output.push(text),
      successExitCode: (payload) => payload.status === 'pass' ? 0 : 1
    });

    expect(exitCode).toBe(1);
    expect(output[0]).toContain('"status": "fail"');
    expect(output[0]).toContain('"report_path": "/tmp/production-readiness.json"');
  });

  it('prints redacted fallback output when report writing fails', async () => {
    const output: string[] = [];
    const exitCode = await runClientReportedCommand('production-readiness', async () => {
      throw new Error('GET https://artifact.example/client.tgz?token=raw-run-token failed api_key=raw-run-key');
    }, {
      writeReport: async () => {
        throw new Error('report write failed setup_token=raw-report-token');
      },
      writeOutput: (text) => output.push(text)
    });

    const serialized = JSON.stringify(output);
    expect(exitCode).toBe(1);
    expect(serialized).not.toContain('raw-run-token');
    expect(serialized).not.toContain('raw-run-key');
    expect(serialized).not.toContain('raw-report-token');
    expect(serialized).toContain('https://artifact.example/client.tgz?[redacted]');
    expect(serialized).toContain('api_key=[redacted]');
    expect(serialized).toContain('setup_token=[redacted]');
  });

  it('redacts secret-bearing report paths from command output', async () => {
    const output: string[] = [];
    const exitCode = await runClientReportedCommand('production-readiness', async () => ({
      status: 'pass'
    }), {
      writeReport: async (kind, payload) => ({
        path: `/tmp/secret-token-raw/${kind}.json`,
        envelope: { kind, generated_at: '2026-06-07T00:00:00.000Z', payload }
      }),
      writeOutput: (text) => output.push(text)
    });

    expect(exitCode).toBe(0);
    expect(JSON.stringify(output)).not.toContain('secret-token-raw');
    expect(output[0]).toContain('"report_path": "[redacted-path]"');
  });

  it('sanitizes non-Error failures', () => {
    expect(safeClientReportedError('token=raw-token')).toEqual({
      name: 'Error',
      message: 'token=[redacted]'
    });
    expect(safeClientReportedError("ENOTDIR: not a directory, mkdir '/dev/null/secret-token-raw'")).toEqual({
      name: 'Error',
      message: "ENOTDIR: not a directory, mkdir '[redacted-path]'"
    });
  });
});
