import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export async function getOrCreateHostId(dataDir: string): Promise<string> {
  const idPath = path.join(dataDir, 'host_id');
  const existing = await readHostId(idPath);
  if (existing) return existing;

  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const hostId = randomUUID();
  await writeFile(idPath, `${hostId}\n`, { encoding: 'utf8', mode: 0o600 });
  return hostId;
}

async function readHostId(idPath: string): Promise<string | null> {
  try {
    const value = (await readFile(idPath, 'utf8')).trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}
