import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { AIPerception } from './AIPerception';
import { selectObjective } from './ObjectiveUtility';
import { TeamId } from '../game/ConquestMode';

describe('AI perception and utility', () => {
  it('remembers seen and heard threats before expiring them', () => {
    const perception = new AIPerception(5_000);
    perception.see('near', new THREE.Vector3(5, 0, 0), 1, 1_000);
    perception.hear('danger', new THREE.Vector3(20, 0, 0), 3, 1_000);

    expect(perception.getHighestThreat(new THREE.Vector3())?.id).toBe('danger');
    perception.update(6_001);
    expect(perception.getHighestThreat(new THREE.Vector3())).toBeNull();
  });

  it('prioritizes a pressured enemy objective during a ticket deficit', () => {
    const selected = selectObjective(
      [
        { id: 'A', position: new THREE.Vector3(5, 0, 0), owner: TeamId.ALLIES, friendlyCount: 2, enemyCount: 0 },
        { id: 'B', position: new THREE.Vector3(20, 0, 0), owner: TeamId.AXIS, friendlyCount: 0, enemyCount: 2 },
      ],
      { position: new THREE.Vector3(), team: TeamId.ALLIES, friendlyTickets: 50, enemyTickets: 100 },
    );

    expect(selected?.id).toBe('B');
  });
});
