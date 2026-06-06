import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getOrCreateHostId } from '../../src/identity.js';

describe('getOrCreateHostId', () => {
  it('creates and reuses persistent host id', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'local-ai-client-'));
    try {
      const first = await getOrCreateHostId(dir);
      const second = await getOrCreateHostId(dir);
      const stored = (await readFile(path.join(dir, 'host_id'), 'utf8')).trim();

      expect(first).toBe(second);
      expect(stored).toBe(first);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
