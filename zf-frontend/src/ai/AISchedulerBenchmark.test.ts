import { describe, expect, it } from 'vitest';
import { benchmarkAIScheduler } from './AISchedulerBenchmark';

describe('32 Bot scheduler benchmark', () => {
  it('reduces scheduled AI work by at least 50 percent for a mixed battlefield', () => {
    const distances = [
      ...Array.from({ length: 8 }, () => 20),
      ...Array.from({ length: 8 }, () => 60),
      ...Array.from({ length: 16 }, () => 120),
    ];

    const sample = benchmarkAIScheduler(distances);

    expect(sample.botCount).toBe(32);
    expect(sample.workReductionRatio).toBeGreaterThan(0.5);
    expect(sample.perceptionUpdates).toBeLessThan(sample.fullRateBaselineUpdates / 2);
  });
});
