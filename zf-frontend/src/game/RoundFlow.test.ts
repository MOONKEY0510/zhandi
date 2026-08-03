import { describe, expect, it, vi } from 'vitest';
import { RoundFlow, RoundPhase } from './RoundFlow';

describe('RoundFlow', () => {
  it('advances deployment, countdown and combat deterministically', () => {
    const flow = new RoundFlow({ deploymentSeconds: 1, countdownSeconds: 2, resultsSeconds: 1 });

    flow.update(1);
    expect(flow.phase).toBe(RoundPhase.COUNTDOWN);
    flow.update(2);
    expect(flow.phase).toBe(RoundPhase.COMBAT);
  });

  it('finishes and restarts a round', () => {
    const flow = new RoundFlow({ deploymentSeconds: 0, countdownSeconds: 0, resultsSeconds: 1 });
    const restart = vi.fn();
    flow.onRestart = restart;
    flow.update(0);
    flow.update(0);
    flow.finishRound();
    flow.update(1);

    expect(restart).toHaveBeenCalledOnce();
    expect(flow.phase).toBe(RoundPhase.DEPLOYMENT);
    expect(flow.roundNumber).toBe(2);
  });
});
