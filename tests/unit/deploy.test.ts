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
    await writeFile(command, [
      '#!/bin/sh',
      `printf '{"artifact":"%s","version":"%s","deploy":"%s","previous_version":"%s","previous_build_id":"%s","rollback_manifest":"%s"}' "$1" "$2" "$3" "$LOCAL_AI_DEPLOY_PREVIOUS_VERSION" "$LOCAL_AI_DEPLOY_PREVIOUS_BUILD_ID" "$LOCAL_AI_DEPLOY_ROLLBACK_MANIFEST" > "${marker}"`,
      ''
    ].join('\n'));
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
    expect(markerJson.previous_version).toBe('0.1.0');
    expect(markerJson.previous_build_id).toBe('dev');
    expect(await readFile(markerJson.artifact, 'utf8')).toBe('client artifact');
    expect(markerJson.rollback_manifest).toBe(path.join(dir, 'deploy', 'rollback.json'));
    const manifestText = await readFile(markerJson.rollback_manifest, 'utf8');
    const manifest = JSON.parse(manifestText) as Record<string, unknown>;
    expect(manifest).toMatchObject({
      schema_version: 'local-ai-classifier-client-deploy-rollback-v1',
      deploy_id: 'deploy-1',
      status: 'command_started',
      previous_client_version: '0.1.0',
      previous_build_id: 'dev',
      target_version: '0.1.1',
      artifact_sha256: createHash('sha256').update(artifact).digest('hex')
    });
    expect(manifest.artifact_path).toBe(markerJson.artifact);
    expect(await readFile(path.join(dir, 'deploy', 'deploy-1.rollback.json'), 'utf8')).toBe(manifestText);
    expect(manifestText).not.toContain(artifactUrl);
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

  it('does not return deploy command stderr in failure results', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'local-ai-deploy-secret-'));
    const command = path.join(dir, 'deploy-command.sh');
    await writeFile(command, '#!/bin/sh\necho "raw-deploy-secret-from-stderr" >&2\nexit 2\n');
    await chmod(command, 0o700);
    const artifact = Buffer.from('client artifact');
    const artifactUrl = await serveArtifact(artifact);
    const config = loadConfig({
      CLIENT_DATA_DIR: dir,
      CLIENT_DEPLOY_ENABLED: 'true',
      CLIENT_DEPLOY_COMMAND: command
    });

    const result = await runDeployUpdate(config, 'host-1', '0.1.0', {
      deploy_id: 'deploy-secret',
      target_version: '0.1.1',
      artifact_url: artifactUrl,
      artifact_sha256: createHash('sha256').update(artifact).digest('hex')
    });

    expect(result.status).toBe('failed');
    expect(result.error).toEqual({
      code: 'deploy_command_failed',
      message: 'Deploy command failed'
    });
    expect(JSON.stringify(result)).not.toContain('raw-deploy-secret-from-stderr');
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
