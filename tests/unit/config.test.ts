import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'dotenv';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';

describe('loadConfig', () => {
  it('keeps local development defaults for quick local startup', () => {
    const config = loadConfig({});

    expect(config.nodeEnv).toBe('development');
    expect(config.routerUrl).toBe('ws://127.0.0.1:3100/v1/hosts/connect');
    expect(config.clientName).toBe('local-test-client');
    expect(config.buildId).toBe('dev');
  });

  it('parses string boolean env values explicitly instead of using JavaScript truthiness', () => {
    const config = loadConfig({
      CLIENT_ALLOW_MODEL_PULL: 'false',
      CLIENT_MANUAL_ENABLED: 'false',
      CLIENT_DEPLOY_ENABLED: 'false'
    });

    expect(config.allowModelPull).toBe(false);
    expect(config.manualEnabled).toBe(false);
    expect(config.deployEnabled).toBe(false);
  });

  it('rejects production startup with local development identity and router defaults', () => {
    expect(() => loadConfig({
      NODE_ENV: 'production',
      SETUP_TOKEN: 'short'
    })).toThrow(/Invalid production client configuration/);
  });

  it('uses the built-in autodeploy script when trusted deploy has no explicit command', () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      ROUTER_URL: 'wss://router.example.test/v1/hosts/connect',
      CLIENT_NAME: 'office-gpu-01',
      CLIENT_BUILD_ID: 'git-sha-1234567890',
      CLIENT_DEPLOY_ENABLED: 'true'
    });

    expect(config.deployCommand).toBe('/www/projects/local-ai-classifier-client/scripts/autodeploy.sh');
  });

  it('accepts production startup with explicit operational identity', () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      ROUTER_URL: 'wss://router.example.test/v1/hosts/connect',
      SETUP_TOKEN: 'setup-token-1234567890',
      CLIENT_NAME: 'office-gpu-01',
      CLIENT_BUILD_ID: 'git-sha-1234567890',
      CLIENT_DEPLOY_ENABLED: 'true',
      CLIENT_DEPLOY_COMMAND: '/usr/local/bin/local-ai-classifier-client-deploy'
    });

    expect(config.nodeEnv).toBe('production');
    expect(config.routerUrl).toBe('wss://router.example.test/v1/hosts/connect');
    expect(config.clientName).toBe('office-gpu-01');
    expect(config.buildId).toBe('git-sha-1234567890');
    expect(config.deployCommand).toBe('/usr/local/bin/local-ai-classifier-client-deploy');
  });

  it('keeps .env.example compatible with local development config validation', () => {
    const example = parse(readFileSync(path.join(process.cwd(), '.env.example')));
    const config = loadConfig(example);

    expect(config.nodeEnv).toBe('development');
    expect(config.routerUrl).toBe('ws://127.0.0.1:3100/v1/hosts/connect');
    expect(config.clientName).toBe('local-test-client');
    expect(config.buildId).toBe('dev');
    expect(config.deployEnabled).toBe(false);
  });
});
