import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger } from '../../src/logger.js';

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
});
