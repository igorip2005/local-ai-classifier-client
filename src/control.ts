import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

type ControlState = {
  manual_enabled: boolean;
  updated_at: string;
};

export async function readManualEnabled(dataDir: string, fallback: boolean): Promise<boolean> {
  try {
    const state = JSON.parse(await readFile(controlPath(dataDir), 'utf8')) as Partial<ControlState>;
    return typeof state.manual_enabled === 'boolean' ? state.manual_enabled : fallback;
  } catch {
    return fallback;
  }
}

export async function setManualEnabled(dataDir: string, manualEnabled: boolean): Promise<ControlState> {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const state = { manual_enabled: manualEnabled, updated_at: new Date().toISOString() };
  await writeFile(controlPath(dataDir), `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  return state;
}

export async function readControlStatus(dataDir: string, fallback: boolean): Promise<ControlState> {
  const manualEnabled = await readManualEnabled(dataDir, fallback);
  return { manual_enabled: manualEnabled, updated_at: new Date().toISOString() };
}

function controlPath(dataDir: string): string {
  return path.join(dataDir, 'control.json');
}
