import { describe, expect, it } from 'vitest';
import { evaluateAvailability } from '../../src/availability.js';

describe('evaluateAvailability', () => {
  it('blocks work when owner paused manually', () => {
    const result = evaluateAvailability({}, false);
    expect(result.mode).toBe('manual_paused');
    expect(result.can_accept_tasks).toBe(false);
  });

  it('blocks new tasks when GPU is busy', () => {
    const result = evaluateAvailability({ gpu: [{ gpu_busy_pct: 91 }] }, true);
    expect(result.mode).toBe('gpu_busy');
    expect(result.can_accept_tasks).toBe(false);
  });
});
