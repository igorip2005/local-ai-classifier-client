import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger, safeLogError } from '../../src/logger.js';

describe('logger redaction', () => {
  it('removes setup, API and authorization secrets from structured logs', async () => {
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      }
    });
    const log = createLogger(stream);

    log.info({
      req: {
        headers: {
          authorization: 'Bearer raw-authorization-secret',
          'x-api-key': 'raw-api-header-secret'
        }
      },
      payload: {
        setup_token: 'raw-setup-token',
        api_key: 'raw-api-key',
        token: 'raw-generic-token'
      },
      authorization: 'raw-flat-authorization',
      'x-api-key': 'raw-flat-api-key',
      event: 'safe_event'
    });

    await new Promise((resolve) => setImmediate(resolve));

    const output = chunks.join('');
    expect(output).toContain('safe_event');
    expect(output).not.toContain('raw-authorization-secret');
    expect(output).not.toContain('raw-api-header-secret');
    expect(output).not.toContain('raw-setup-token');
    expect(output).not.toContain('raw-api-key');
    expect(output).not.toContain('raw-generic-token');
    expect(output).not.toContain('raw-flat-authorization');
    expect(output).not.toContain('raw-flat-api-key');
  });

  it('serializes connection errors without stack traces or secret-bearing text', () => {
    const error = new Error('router failed: https://router.example/connect?token=raw-url-token Authorization: Bearer raw-bearer-token api_key=raw-api-key');
    error.stack = 'Error: raw stack with raw-url-token and raw-api-key';
    Object.assign(error, { code: 'ECONNRESET', statusCode: 502 });

    const safe = safeLogError(error);
    const serialized = JSON.stringify(safe);

    expect(safe).toMatchObject({
      name: 'Error',
      code: 'ECONNRESET',
      status_code: 502
    });
    expect(serialized).toContain('https://router.example/connect?[redacted]');
    expect(serialized).toContain('Bearer [redacted]');
    expect(serialized).not.toContain('raw-url-token');
    expect(serialized).not.toContain('raw-bearer-token');
    expect(serialized).not.toContain('raw-api-key');
    expect(serialized).not.toContain('raw stack');
  });
});
