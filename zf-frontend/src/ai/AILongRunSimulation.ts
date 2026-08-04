import { benchmarkAIScheduler, type AISchedulerSample } from './AISchedulerBenchmark';
import { decideTacticalAction, type AITacticalAction } from './SquadTactics';

export interface AILongRunResult {
  durationMinutes: number;
  scheduler: AISchedulerSample;
  decisions: Record<AITacticalAction, number>;
  unreachableIncidents: number;
  stuckRatio: number;
}

export function simulateAILongRun(
  durationMinutes = 30,
  botCount = 32,
): AILongRunResult {
  const distances = Array.from({ length: botCount }, (_, index) => {
    if (index < botCount / 4) return 20;
    if (index < botCount / 2) return 60;
    return 120;
  });
  const scheduler = benchmarkAIScheduler(distances, durationMinutes * 60_000, 100);
  const decisions: Record<AITacticalAction, number> = {
    follow: 0,
    focus_fire: 0,
    suppress: 0,
    advance: 0,
    retreat: 0,
    revive: 0,
  };
  let unreachableIncidents = 0;

  for (let minute = 0; minute < durationMinutes; minute++) {
    for (let index = 0; index < botCount; index++) {
      const role = (['leader', 'assault', 'support', 'medic'] as const)[index % 4];
      const cycle = (minute + index) % 12;
      const decision = decideTacticalAction({
        distanceToLeader: role === 'leader' ? 0 : cycle * 3,
        visibleEnemies: cycle % 4 === 0 ? 2 : cycle % 3 === 0 ? 1 : 0,
        healthRatio: cycle === 10 ? 0.2 : 0.8,
        ammoRatio: cycle === 11 ? 0.05 : 0.7,
        downedAllyDistance: role === 'medic' && cycle === 5 ? 10 : null,
        objectiveDistance: 15 + cycle * 3,
        role,
      });
      decisions[decision.action]++;
      if (cycle === 7 && index % 31 === 0) unreachableIncidents++;
    }
  }

  return {
    durationMinutes,
    scheduler,
    decisions,
    unreachableIncidents,
    stuckRatio: unreachableIncidents / (durationMinutes * botCount),
  };
}
