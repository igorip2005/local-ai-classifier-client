const TELEGRAM_MAX_MESSAGE_CHARS = 4096;
const TELEGRAM_SAFE_MESSAGE_CHARS = 3600;
const DEFAULT_SNIPPET_CHARS = 700;
const MIN_SNIPPET_CHARS = 220;

export async function sendTelegramNotification({ requestId, row, token, chatId }) {
  if (!token || !chatId) return { skipped: true };

  const text = buildTelegramMessage({ requestId, row });
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Telegram sendMessage failed: ${response.status} ${truncate(body, 500)}`);
  }

  return response.json();
}

export function buildTelegramMessage({ requestId, row }) {
  return fitTelegramMessage({ requestId, row, snippetChars: DEFAULT_SNIPPET_CHARS });
}

function fitTelegramMessage({ requestId, row, snippetChars }) {
  let message = buildTelegramMessageWithLimit({ requestId, row, snippetChars });
  while (message.length > TELEGRAM_SAFE_MESSAGE_CHARS && snippetChars > MIN_SNIPPET_CHARS) {
    snippetChars = Math.max(MIN_SNIPPET_CHARS, Math.floor(snippetChars * 0.7));
    message = buildTelegramMessageWithLimit({ requestId, row, snippetChars });
  }
  if (message.length > TELEGRAM_MAX_MESSAGE_CHARS) {
    return `${message.slice(0, TELEGRAM_MAX_MESSAGE_CHARS - 40)}\n\n… <i>message trimmed</i>`;
  }
  return message;
}

function buildTelegramMessageWithLimit({ requestId, row, snippetChars }) {
  const ok = row.status_code >= 200 && row.status_code < 300 && !row.error;
  const title = ok ? '✅ <b>AI request completed</b>' : '⚠️ <b>AI request failed</b>';
  const status = ok ? `HTTP ${row.status_code}` : `HTTP ${row.status_code}${row.error ? ' · error' : ''}`;
  const shortId = String(requestId).slice(0, 8);
  const model = escapeHtml(row.model);
  const source = escapeHtml(row.forwarded_for || row.source_ip || 'unknown');
  const path = escapeHtml(row.path || 'unknown');
  const tokens = formatTokens(row);
  const speed = formatSpeed(row);
  const gpu = formatGpu(row.gpu_after, row.gpu_delta);
  const cpu = formatOllamaCpu(row.process_delta);
  const inputSnippet = extractRequestText(row.request_body, snippetChars);
  const outputSnippet = extractResponseText(row.response_body, snippetChars);

  const lines = [
    title,
    '',
    `🤖 <b>Model:</b> <code>${model}</code>`,
    `⏱ <b>Time:</b> ${formatMs(row.duration_ms)} ${speed}`.trim(),
    `🧮 <b>Tokens:</b> ${tokens}`,
    `📊 <b>Status:</b> ${escapeHtml(status)}`,
    '',
    `📝 <b>Input:</b>`,
    `<blockquote>${escapeHtml(inputSnippet || 'n/a')}</blockquote>`,
    `💬 <b>Output:</b>`,
    `<blockquote>${escapeHtml(outputSnippet || 'n/a')}</blockquote>`,
    '',
    `🖥 <b>GPU:</b> ${escapeHtml(gpu)}`,
    `⚙️ <b>Ollama CPU:</b> ${escapeHtml(cpu)}`,
    '',
    `🌐 <b>Source:</b> <code>${source}</code>`,
    `🔗 <b>Path:</b> <code>${path}</code>`,
    `🆔 <b>Request:</b> <code>${escapeHtml(shortId)}</code>`,
  ];

  if (row.error) {
    lines.push('', `❌ <b>Error:</b> <code>${escapeHtml(truncate(row.error, 450))}</code>`);
  }

  return lines.join('\n');
}

function extractRequestText(body, maxChars) {
  if (!body) return '';
  if (typeof body.prompt === 'string') return truncateClean(body.prompt, maxChars);
  if (Array.isArray(body.messages)) {
    const text = body.messages
      .map((message) => {
        const role = message?.role ? `${message.role}: ` : '';
        return `${role}${contentToText(message?.content)}`;
      })
      .filter(Boolean)
      .join('\n');
    return truncateClean(text, maxChars);
  }
  return truncateClean(JSON.stringify(body), maxChars);
}

function extractResponseText(body, maxChars) {
  if (!body) return '';
  if (typeof body.response === 'string') return truncateClean(body.response, maxChars);
  if (typeof body.message?.content === 'string') return truncateClean(body.message.content, maxChars);
  if (typeof body.error === 'string') return truncateClean(body.error, maxChars);
  return truncateClean(JSON.stringify(body), maxChars);
}

function contentToText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === 'string') return part;
      if (typeof part?.text === 'string') return part.text;
      return JSON.stringify(part);
    }).join(' ');
  }
  if (content == null) return '';
  return JSON.stringify(content);
}

function formatTokens(row) {
  const input = row.prompt_tokens ?? 'n/a';
  const output = row.completion_tokens ?? 'n/a';
  const total = row.total_tokens ?? 'n/a';
  return `<b>${escapeHtml(total)}</b> total · in ${escapeHtml(input)} / out ${escapeHtml(output)}`;
}

function formatSpeed(row) {
  if (!row.duration_ms || !row.completion_tokens) return '';
  const seconds = row.duration_ms / 1000;
  if (seconds <= 0) return '';
  return `· ${(row.completion_tokens / seconds).toFixed(1)} tok/s`;
}

function formatMs(ms) {
  if (typeof ms !== 'number') return 'n/a';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}

function formatGpu(gpuAfter, gpuDelta) {
  const gpu = Array.isArray(gpuAfter) ? gpuAfter[0] : null;
  if (!gpu) return 'n/a';
  const parts = [];
  if (gpu.utilization_gpu_pct != null) parts.push(`${gpu.utilization_gpu_pct}%`);
  if (gpu.memory_used_mib != null) parts.push(`${gpu.memory_used_mib} MiB`);
  if (gpu.power_draw_watts != null) parts.push(`${gpu.power_draw_watts} W`);
  if (typeof gpuDelta?.approx_energy_wh === 'number') parts.push(`~${gpuDelta.approx_energy_wh.toFixed(6)} Wh`);
  return parts.join(' · ') || 'n/a';
}

function formatOllamaCpu(processDelta) {
  const ollama = processDelta?.ollama;
  if (!Array.isArray(ollama) || !ollama.length) return 'n/a';
  const cpuValues = ollama
    .map((p) => typeof p.approx_cpu_pct === 'number' ? p.approx_cpu_pct : null)
    .filter((v) => v != null);
  if (!cpuValues.length) return 'n/a';
  const total = cpuValues.reduce((sum, v) => sum + v, 0);
  return `${total.toFixed(1)}%`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function truncate(value, max) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function truncateClean(value, max) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trim()}…`;
}
