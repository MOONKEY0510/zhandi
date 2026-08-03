import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { AIBot } from '../ai/AIBot';
import { HealthSystem } from '../player/HealthSystem';
import { ConquestMode, TeamId } from './ConquestMode';
import { ConquestPresenter } from './ConquestPresenter';

function createBot(team: TeamId, state: string, position: THREE.Vector3): AIBot {
  return { team, state, mesh: { position } } as unknown as AIBot;
}

describe('ConquestPresenter', () => {
  it('collects living player and bot entities for capture simulation', () => {
    const mode = new ConquestMode();
    mode.setPlayerTeam(TeamId.ALLIES);
    const health = new HealthSystem();
    const bots = [
      createBot(TeamId.AXIS, 'patrol', new THREE.Vector3(1, 0, 1)),
      createBot(TeamId.ALLIES, 'dead', new THREE.Vector3(2, 0, 2)),
    ];
    const presenter = new ConquestPresenter(mode, health, bots);

    const entities = presenter.collectEntities({ x: 0, y: 1.7, z: 0 });

    expect(entities).toHaveLength(2);
    expect(entities.map((entity) => entity.team)).toEqual([TeamId.ALLIES, TeamId.AXIS]);
  });

  it('exposes a HUD-ready immutable snapshot', () => {
    const mode = new ConquestMode();
    const presenter = new ConquestPresenter(mode, new HealthSystem(), []);

    const state = presenter.getHudState();

    expect(state.tickets).toEqual({ axis: 200, allies: 200 });
    expect(state.controlPoints.map((point) => point.id)).toEqual(['A', 'B', 'C']);
  });
});
