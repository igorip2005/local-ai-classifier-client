import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collectResources } from '../../src/metrics.js';

const originalNvidiaSmiPath = process.env.NVIDIA_SMI_PATH;

afterEach(() => {
  if (originalNvidiaSmiPath === undefined) {
    delete process.env.NVIDIA_SMI_PATH;
  } else {
    process.env.NVIDIA_SMI_PATH = originalNvidiaSmiPath;
  }
});

describe('collectResources', () => {
  it('parses nvidia-smi CSV output when NVIDIA telemetry is available', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'local-ai-nvidia-smi-'));
    try {
      const bin = path.join(dir, 'nvidia-smi');
      await writeFile(bin, '#!/bin/sh\nprintf "RTX 3090, 12, 1024, 24576\\nTesla T4, 0, 512, 15360\\n"\n');
      await chmod(bin, 0o700);
      process.env.NVIDIA_SMI_PATH = bin;

      const resources = await collectResources();
      expect(resources.gpu).toEqual([
        { name: 'RTX 3090', gpu_busy_pct: 12, vram_used_mb: 1024, vram_total_mb: 24576 },
        { name: 'Tesla T4', gpu_busy_pct: 0, vram_used_mb: 512, vram_total_mb: 15360 }
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('falls back to an empty GPU list when NVIDIA telemetry is unavailable', async () => {
    process.env.NVIDIA_SMI_PATH = '/missing/local-ai-classifier-nvidia-smi';

    const resources = await collectResources();
    expect(resources.gpu).toEqual([]);
    expect(resources.cpu_cores).toBeGreaterThan(0);
  });
});
