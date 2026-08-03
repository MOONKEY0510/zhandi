import * as THREE from 'three';
import type { TeamId } from '../game/ConquestMode';

export interface ObjectiveCandidate {
  id: string;
  position: THREE.Vector3;
  owner: TeamId;
  friendlyCount: number;
  enemyCount: number;
}

export interface ObjectiveUtilityContext {
  position: THREE.Vector3;
  team: TeamId;
  friendlyTickets: number;
  enemyTickets: number;
}

export function selectObjective(
  objectives: readonly ObjectiveCandidate[],
  context: ObjectiveUtilityContext,
): ObjectiveCandidate | null {
  let best: ObjectiveCandidate | null = null;
  let bestScore = -Infinity;

  for (const objective of objectives) {
    const distancePenalty = context.position.distanceTo(objective.position) * 0.5;
    const ownershipScore = objective.owner === context.team ? 10 : 60;
    const pressureScore = objective.enemyCount * 12 - objective.friendlyCount * 4;
    const comebackScore = context.friendlyTickets < context.enemyTickets ? 20 : 0;
    const score = ownershipScore + pressureScore + comebackScore - distancePenalty;
    if (score > bestScore) {
      best = objective;
      bestScore = score;
    }
  }

  return best;
}
