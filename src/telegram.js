export async function sendTelegramNotification({ requestId, row, token, chatId }) {
  if (!token || !chatId) return { skipped: true };

  const statusEmoji = row.status_code >= 200 && row.status_code < 300 && !row.error ? '✅' : '⚠️';
  const text = [
    `${statusEmoji} local-ai-classifier request finished`,
    `id: ${requestId}`,
    `model: ${row.model}`,
    `status: ${row.status_code}`,
    `duration: ${row.duration_ms} ms (${row.wall_seconds}s)`,
    `tokens: in ${row.prompt_tokens ?? 'n/a'} / out ${row.completion_tokens ?? 'n/a'} / total ${row.total_tokens ?? 'n/a'}`,
    `source: ${row.source_ip ?? 'unknown'}`,
    `path: ${row.path}`,
    `gpu: ${formatGpu(row.gpu_after, row.gpu_delta)}`,
    `ollama_cpu: ${formatOllamaCpu(row.process_delta)}`,
    row.error ? `error: ${truncate(row.error, 500)}` : null,
  ].filter(Boolean).join('\n');

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Telegram sendMessage failed: ${response.status} ${truncate(body, 500)}`);
  }

  return response.json();
}

function formatGpu(gpuAfter, gpuDelta) {
  const gpu = Array.isArray(gpuAfter) ? gpuAfter[0] : null;
  if (!gpu) return 'n/a';
  const util = gpu.utilization_gpu_pct ?? 'n/a';
  const mem = gpu.memory_used_mib ?? 'n/a';
  const power = gpu.power_draw_watts ?? 'n/a';
  const energy = gpuDelta?.approx_energy_wh;
  return `${util}% util, ${mem} MiB, ${power} W${typeof energy === 'number' ? `, ~${energy.toFixed(6)} Wh` : ''}`;
}

function formatOllamaCpu(processDelta) {
  const ollama = processDelta?.ollama;
  if (!Array.isArray(ollama) || !ollama.length) return 'n/a';
  return ollama.map((p) => `${p.pid}:${typeof p.approx_cpu_pct === 'number' ? p.approx_cpu_pct.toFixed(1) : 'n/a'}%`).join(', ');
}

function truncate(value, max) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
