import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { ConquestMode, TeamId, objectiveOwnerToTeam } from './ConquestMode';

describe('ConquestMode', () => {
  it('objectiveOwnerToTeam：协议据点归属映射到本地队伍（0=AXIS 1=ALLIES 2=NEUTRAL）', () => {
    expect(objectiveOwnerToTeam(0)).toBe(TeamId.AXIS);
    expect(objectiveOwnerToTeam(1)).toBe(TeamId.ALLIES);
    expect(objectiveOwnerToTeam(2)).toBe(TeamId.NEUTRAL);
  });

  it('captures a neutral point and drains the disadvantaged team tickets', () => {
    const mode = new ConquestMode({ captureSpeed: 100, ticketDrainPerSecond: 1 });
    const point = mode.controlPoints[0];

    mode.update(1, [{ position: point.position.clone(), team: TeamId.ALLIES }]);

    expect(point.owner).toBe(TeamId.ALLIES);
    const ticketsBefore = mode.teams.get(TeamId.AXIS)!.tickets;
    mode.update(1, [{ position: new THREE.Vector3(999, 0, 999), team: TeamId.ALLIES }]);
    expect(mode.teams.get(TeamId.AXIS)!.tickets).toBeLessThan(ticketsBefore);
  });

  it('marks equal presence as contested without changing progress', () => {
    const mode = new ConquestMode();
    const point = mode.controlPoints[0];

    mode.update(1, [
      { position: point.position.clone(), team: TeamId.AXIS },
      { position: point.position.clone(), team: TeamId.ALLIES },
    ]);

    expect(point.contested).toBe(true);
    expect(point.captureProgress).toBe(0);
    expect(point.axisCount).toBe(1);
    expect(point.alliesCount).toBe(1);
  });

  it('emits typed ticket events for deaths, objectives and vehicles', () => {
    const mode = new ConquestMode({ ticketDrainPerSecond: 1 });
    const listener = vi.fn();
    mode.onTicketEvent = listener;

    mode.onPlayerDeath(TeamId.ALLIES);
    mode.onVehicleDestroyed(TeamId.AXIS, 5);
    mode.controlPoints[0].owner = TeamId.ALLIES;
    mode.update(1, []);

    expect(listener.mock.calls.map(([event]) => event.source)).toEqual([
      'death',
      'vehicle',
      'objective',
    ]);
  });

  it('ends the round when a team runs out of tickets', () => {
    const mode = new ConquestMode({ maxTickets: 1 });

    mode.onPlayerDeath(TeamId.AXIS);
    mode.update(0, []);

    expect(mode.isGameOver).toBe(true);
    expect(mode.winner).toBe(TeamId.ALLIES);
  });
});
