import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('client runbook coverage', () => {
  it('covers client install, recovery, privacy and deploy operations', async () => {
    const content = await readFile(path.join(process.cwd(), 'RUNBOOK.md'), 'utf8');

    for (const required of [
      'Install Client Host',
      'Install Linux User Service',
      'Production Readiness Gate',
      'Owner Controls',
      'Ollama And Model Discovery',
      'Client Recovery',
      'Debug Router Connection',
      'Debug Classification Failure',
      'Trusted Dev Deploy Agent'
    ]) {
      expect(content).toContain(required);
    }

    for (const commandOrSetting of [
      'CLIENT_LOCAL_LOG_MODE=none',
      'npm run deploy:service-status',
      'npm run production:readiness',
      'CLIENT_REPORT_KIND=production-readiness CLIENT_REPORT_LIMIT=1 npm run deploy:reports',
      'RUN_LOCAL_OLLAMA=1 CLASSIFICATION_MIN_ACCURACY=0.9 npm run classification:baseline',
      'CLASSIFICATION_PRINT_CASES=1 npm run classification:baseline',
      'CLIENT_DEPLOY_ENABLED=true',
      'CLIENT_DATA_DIR/deploy/rollback.json',
      'LOCAL_AI_DEPLOY_PREVIOUS_VERSION'
    ]) {
      expect(content).toContain(commandOrSetting);
    }
  });
});
