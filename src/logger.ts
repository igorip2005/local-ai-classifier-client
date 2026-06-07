import pino, { type DestinationStream, type LoggerOptions } from 'pino';
import { config } from './config.js';

export const loggerRedactPaths = [
  'req.headers.authorization',
  'req.headers.x-api-key',
  'authorization',
  'x-api-key',
  '*.authorization',
  '*.x-api-key',
  '*.setup_token',
  '*.api_key',
  '*.token'
];

export const loggerOptions: LoggerOptions = {
  level: config.logLevel,
  redact: {
    paths: loggerRedactPaths,
    remove: true
  }
};

export function createLogger(destination?: DestinationStream) {
  return destination ? pino(loggerOptions, destination) : pino(loggerOptions);
}

export type SafeLogError = {
  name: string;
  message: string;
  code?: string;
  status_code?: number;
};

// Mirrors the router logging boundary from IMPLEMENTATION_DETAILS.md sections
// 12, 20 and 22: client connection failures can include URLs, tokens or local
// stack traces, so production logs keep only redacted diagnostic fields.
export function safeLogError(error: unknown): SafeLogError {
  if (!error || typeof error !== 'object') {
    return { name: typeof error, message: 'Non-error value thrown' };
  }

  const record = error as {
    name?: unknown;
    message?: unknown;
    code?: unknown;
    statusCode?: unknown;
    status_code?: unknown;
  };
  const safe: SafeLogError = {
    name: typeof record.name === 'string' && record.name.length > 0 ? record.name : 'Error',
    message: redactLogText(typeof record.message === 'string' ? record.message : 'Unexpected error')
  };
  if (typeof record.code === 'string' && record.code.length > 0) safe.code = redactLogText(record.code);
  const statusCode = typeof record.statusCode === 'number'
    ? record.statusCode
    : typeof record.status_code === 'number'
      ? record.status_code
      : null;
  if (statusCode !== null) safe.status_code = statusCode;
  return safe;
}

function redactLogText(value: string): string {
  return value
    .replace(/(?:https?):\/\/[^\s"']+/gi, (match) => redactLogUrl(match))
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[redacted]')
    .replace(/((?:x-api-key)\s*[:=]\s*)[^\s,;}]+/gi, '$1[redacted]')
    .replace(/((?:api_key|access_token|setup_token|token|signature|sig|artifact_url)\s*[:=]\s*)[^\s,;}]+/gi, '$1[redacted]')
    .slice(0, 500);
}

function redactLogUrl(value: string): string {
  try {
    const url = new URL(value);
    const authority = url.username || url.password
      ? `${url.protocol}//[redacted]@${url.host}`
      : `${url.protocol}//${url.host}`;
    return `${authority}${url.pathname}${url.search ? '?[redacted]' : ''}`;
  } catch {
    return '[redacted-url]';
  }
}

export const logger = createLogger();
