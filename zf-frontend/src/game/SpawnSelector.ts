import * as THREE from 'three';
import type { TeamId } from './ConquestMode';

export interface SpawnCandidate {
  id: string;
  position: THREE.Vector3;
  team: TeamId;
  isBase: boolean;
}

export interface SpawnThreat {
  position: THREE.Vector3;
  lineOfSight: boolean;
}

export interface SpawnDanger {
  position: THREE.Vector3;
  radius: number;
}

export interface SpawnSelectionContext {
  team: TeamId;
  enemies: readonly SpawnThreat[];
  dangers: readonly SpawnDanger[];
}

export class SpawnSelector {
  select(candidates: readonly SpawnCandidate[], context: SpawnSelectionContext): SpawnCandidate | null {
    const eligible = candidates.filter((candidate) => candidate.team === context.team);
    if (eligible.length === 0) return null;

    return eligible.reduce((best, candidate) =>
      this.score(candidate, context) > this.score(best, context) ? candidate : best,
    );
  }

  score(candidate: SpawnCandidate, context: SpawnSelectionContext): number {
    let score = candidate.isBase ? 20 : 35;

    for (const enemy of context.enemies) {
      const distance = candidate.position.distanceTo(enemy.position);
      score += Math.min(distance, 50) * 2;
      if (distance < 15) score -= 200;
      if (enemy.lineOfSight && distance < 40) score -= 100;
    }

    for (const danger of context.dangers) {
      const distance = candidate.position.distanceTo(danger.position);
      if (distance < danger.radius) score -= 300 * (1 - distance / danger.radius);
    }

    return score;
  }
}
