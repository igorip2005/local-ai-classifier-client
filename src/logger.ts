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

export const logger = createLogger();
