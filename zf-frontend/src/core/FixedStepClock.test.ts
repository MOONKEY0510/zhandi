import { describe, expect, it, vi } from 'vitest';
import { FixedStepClock } from './FixedStepClock';

describe('FixedStepClock', () => {
  it('runs deterministic 60 Hz steps independent of render cadence', () => {
    const clock = new FixedStepClock({ stepSeconds: 1 / 60 });
    const simulate = vi.fn();

    clock.advance(0, simulate);
    const first = clock.advance(34, simulate);

    expect(first.steps).toBe(2);
    expect(simulate).toHaveBeenCalledTimes(2);
    expect(simulate).toHaveBeenCalledWith(1 / 60);
  });

  it('limits catch-up work after a long frame', () => {
    const clock = new FixedStepClock({
      stepSeconds: 1 / 60,
      maxFrameSeconds: 0.1,
      maxSubSteps: 3,
    });
    const simulate = vi.fn();

    clock.advance(0, simulate);
    const result = clock.advance(1_000, simulate);

    expect(result.steps).toBe(3);
    expect(result.droppedTimeSeconds).toBeGreaterThan(0.9);
    expect(result.alpha).toBeGreaterThanOrEqual(0);
    expect(result.alpha).toBeLessThan(1);
  });

  it.each([30, 60, 120])('produces the same one-second simulation at %i FPS', (renderFps) => {
    const clock = new FixedStepClock({ stepSeconds: 1 / 60, maxSubSteps: 5 });
    let simulatedSeconds = 0;
    let timeMs = 0;
    clock.advance(timeMs, (dt) => (simulatedSeconds += dt));

    for (let frame = 0; frame < renderFps; frame++) {
      timeMs = ((frame + 1) / renderFps) * 1_000;
      clock.advance(timeMs, (dt) => (simulatedSeconds += dt));
    }

    expect(simulatedSeconds).toBeCloseTo(1, 8);
  });

  it('resets accumulated time when resuming from pause', () => {
    const clock = new FixedStepClock();
    const simulate = vi.fn();

    clock.advance(0, simulate);
    clock.advance(20, simulate);
    clock.reset(5_000);
    const result = clock.advance(5_010, simulate);

    expect(result.steps).toBe(0);
  });
});
