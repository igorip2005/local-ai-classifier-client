export type Availability = {
  mode: 'idle' | 'office_work' | 'gpu_busy' | 'manual_paused' | 'unknown';
  can_accept_tasks: boolean;
  reason: string;
};

export function evaluateAvailability(resources: Record<string, unknown>, manualEnabled: boolean): Availability {
  if (!manualEnabled) {
    return { mode: 'manual_paused', can_accept_tasks: false, reason: 'Owner manually paused client' };
  }

  const gpu = Array.isArray(resources.gpu) ? resources.gpu : [];
  const gpuBusy = gpu.some((item) => {
    const busy = typeof item === 'object' && item ? (item as { gpu_busy_pct?: unknown }).gpu_busy_pct : null;
    return typeof busy === 'number' && busy >= 70;
  });

  if (gpuBusy) {
    return { mode: 'gpu_busy', can_accept_tasks: false, reason: 'GPU utilization is high' };
  }

  const load = Array.isArray(resources.cpu_load_avg) ? Number(resources.cpu_load_avg[0]) : 0;
  const cores = typeof resources.cpu_cores === 'number' ? resources.cpu_cores : 1;
  if (load > cores * 0.8) {
    return { mode: 'office_work', can_accept_tasks: true, reason: 'CPU load is elevated, only light tasks allowed' };
  }

  return { mode: 'idle', can_accept_tasks: true, reason: gpu.length ? 'CPU and GPU look available' : 'CPU looks available, GPU not detected' };
}
