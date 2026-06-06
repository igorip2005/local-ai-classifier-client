import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readManualEnabled, setManualEnabled } from '../../src/control.js';

describe('owner control state', () => {
  it('persists manual pause and resume state', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'local-ai-control-'));
    try {
      expect(await readManualEnabled(dir, true)).toBe(true);
      await setManualEnabled(dir, false);
      expect(await readManualEnabled(dir, true)).toBe(false);
      await setManualEnabled(dir, true);
      expect(await readManualEnabled(dir, false)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
