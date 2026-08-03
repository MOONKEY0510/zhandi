import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ConquestMode, TeamId } from './ConquestMode';

describe('ConquestMode', () => {
  it('captures a neutral point and drains the disadvantaged team tickets', () => {
    const mode = new ConquestMode({ captureSpeed: 100, ticketDrainPerSecond: 1 });
    const point = mode.controlPoints[0];

    mode.update(1, [{ position: point.position.clone(), team: TeamId.ALLIES }]);

    expect(point.owner).toBe(TeamId.ALLIES);
    const ticketsBefore = mode.teams.get(TeamId.AXIS)!.tickets;
    mode.update(1, [{ position: new THREE.Vector3(999, 0, 999), team: TeamId.ALLIES }]);
    expect(mode.teams.get(TeamId.AXIS)!.tickets).toBeLessThan(ticketsBefore);
  });

  it('ends the round when a team runs out of tickets', () => {
    const mode = new ConquestMode({ maxTickets: 1 });

    mode.onPlayerDeath(TeamId.AXIS);
    mode.update(0, []);

    expect(mode.isGameOver).toBe(true);
    expect(mode.winner).toBe(TeamId.ALLIES);
  });
});
