import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { getOrCreateHostId } from './identity.js';
import { RouterConnection } from './connection.js';
import { logger } from './logger.js';

const version = await readVersion();
const hostId = await getOrCreateHostId(config.clientDataDir);
const connection = new RouterConnection(config, hostId, version);

connection.on('registered_sent', () => logger.info({ event: 'register_sent', host_id: hostId, version }));
connection.on('connection_error', (error) => logger.error({ event: 'router_connection_error', err: error }));
connection.connect();

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

function shutdown(signal: string): void {
  logger.info({ event: 'client_shutdown', signal, host_id: hostId });
  connection.close();
  process.exit(0);
}

async function readVersion(): Promise<string> {
  const packageJson = JSON.parse(await readFile(path.join(process.cwd(), 'package.json'), 'utf8')) as { version: string };
  return packageJson.version;
}
