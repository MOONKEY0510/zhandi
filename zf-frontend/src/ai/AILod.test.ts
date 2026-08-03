import { describe, expect, it } from 'vitest';
import { AILodLevel, getAILodBudget } from './AILod';
import { AIStats } from './AIStats';

describe('AI LOD and statistics', () => {
  it('reduces AI work with distance and visibility', () => {
    expect(getAILodBudget(10, true).level).toBe(AILodLevel.NEAR);
    expect(getAILodBudget(60, false).level).toBe(AILodLevel.MID);
    const far = getAILodBudget(120, false);
    expect(far.level).toBe(AILodLevel.FAR);
    expect(far.animate).toBe(false);
    expect(far.queryCollisions).toBe(false);
  });

  it('records deterministic combat stats instead of random scoreboard data', () => {
    const stats = new AIStats();
    stats.register('bot', 42);
    stats.recordKill('bot');
    stats.recordAssist('bot');
    stats.recordDeath('bot');

    expect(stats.get('bot')).toEqual({ kills: 1, deaths: 1, assists: 1, score: 150, ping: 42 });
  });
});
