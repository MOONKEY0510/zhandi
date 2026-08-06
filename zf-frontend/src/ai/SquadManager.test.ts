import { describe, expect, it } from 'vitest';
import { TeamId } from '../game/ConquestMode';
import { SquadManager, type SquadMemberRef } from './SquadManager';

function member(id: string, team: TeamId, alive: boolean, x: number, z: number): SquadMemberRef {
  return { id, team, alive, position: { x, y: 1.7, z } };
}

describe('SquadManager', () => {
  it('分组：同阵营成员均分小队，每队不超过 squadSize', () => {
    const manager = new SquadManager();
    const members = [
      member('a1', TeamId.ALLIES, true, 0, 0),
      member('a2', TeamId.ALLIES, true, 1, 0),
      member('a3', TeamId.ALLIES, true, 2, 0),
      member('a4', TeamId.ALLIES, true, 3, 0),
      member('a5', TeamId.ALLIES, true, 4, 0),
      member('x1', TeamId.AXIS, true, 10, 10),
      member('x2', TeamId.AXIS, true, 11, 10),
    ];
    manager.assignMembers(members, 4);

    const allySquads = manager.getSquadsForTeam(TeamId.ALLIES);
    expect(allySquads).toHaveLength(2);
    expect(allySquads[0].members).toHaveLength(4);
    expect(allySquads[1].members).toHaveLength(1);
    expect(manager.getSquadsForTeam(TeamId.AXIS)).toHaveLength(1);
  });

  it('小队重生候选：只选存活成员且距玩家 ≥ minDistance，返回最近者', () => {
    const manager = new SquadManager();
    manager.assignMembers([
      member('a1', TeamId.ALLIES, true, 0, 0),
      member('a2', TeamId.ALLIES, true, 50, 0),
      member('a3', TeamId.ALLIES, false, 80, 0),
    ]);
    const candidate = manager.getSquadRespawnCandidate(TeamId.ALLIES, { x: 0, z: 0 }, 20);
    expect(candidate).not.toBeNull();
    expect(candidate!.memberId).toBe('a2');
    expect(candidate!.position.x).toBe(50);
  });

  it('全员阵亡或距离不足时返回 null（回据点重生）', () => {
    const manager = new SquadManager();
    manager.assignMembers([
      member('a1', TeamId.ALLIES, true, 5, 0),
      member('a2', TeamId.ALLIES, false, 80, 0),
    ]);
    expect(manager.getSquadRespawnCandidate(TeamId.ALLIES, { x: 0, z: 0 }, 20)).toBeNull();

    manager.assignMembers([member('a1', TeamId.ALLIES, false, 0, 0)]);
    expect(manager.getSquadRespawnCandidate(TeamId.ALLIES, { x: 0, z: 0 }, 0)).toBeNull();
  });

  it('describeSquad 汇报存活统计', () => {
    const manager = new SquadManager();
    manager.assignMembers([
      member('a1', TeamId.ALLIES, true, 0, 0),
      member('a2', TeamId.ALLIES, false, 1, 0),
    ]);
    expect(manager.describeSquad(TeamId.ALLIES)).toBe('友军小队：存活 1/2');
    expect(manager.describeSquad(TeamId.AXIS)).toBeNull();
  });

  it('队长：每队首成员为队长，队长阵亡后自动转移', () => {
    const manager = new SquadManager();
    manager.assignMembers([
      member('a1', TeamId.ALLIES, true, 0, 0),
      member('a2', TeamId.ALLIES, true, 1, 0),
      member('a3', TeamId.ALLIES, true, 2, 0),
    ]);
    const leader = manager.getSquadLeader(TeamId.ALLIES);
    expect(leader).not.toBeNull();
    expect(leader!.id).toBe('a1');
    expect(manager.isLeader('a1')).toBe(true);
    expect(manager.isLeader('a2')).toBe(false);
  });

  it('小队标记：设置/获取/过期/清除', () => {
    const manager = new SquadManager();
    manager.setSquadMark(TeamId.ALLIES, { x: 10, y: 0, z: 20 }, 'player');
    const mark = manager.getSquadMark(TeamId.ALLIES, performance.now());
    expect(mark).not.toBeNull();
    expect(mark!.position.x).toBe(10);
    expect(mark!.markedBy).toBe('player');

    // 过期
    const expired = manager.getSquadMark(TeamId.ALLIES, performance.now() + 20_000);
    expect(expired).toBeNull();

    // 清除
    manager.setSquadMark(TeamId.AXIS, { x: 0, y: 0, z: 0 }, 'bot');
    manager.clearSquadMark(TeamId.AXIS);
    expect(manager.getSquadMark(TeamId.AXIS)).toBeNull();
  });
});
