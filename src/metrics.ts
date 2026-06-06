import { execFile } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function collectResources(): Promise<Record<string, unknown>> {
  const gpu = await collectNvidiaGpu();
  return {
    cpu_cores: os.cpus().length,
    cpu_load_avg: os.loadavg(),
    ram_total_mb: Math.round(os.totalmem() / 1024 / 1024),
    ram_free_mb: Math.round(os.freemem() / 1024 / 1024),
    gpu
  };
}

async function collectNvidiaGpu(): Promise<Record<string, unknown>[]> {
  const fields = ['name', 'utilization.gpu', 'memory.used', 'memory.total'];
  try {
    const { stdout } = await execFileAsync(
      process.env.NVIDIA_SMI_PATH || 'nvidia-smi',
      [`--query-gpu=${fields.join(',')}`, '--format=csv,noheader,nounits'],
      { timeout: 3000 }
    );
    return stdout.trim().split('\n').filter(Boolean).map((line) => {
      const [name, gpuBusy, memoryUsed, memoryTotal] = line.split(',').map((value) => value.trim());
      return {
        name,
        gpu_busy_pct: numberOrNull(gpuBusy),
        vram_used_mb: numberOrNull(memoryUsed),
        vram_total_mb: numberOrNull(memoryTotal)
      };
    });
  } catch {
    return [];
  }
}

function numberOrNull(value: string | undefined): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
