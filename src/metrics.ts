import { execFile } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function collectResources(): Promise<Record<string, unknown>> {
  const [gpu, processes] = await Promise.all([collectNvidiaGpu(), collectProcessSnapshot()]);
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
    gpu,
    processes
  };
}

async function collectProcessSnapshot(): Promise<Record<string, unknown>> {
  const base = {
    client_pid: process.pid,
    client_ppid: process.ppid,
    process_platform: os.platform()
  };
  const items = os.platform() === 'win32'
    ? await collectWindowsProcesses()
    : await collectPosixProcesses();
  return {
    ...base,
    items,
    ollama_running: items.some((item) => typeof item.name === 'string' && item.name.toLowerCase().includes('ollama')),
    client_running: items.some((item) => item.pid === process.pid)
  };
}

async function collectPosixProcesses(): Promise<Array<Record<string, unknown>>> {
  try {
    const { stdout } = await execFileAsync(
      process.env.PROCESS_LIST_PATH || 'ps',
      ['-eo', 'pid=,ppid=,comm=,pcpu=,pmem=,etime=,args='],
      { timeout: 3000, maxBuffer: 1024 * 1024 }
    );
    return stdout.trim().split('\n').filter(Boolean).flatMap((line) => parsePosixProcessLine(line)).slice(0, 25);
  } catch {
    return [];
  }
}

function parsePosixProcessLine(line: string): Array<Record<string, unknown>> {
  const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+([0-9.]+)\s+([0-9.]+)\s+(\S+)\s+(.+)$/);
  if (!match) return [];
  const [, pid = '', ppid = '', name = '', cpuPct = '', memPct = '', elapsed = '', args = ''] = match;
  if (!isRelevantProcess(name, args, Number(pid))) return [];
  return [{
    pid: Number(pid),
    ppid: Number(ppid),
    name,
    cpu_pct: numberOrNull(cpuPct),
    mem_pct: numberOrNull(memPct),
    elapsed,
    command: safeCommandName(args)
  }];
}

async function collectWindowsProcesses(): Promise<Array<Record<string, unknown>>> {
  const command = [
    'Get-CimInstance Win32_Process',
    "| Where-Object { $_.Name -match 'node|ollama' -or $_.CommandLine -match 'local-ai-classifier-client' }",
    '| Select-Object ProcessId,ParentProcessId,Name,CommandLine',
    '| ConvertTo-Json -Compress'
  ].join(' ');
  try {
    const { stdout } = await execFileAsync(
      process.env.POWERSHELL_PATH || 'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', command],
      { timeout: 3000, maxBuffer: 1024 * 1024 }
    );
    const parsed = parseJson(stdout.trim());
    const items = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' ? [parsed] : [];
    return items.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const record = item as Record<string, unknown>;
      const name = typeof record.Name === 'string' ? record.Name : '';
      const commandLine = typeof record.CommandLine === 'string' ? record.CommandLine : name;
      const pid = Number(record.ProcessId);
      if (!isRelevantProcess(name, commandLine, pid)) return [];
      return [{
        pid,
        ppid: Number(record.ParentProcessId),
        name,
        command: safeCommandName(commandLine)
      }];
    }).slice(0, 25);
  } catch {
    return [];
  }
}

function isRelevantProcess(name: string, args: string, pid: number): boolean {
  if (pid === process.pid || pid === process.ppid) return true;
  return /(ollama|local-ai-classifier-client)/i.test(`${name} ${args}`);
}

function safeCommandName(args: string): string {
  const first = args.trim().split(/\s+/)[0] ?? '';
  return first.split(/[\\/]/).pop() || first || 'unknown';
}

async function collectNvidiaGpu(): Promise<Record<string, unknown>[]> {
  const fields = ['name', 'utilization.gpu', 'memory.used', 'memory.total', 'temperature.gpu', 'power.draw', 'power.limit'];
  const candidates = process.env.NVIDIA_SMI_PATH
    ? [process.env.NVIDIA_SMI_PATH]
    : ['nvidia-smi', '/usr/bin/nvidia-smi', '/usr/local/cuda/bin/nvidia-smi', '/usr/lib/wsl/lib/nvidia-smi'];
  for (const candidate of candidates) {
    const gpu = await collectNvidiaGpuWith(candidate, fields);
    if (gpu) return gpu;
  }
  return collectGpuInventory();
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

async function collectGpuInventory(): Promise<Record<string, unknown>[]> {
  const linuxGpu = await collectLinuxGpuInventory();
  if (linuxGpu.length) return linuxGpu;
  return collectWindowsGpuInventory();
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

async function collectWindowsGpuInventory(): Promise<Record<string, unknown>[]> {
  if (os.platform() !== 'win32' && !process.env.POWERSHELL_PATH && !isWsl()) return [];
  const command = [
    'Get-CimInstance Win32_VideoController',
    "| Where-Object { $_.Name -match 'NVIDIA|GeForce|RTX|Tesla|Quadro|AMD|Radeon|Intel.*(Arc|Graphics|Iris|UHD)' }",
    '| Select-Object Name,AdapterRAM',
    '| ConvertTo-Json -Compress'
  ].join(' ');
  try {
    const { stdout } = await execFileAsync(
      process.env.POWERSHELL_PATH || 'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', command],
      { timeout: 3000 }
    );
    const parsed = parseJson(stdout.trim());
    const items = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' ? [parsed] : [];
    return items.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const record = item as Record<string, unknown>;
      const name = typeof record.Name === 'string' ? record.Name.trim() : '';
      if (!name || !/(nvidia|geforce|rtx|tesla|quadro|amd|radeon|intel.*(arc|graphics|iris|uhd))/i.test(name)) return [];
      const adapterRamBytes = typeof record.AdapterRAM === 'number' ? record.AdapterRAM : Number(record.AdapterRAM);
      return [{
        name,
        gpu_busy_pct: null,
        vram_used_mb: null,
        vram_total_mb: Number.isFinite(adapterRamBytes) && adapterRamBytes > 0 ? Math.round(adapterRamBytes / 1024 / 1024) : null,
        telemetry: 'windows-cim'
      }];
    });
  } catch {
    return [];
  }
}

function isWsl(): boolean {
  return os.platform() === 'linux' && (
    os.release().toLowerCase().includes('microsoft')
    || Boolean(process.env.WSL_DISTRO_NAME)
  );
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

function parseJson(value: string): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
