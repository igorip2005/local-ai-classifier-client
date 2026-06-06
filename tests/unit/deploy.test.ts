import { createHash } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { runDeployUpdate } from '../../src/deploy.js';

let server: http.Server | null = null;

afterEach(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = null;
});

describe('runDeployUpdate', () => {
  it('downloads, verifies and passes artifact to the configured deploy command', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'local-ai-deploy-'));
    const marker = path.join(dir, 'marker.json');
    const command = path.join(dir, 'deploy-command.sh');
    await writeFile(command, `#!/bin/sh\nprintf '{"artifact":"%s","version":"%s","deploy":"%s"}' "$1" "$2" "$3" > "${marker}"\n`);
    await chmod(command, 0o700);
    const artifact = Buffer.from('client artifact');
    const artifactUrl = await serveArtifact(artifact);
    const config = loadConfig({
      CLIENT_DATA_DIR: dir,
      CLIENT_DEPLOY_ENABLED: 'true',
      CLIENT_DEPLOY_COMMAND: command
    });

    const result = await runDeployUpdate(config, 'host-1', '0.1.0', {
      deploy_id: 'deploy-1',
      target_version: '0.1.1',
      artifact_url: artifactUrl,
      artifact_sha256: createHash('sha256').update(artifact).digest('hex')
    });

    expect(result).toMatchObject({ status: 'succeeded', deploy_id: 'deploy-1', host_id: 'host-1' });
    const markerJson = JSON.parse(await readFile(marker, 'utf8')) as { artifact: string; version: string; deploy: string };
    expect(markerJson.version).toBe('0.1.1');
    expect(markerJson.deploy).toBe('deploy-1');
    expect(await readFile(markerJson.artifact, 'utf8')).toBe('client artifact');
    await rm(dir, { recursive: true, force: true });
  });

  it('fails safely on checksum mismatch', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'local-ai-deploy-bad-'));
    const artifactUrl = await serveArtifact(Buffer.from('bad artifact'));
    const config = loadConfig({
      CLIENT_DATA_DIR: dir,
      CLIENT_DEPLOY_ENABLED: 'true',
      CLIENT_DEPLOY_COMMAND: process.execPath
    });

    const result = await runDeployUpdate(config, 'host-1', '0.1.0', {
      deploy_id: 'deploy-bad',
      target_version: '0.1.1',
      artifact_url: artifactUrl,
      artifact_sha256: 'a'.repeat(64)
    });

    expect(result.status).toBe('failed');
    expect(result.error?.message).toBe('Artifact checksum mismatch');
    await rm(dir, { recursive: true, force: true });
  });
});

async function serveArtifact(body: Buffer): Promise<string> {
  server = http.createServer((_req, res) => {
    res.statusCode = 200;
    res.end(body);
  });
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing server port');
  return `http://127.0.0.1:${address.port}/client.tgz`;
}
