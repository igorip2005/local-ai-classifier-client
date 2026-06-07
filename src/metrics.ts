import { execFile } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function collectResources(): Promise<Record<string, unknown>> {
  const gpu = await collectNvidiaGpu();
  const totalMemMb = Math.round(os.totalmem() / 1024 / 1024);
  const freeMemMb = Math.round(os.freemem() / 1024 / 1024);
  const usedMemMb = Math.max(0, totalMemMb - freeMemMb);
  return {
    cpu_cores: os.cpus().length,
    cpu_load_avg: os.loadavg(),
    cpu_load_pct_1m: cpuLoadPct(os.loadavg()[0], os.cpus().length),
    ram_total_mb: totalMemMb,
    ram_free_mb: freeMemMb,
    ram_used_mb: usedMemMb,
    ram_used_pct: totalMemMb > 0 ? round((usedMemMb / totalMemMb) * 100) : null,
    uptime_sec: Math.round(os.uptime()),
    gpu
  };
}

async function collectNvidiaGpu(): Promise<Record<string, unknown>[]> {
  const fields = ['name', 'utilization.gpu', 'memory.used', 'memory.total', 'temperature.gpu', 'power.draw', 'power.limit'];
  const candidates = process.env.NVIDIA_SMI_PATH
    ? [process.env.NVIDIA_SMI_PATH]
    : ['nvidia-smi', '/usr/bin/nvidia-smi', '/usr/local/cuda/bin/nvidia-smi'];
  for (const candidate of candidates) {
    const gpu = await collectNvidiaGpuWith(candidate, fields);
    if (gpu) return gpu;
  }
  return collectLinuxGpuInventory();
}

async function collectNvidiaGpuWith(bin: string, fields: string[]): Promise<Record<string, unknown>[] | null> {
  try {
    const { stdout } = await execFileAsync(
      bin,
      [`--query-gpu=${fields.join(',')}`, '--format=csv,noheader,nounits'],
      { timeout: 3000 }
    );
    return stdout.trim().split('\n').filter(Boolean).map((line) => {
      const [name, gpuBusy, memoryUsed, memoryTotal, temperature, powerDraw, powerLimit] = line.split(',').map((value) => value.trim());
      return {
        name,
        gpu_busy_pct: numberOrNull(gpuBusy),
        vram_used_mb: numberOrNull(memoryUsed),
        vram_total_mb: numberOrNull(memoryTotal),
        temperature_c: numberOrNull(temperature),
        power_draw_w: numberOrNull(powerDraw),
        power_limit_w: numberOrNull(powerLimit)
      };
    });
  } catch {
    return null;
  }
}

async function collectLinuxGpuInventory(): Promise<Record<string, unknown>[]> {
  if (os.platform() !== 'linux') return [];
  try {
    const { stdout } = await execFileAsync(process.env.LSPCI_PATH || 'lspci', [], { timeout: 3000 });
    return stdout.trim().split('\n').filter(Boolean).flatMap((line) => {
      if (!/\b(VGA compatible controller|3D controller|Display controller)\b/i.test(line)) return [];
      const name = line.replace(/^[0-9a-f:.]+\s+[^:]+:\s*/i, '').trim();
      if (!/(nvidia|geforce|rtx|tesla|quadro|advanced micro devices|amd|radeon|intel.*(arc|graphics|iris|uhd))/i.test(name)) return [];
      return [{
        name,
        gpu_busy_pct: null,
        vram_used_mb: null,
        vram_total_mb: null,
        telemetry: 'lspci'
      }];
    });
  } catch {
    return [];
  }
}

function cpuLoadPct(load: number | undefined, cores: number): number | null {
  if (!Number.isFinite(load) || !Number.isFinite(cores) || cores <= 0) return null;
  return round(Math.min(100, (Number(load) / cores) * 100));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function numberOrNull(value: string | undefined): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
