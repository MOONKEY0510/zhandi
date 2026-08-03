import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { TeamId } from './ConquestMode';
import { SpawnSelector, type SpawnCandidate } from './SpawnSelector';

const candidates: SpawnCandidate[] = [
  { id: 'base', position: new THREE.Vector3(0, 0, 0), team: TeamId.ALLIES, isBase: true },
  { id: 'front', position: new THREE.Vector3(40, 0, 0), team: TeamId.ALLIES, isBase: false },
];

describe('SpawnSelector', () => {
  it('selects the candidate farther from visible enemies', () => {
    const selector = new SpawnSelector();
    const selected = selector.select(candidates, {
      team: TeamId.ALLIES,
      enemies: [{ position: new THREE.Vector3(42, 0, 0), lineOfSight: true }],
      dangers: [],
    });

    expect(selected?.id).toBe('base');
  });

  it('avoids active explosion danger areas', () => {
    const selector = new SpawnSelector();
    const selected = selector.select(candidates, {
      team: TeamId.ALLIES,
      enemies: [],
      dangers: [{ position: new THREE.Vector3(0, 0, 0), radius: 12 }],
    });

    expect(selected?.id).toBe('front');
  });

  it('never selects an enemy team candidate', () => {
    const selector = new SpawnSelector();
    const selected = selector.select(
      [...candidates, { id: 'enemy', position: new THREE.Vector3(100, 0, 0), team: TeamId.AXIS, isBase: true }],
      { team: TeamId.ALLIES, enemies: [], dangers: [] },
    );

    expect(selected?.team).toBe(TeamId.ALLIES);
  });
});
