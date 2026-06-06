import { createHash } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ClientConfig } from './config.js';
import type { DeployResultPayload, DeployUpdatePayload } from './protocol.js';

const execFileAsync = promisify(execFileCallback);

export async function runDeployUpdate(
  config: ClientConfig,
  hostId: string,
  clientVersion: string,
  payload: DeployUpdatePayload
): Promise<DeployResultPayload> {
  try {
    if (!config.deployEnabled) throw new Error('Client deploy is disabled');
    if (!config.deployCommand) throw new Error('CLIENT_DEPLOY_COMMAND is required when deploy is enabled');
    const bytes = await downloadArtifact(payload.artifact_url, config.deployTimeoutMs);
    const actualSha = createHash('sha256').update(bytes).digest('hex');
    if (actualSha !== payload.artifact_sha256.toLowerCase()) {
      throw new Error('Artifact checksum mismatch');
    }
    const deployDir = path.join(config.clientDataDir, 'deploy');
    await mkdir(deployDir, { recursive: true, mode: 0o700 });
    const artifactPath = path.join(deployDir, `${payload.deploy_id}.artifact`);
    await writeFile(artifactPath, bytes, { mode: 0o600 });
    await execFileAsync(config.deployCommand, [artifactPath, payload.target_version, payload.deploy_id], {
      timeout: config.deployTimeoutMs,
      env: {
        ...process.env,
        LOCAL_AI_DEPLOY_ARTIFACT: artifactPath,
        LOCAL_AI_DEPLOY_TARGET_VERSION: payload.target_version,
        LOCAL_AI_DEPLOY_ID: payload.deploy_id
      }
    });
    return { deploy_id: payload.deploy_id, host_id: hostId, status: 'succeeded', client_version: clientVersion };
  } catch (error) {
    return {
      deploy_id: payload.deploy_id,
      host_id: hostId,
      status: 'failed',
      client_version: clientVersion,
      error: {
        code: 'deploy_failed',
        message: error instanceof Error ? error.message : 'Deploy failed'
      }
    };
  }
}

async function downloadArtifact(url: string, timeoutMs: number): Promise<Buffer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Artifact download returned ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timeout);
  }
}
