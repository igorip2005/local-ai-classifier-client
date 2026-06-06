export function redactDeployText(value: string): string {
  return value
    .replace(/https?:\/\/[^\s"']+/gi, (match) => redactUrl(match))
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[redacted]')
    .replace(/((?:x-api-key|x-internal-admin-key)\s*[:=]\s*)[^\s,;}]+/gi, '$1[redacted]')
    .replace(/((?:api_key|admin_key|access_token|setup_token|token|signature|sig|artifact_url)\s*[:=]\s*)[^\s,;}]+/gi, '$1[redacted]')
    .slice(0, 1000);
}

export function redactDeployNullable(value: string | null): string | null {
  return value === null ? null : redactDeployText(value);
}

function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}${url.search ? '?[redacted]' : ''}`;
  } catch {
    return '[redacted-url]';
  }
}
