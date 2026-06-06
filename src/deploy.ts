import { createHash } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ClientConfig } from './config.js';
import type { DeployResultPayload, DeployUpdatePayload } from './protocol.js';

const execFileAsync = promisify(execFileCallback);

class SafeDeployError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'SafeDeployError';
  }
}

export async function runDeployUpdate(
  config: ClientConfig,
  hostId: string,
  clientVersion: string,
  payload: DeployUpdatePayload
): Promise<DeployResultPayload> {
  try {
    if (!config.deployEnabled) throw new SafeDeployError('deploy_disabled', 'Client deploy is disabled');
    if (!config.deployCommand) throw new SafeDeployError('deploy_config_invalid', 'CLIENT_DEPLOY_COMMAND is required when deploy is enabled');
    const deployCommand = config.deployCommand;
    const bytes = await downloadArtifact(payload.artifact_url, config.deployTimeoutMs);
    const actualSha = createHash('sha256').update(bytes).digest('hex');
    if (actualSha !== payload.artifact_sha256.toLowerCase()) {
      throw new SafeDeployError('artifact_checksum_mismatch', 'Artifact checksum mismatch');
    }
    const deployDir = path.join(config.clientDataDir, 'deploy');
    await mkdir(deployDir, { recursive: true, mode: 0o700 });
    const artifactPath = path.join(deployDir, `${payload.deploy_id}.artifact`);
    await writeFile(artifactPath, bytes, { mode: 0o600 });
    await runDeployCommand(deployCommand, config.deployTimeoutMs, artifactPath, payload.target_version, payload.deploy_id);
    return { deploy_id: payload.deploy_id, host_id: hostId, status: 'succeeded', client_version: clientVersion };
  } catch (error) {
    const safeError = toSafeDeployError(error);
    return {
      deploy_id: payload.deploy_id,
      host_id: hostId,
      status: 'failed',
      client_version: clientVersion,
      error: {
        code: safeError.code,
        message: safeError.message
      }
    };
  }
}

async function downloadArtifact(url: string, timeoutMs: number): Promise<Buffer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new SafeDeployError('artifact_download_failed', `Artifact download failed with status ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  } catch (error) {
    if (error instanceof SafeDeployError) throw error;
    if (controller.signal.aborted) throw new SafeDeployError('artifact_download_timeout', 'Artifact download timed out');
    throw new SafeDeployError('artifact_download_failed', 'Artifact download failed');
  } finally {
    clearTimeout(timeout);
  }
}

async function runDeployCommand(
  deployCommand: string,
  timeoutMs: number,
  artifactPath: string,
  targetVersion: string,
  deployId: string
): Promise<void> {
  try {
    await execFileAsync(deployCommand, [artifactPath, targetVersion, deployId], {
      timeout: timeoutMs,
      env: {
        ...process.env,
        LOCAL_AI_DEPLOY_ARTIFACT: artifactPath,
        LOCAL_AI_DEPLOY_TARGET_VERSION: targetVersion,
        LOCAL_AI_DEPLOY_ID: deployId
      }
    });
  } catch (error) {
    if (isTimeoutError(error)) {
      throw new SafeDeployError('deploy_command_timeout', 'Deploy command timed out');
    }
    throw new SafeDeployError('deploy_command_failed', 'Deploy command failed');
  }
}

function toSafeDeployError(error: unknown): SafeDeployError {
  if (error instanceof SafeDeployError) return error;
  // Deploy failures are returned to the router and may be persisted in deploy
  // metadata, so never forward raw child-process stderr/stdout or stack text.
  return new SafeDeployError('deploy_failed', 'Deploy failed');
}

function isTimeoutError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && ('killed' in error || 'signal' in error)
    && (error as { killed?: unknown; signal?: unknown }).killed === true;
}
