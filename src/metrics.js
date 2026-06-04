import { execFile } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { promisify } from 'node:util';
import os from 'node:os';

const execFileAsync = promisify(execFile);

async function readText(path) {
  try { return await readFile(path, 'utf8'); } catch { return null; }
}

export async function collectMetrics() {
  const [cpu, memory, load, processStats, gpu, power] = await Promise.all([
    readCpuStats(),
    readMemoryStats(),
    Promise.resolve({ avg: os.loadavg(), uptime_seconds: os.uptime() }),
    readProcessStats(),
    readGpuStats(),
    readPowerStats(),
  ]);
  return { at: new Date().toISOString(), cpu, memory, load, process: processStats, gpu, power };
}

export function diffMetrics(before, after, durationMs) {
  return {
    cpu: diffCpu(before?.cpu, after?.cpu),
    process: diffProcess(before?.process, after?.process, durationMs),
    gpu: diffGpu(before?.gpu, after?.gpu, durationMs),
    power: diffPower(before?.power, after?.power, durationMs),
  };
}

async function readCpuStats() {
  const stat = await readText('/proc/stat');
  if (!stat) return null;
  const line = stat.split('\n').find((l) => l.startsWith('cpu '));
  const nums = line.trim().split(/\s+/).slice(1).map(Number);
  const [user, nice, system, idle, iowait, irq, softirq, steal, guest, guestNice] = nums;
  const total = nums.reduce((a, b) => a + b, 0);
  return { user, nice, system, idle, iowait, irq, softirq, steal, guest, guestNice, total, cores: os.cpus().length };
}

async function readMemoryStats() {
  const meminfo = await readText('/proc/meminfo');
  const parsed = {};
  if (meminfo) {
    for (const line of meminfo.trim().split('\n')) {
      const match = line.match(/^([^:]+):\s+(\d+)\s*kB/i);
      if (match) parsed[match[1]] = Number(match[2]) * 1024;
    }
  }
  return {
    total_bytes: os.totalmem(),
    free_bytes: os.freemem(),
    meminfo: parsed,
  };
}

async function readProcessStats() {
  const self = process.cpuUsage();
  const memory = process.memoryUsage();
  const ollama = await findOllamaProcesses();
  return { wrapper: { cpu_microseconds: self, memory }, ollama };
}

async function findOllamaProcesses() {
  let pids = [];
  try { pids = await readdir('/proc'); } catch { return []; }
  const out = [];
  for (const pid of pids) {
    if (!/^\d+$/.test(pid)) continue;
    const comm = (await readText(`/proc/${pid}/comm`))?.trim();
    const cmdline = (await readText(`/proc/${pid}/cmdline`))?.replaceAll('\0', ' ').trim();
    if (!`${comm || ''} ${cmdline || ''}`.toLowerCase().includes('ollama')) continue;
    const stat = await readText(`/proc/${pid}/stat`);
    const status = await readText(`/proc/${pid}/status`);
    const io = await readText(`/proc/${pid}/io`);
    out.push({ pid: Number(pid), comm, cmdline, stat: parseProcStat(stat), status: parseKeyValue(status), io: parseKeyValue(io) });
  }
  return out;
}

function parseProcStat(stat) {
  if (!stat) return null;
  const right = stat.slice(stat.lastIndexOf(')') + 2).split(/\s+/);
  return {
    state: right[0],
    utime_ticks: Number(right[11]),
    stime_ticks: Number(right[12]),
    cutime_ticks: Number(right[13]),
    cstime_ticks: Number(right[14]),
    starttime_ticks: Number(right[19]),
  };
}

function parseKeyValue(text) {
  if (!text) return null;
  const obj = {};
  for (const line of text.trim().split('\n')) {
    const [key, ...rest] = line.split(':');
    if (!key || !rest.length) continue;
    obj[key.trim()] = rest.join(':').trim();
  }
  return obj;
}

async function readGpuStats() {
  const nvidiaSmi = process.env.NVIDIA_SMI_PATH || 'nvidia-smi';
  const fields = [
    'timestamp', 'name', 'uuid', 'utilization.gpu', 'utilization.memory',
    'memory.used', 'memory.total', 'temperature.gpu', 'power.draw',
    'power.limit', 'clocks.current.graphics', 'clocks.current.memory',
    'pcie.link.gen.current', 'pcie.link.width.current'
  ];
  try {
    const { stdout } = await execFileAsync(nvidiaSmi, [`--query-gpu=${fields.join(',')}`, '--format=csv,noheader,nounits'], { timeout: 3000 });
    return stdout.trim().split('\n').filter(Boolean).map((line) => {
      const v = line.split(',').map((x) => x.trim());
      return {
        timestamp: v[0], name: v[1], uuid: v[2], utilization_gpu_pct: num(v[3]),
        utilization_memory_pct: num(v[4]), memory_used_mib: num(v[5]), memory_total_mib: num(v[6]),
        temperature_c: num(v[7]), power_draw_watts: num(v[8]), power_limit_watts: num(v[9]),
        graphics_clock_mhz: num(v[10]), memory_clock_mhz: num(v[11]),
        pcie_gen: num(v[12]), pcie_width: num(v[13]),
      };
    });
  } catch (error) {
    return { error: error.message };
  }
}

async function readPowerStats() {
  const rapl = await readRaplEnergy();
  const gpu = await readGpuStats();
  return { cpu_rapl: rapl, gpu };
}

async function readRaplEnergy() {
  const base = '/sys/class/powercap';
  try {
    const entries = await readdir(base);
    const zones = [];
    for (const entry of entries.filter((e) => e.startsWith('intel-rapl'))) {
      const dir = `${base}/${entry}`;
      zones.push({
        zone: entry,
        name: (await readText(`${dir}/name`))?.trim(),
        energy_uj: Number((await readText(`${dir}/energy_uj`))?.trim()),
        max_energy_range_uj: Number((await readText(`${dir}/max_energy_range_uj`))?.trim()),
      });
    }
    return zones;
  } catch {
    return null;
  }
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function diffCpu(before, after) {
  if (!before || !after) return null;
  const total = after.total - before.total;
  const idle = (after.idle + after.iowait) - (before.idle + before.iowait);
  const busy = total - idle;
  return { total_ticks: total, busy_ticks: busy, idle_ticks: idle, busy_pct: total > 0 ? (busy / total) * 100 : null, cores: after.cores };
}

function diffProcess(before, after, durationMs) {
  const hz = 100;
  const beforeOllama = new Map((before?.ollama || []).map((p) => [p.pid, p]));
  const ollama = (after?.ollama || []).map((p) => {
    const b = beforeOllama.get(p.pid);
    const ticks = b?.stat && p.stat ? (p.stat.utime_ticks + p.stat.stime_ticks) - (b.stat.utime_ticks + b.stat.stime_ticks) : null;
    return { pid: p.pid, comm: p.comm, cpu_ticks_delta: ticks, cpu_seconds_delta: ticks == null ? null : ticks / hz, approx_cpu_pct: ticks == null || !durationMs ? null : ((ticks / hz) / (durationMs / 1000)) * 100 };
  });
  return { ollama };
}

function diffGpu(before, after, durationMs) {
  const b = Array.isArray(before) ? before[0] : null;
  const a = Array.isArray(after) ? after[0] : null;
  if (!a) return null;
  const avgPower = [b?.power_draw_watts, a?.power_draw_watts].filter((x) => typeof x === 'number').reduce((s, x, _, arr) => s + x / arr.length, 0) || null;
  return { approx_avg_power_watts: avgPower, approx_energy_wh: avgPower && durationMs ? avgPower * (durationMs / 1000) / 3600 : null, utilization_gpu_pct_after: a.utilization_gpu_pct, memory_used_mib_after: a.memory_used_mib };
}

function diffPower(before, after, durationMs) {
  const gpuDelta = diffGpu(before?.gpu, after?.gpu, durationMs);
  let cpuRapl = null;
  if (Array.isArray(before?.cpu_rapl) && Array.isArray(after?.cpu_rapl)) {
    cpuRapl = after.cpu_rapl.map((a) => {
      const b = before.cpu_rapl.find((x) => x.zone === a.zone);
      const deltaUj = b ? a.energy_uj - b.energy_uj : null;
      return { zone: a.zone, name: a.name, energy_uj_delta: deltaUj, energy_wh_delta: deltaUj == null ? null : deltaUj / 3_600_000_000 };
    });
  }
  return { cpu_rapl: cpuRapl, gpu: gpuDelta };
}
