import { describe, expect, it } from 'vitest';
import { simulateAILongRun } from './AILongRunSimulation';

describe('16v16 AI long-run acceptance', () => {
  it('simulates a deterministic 30-minute battle within scheduler and stuck budgets', () => {
    const result = simulateAILongRun(30, 32);

    expect(result.durationMinutes).toBe(30);
    expect(result.scheduler.botCount).toBe(32);
    expect(result.scheduler.workReductionRatio).toBeGreaterThan(0.5);
    expect(result.stuckRatio).toBeLessThan(0.01);
    expect(Object.values(result.decisions).every((count) => count > 0)).toBe(true);
  });

  it('repeats with identical scheduling and decisions', () => {
    expect(simulateAILongRun()).toEqual(simulateAILongRun());
  });
});
