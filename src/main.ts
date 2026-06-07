import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { getOrCreateHostId } from './identity.js';
import { RouterConnection } from './connection.js';
import { logger, safeLogError } from './logger.js';
import { readControlStatus, setManualEnabled } from './control.js';
import { StatusServer } from './status-server.js';

const command = process.argv[2];
if (command === 'pause' || command === 'resume' || command === 'status') {
  await runControlCommand(command);
  process.exit(0);
}

const version = await readVersion();
const hostId = await getOrCreateHostId(config.clientDataDir);
const connection = new RouterConnection(config, hostId, version);
const statusServer = new StatusServer(config, hostId, version);

connection.on('registered_sent', () => logger.info({ event: 'register_sent', host_id: hostId, version }));
connection.on('connection_error', (error) => logger.error({ event: 'router_connection_error', error: safeLogError(error) }));
statusServer.start();
connection.connect();

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

function shutdown(signal: string): void {
  logger.info({ event: 'client_shutdown', signal, host_id: hostId });
  statusServer.stop();
  connection.close();
  process.exit(0);
}

async function readVersion(): Promise<string> {
  const packageJson = JSON.parse(await readFile(path.join(process.cwd(), 'package.json'), 'utf8')) as { version: string };
  return packageJson.version;
}

async function runControlCommand(commandName: string): Promise<void> {
  if (commandName === 'pause') {
    const state = await setManualEnabled(config.clientDataDir, false);
    console.log(JSON.stringify({ status: 'paused', ...state }));
    return;
  }
  if (commandName === 'resume') {
    const state = await setManualEnabled(config.clientDataDir, true);
    console.log(JSON.stringify({ status: 'resumed', ...state }));
    return;
  }
  const state = await readControlStatus(config.clientDataDir, config.manualEnabled);
  console.log(JSON.stringify({ status: state.manual_enabled ? 'enabled' : 'paused', ...state }));
}
