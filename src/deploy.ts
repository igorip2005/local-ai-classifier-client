import { createHash } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ClientConfig } from './config.js';
import type { DeployResultPayload, DeployUpdatePayload } from './protocol.js';

const execFileAsync = promisify(execFileCallback);

type RollbackManifest = {
  schema_version: 'local-ai-classifier-client-deploy-rollback-v1';
  deploy_id: string;
  status: 'command_started';
  created_at: string;
  previous_client_version: string;
  previous_build_id: string;
  target_version: string | null;
  artifact_path: string;
  artifact_sha256: string | null;
  rollback_note: string;
};

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
    const deployDir = path.join(config.clientDataDir, 'deploy');
    await mkdir(deployDir, { recursive: true, mode: 0o700 });
    const artifact = await prepareArtifact(deployDir, payload, config.deployTimeoutMs);
    const rollbackManifestPath = await writeRollbackManifest(deployDir, config, clientVersion, artifact.path, artifact.sha256, payload);
    await runDeployCommand(config.deployCommand, config.deployTimeoutMs, {
      artifactPath: artifact.path,
      targetVersion: payload.target_version ?? '',
      deployId: payload.deploy_id,
      previousClientVersion: clientVersion,
      previousBuildId: config.buildId,
      rollbackManifestPath
    });
    return { deploy_id: payload.deploy_id, host_id: hostId, status: 'succeeded', client_version: await readPackageVersion(clientVersion) };
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

async function prepareArtifact(
  deployDir: string,
  payload: DeployUpdatePayload,
  timeoutMs: number
): Promise<{ path: string; sha256: string | null }> {
  if (!payload.artifact_url && !payload.artifact_sha256) return { path: '', sha256: null };
  if (!payload.artifact_url || !payload.artifact_sha256) {
    throw new SafeDeployError('artifact_input_invalid', 'artifact_url and artifact_sha256 must be provided together');
  }
  const bytes = await downloadArtifact(payload.artifact_url, timeoutMs);
  const actualSha = createHash('sha256').update(bytes).digest('hex');
  if (actualSha !== payload.artifact_sha256.toLowerCase()) {
    throw new SafeDeployError('artifact_checksum_mismatch', 'Artifact checksum mismatch');
  }
  const artifactPath = path.join(deployDir, `${payload.deploy_id}.artifact`);
  await writeFile(artifactPath, bytes, { mode: 0o600 });
  return { path: artifactPath, sha256: actualSha };
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
  context: {
    artifactPath: string;
    targetVersion: string;
    deployId: string;
    previousClientVersion: string;
    previousBuildId: string;
    rollbackManifestPath: string;
  }
): Promise<void> {
  try {
    await execFileAsync(deployCommand, [context.artifactPath, context.targetVersion, context.deployId], {
      timeout: timeoutMs,
      env: {
        ...process.env,
        LOCAL_AI_DEPLOY_ARTIFACT: context.artifactPath,
        LOCAL_AI_DEPLOY_TARGET_VERSION: context.targetVersion,
        LOCAL_AI_DEPLOY_ID: context.deployId,
        LOCAL_AI_DEPLOY_PREVIOUS_VERSION: context.previousClientVersion,
        LOCAL_AI_DEPLOY_PREVIOUS_BUILD_ID: context.previousBuildId,
        LOCAL_AI_DEPLOY_ROLLBACK_MANIFEST: context.rollbackManifestPath
      }
    });
  } catch (error) {
    if (isTimeoutError(error)) {
      throw new SafeDeployError('deploy_command_timeout', 'Deploy command timed out');
    }
    throw new SafeDeployError('deploy_command_failed', 'Deploy command failed');
  }
}

async function writeRollbackManifest(
  deployDir: string,
  config: ClientConfig,
  clientVersion: string,
  artifactPath: string,
  artifactSha256: string | null,
  payload: DeployUpdatePayload
): Promise<string> {
  // IMPLEMENTATION_DETAILS.md section 25 requires trusted clients to retain the
  // previous version signal for manual rollback. Store metadata only: the
  // router-provided artifact URL may be signed or secret-bearing, so it is never
  // persisted in the rollback manifest.
  const manifest: RollbackManifest = {
    schema_version: 'local-ai-classifier-client-deploy-rollback-v1',
    deploy_id: payload.deploy_id,
    status: 'command_started',
    created_at: new Date().toISOString(),
    previous_client_version: clientVersion,
    previous_build_id: config.buildId,
    target_version: payload.target_version ?? null,
    artifact_path: artifactPath,
    artifact_sha256: artifactSha256,
    rollback_note: 'Use previous_client_version and previous_build_id to select the previous trusted client package or artifact for manual rollback.'
  };
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  const perDeployPath = path.join(deployDir, `${payload.deploy_id}.rollback.json`);
  const latestPath = path.join(deployDir, 'rollback.json');
  await writeFile(perDeployPath, serialized, { mode: 0o600 });
  await writeFile(latestPath, serialized, { mode: 0o600 });
  return latestPath;
}

async function readPackageVersion(fallback: string): Promise<string> {
  try {
    const packageJson = JSON.parse(await readFile(path.join(process.cwd(), 'package.json'), 'utf8')) as { version?: unknown };
    return typeof packageJson.version === 'string' && packageJson.version ? packageJson.version : fallback;
  } catch {
    return fallback;
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
