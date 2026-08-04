import { getAILodBudget } from './AILod';

export interface AISchedulerSample {
  botCount: number;
  durationMs: number;
  perceptionUpdates: number;
  decisionUpdates: number;
  fullRateBaselineUpdates: number;
  workReductionRatio: number;
}

export function benchmarkAIScheduler(
  distances: readonly number[],
  durationMs = 10_000,
  tickMs = 100,
): AISchedulerSample {
  let perceptionUpdates = 0;
  let decisionUpdates = 0;
  const nextPerception = distances.map(() => 0);
  const nextDecision = distances.map(() => 0);

  for (let time = 0; time < durationMs; time += tickMs) {
    distances.forEach((distance, index) => {
      const budget = getAILodBudget(distance, distance < 50);
      if (time >= nextPerception[index]) {
        perceptionUpdates++;
        nextPerception[index] = time + budget.perceptionIntervalMs;
      }
      if (time >= nextDecision[index]) {
        decisionUpdates++;
        nextDecision[index] = time + budget.decisionIntervalMs;
      }
    });
  }

  const ticks = Math.ceil(durationMs / tickMs);
  const fullRateBaselineUpdates = distances.length * ticks * 2;
  const actual = perceptionUpdates + decisionUpdates;
  return {
    botCount: distances.length,
    durationMs,
    perceptionUpdates,
    decisionUpdates,
    fullRateBaselineUpdates,
    workReductionRatio: 1 - actual / fullRateBaselineUpdates,
  };
}
