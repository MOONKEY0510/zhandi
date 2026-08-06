import type { TeamId } from '../game/ConquestMode';

/**
 * 小队系统（阶段 10+ 新特性：小队重生）。
 * 把同阵营 AI 分成 3-4 人小队；玩家死亡后可在存活队友附近重生（小队重生点），
 * 而非固定回据点——贴近战地"小队集结"玩法。
 * 纯逻辑类：成员用接口抽象，便于单测与 AI/玩家统一接入。
 */

export interface SquadMemberRef {
  id: string;
  team: TeamId;
  alive: boolean;
  position: { x: number; y: number; z: number };
}

export interface Squad {
  id: number;
  team: TeamId;
  members: SquadMemberRef[];
}

export interface RespawnCandidate {
  position: { x: number; y: number; z: number };
  squadId: number;
  memberId: string;
  distanceToPlayer: number;
}

export const DEFAULT_SQUAD_SIZE = 4;

export class SquadManager {
  squads: Squad[] = [];
  private nextSquadId = 1;

  /** 把成员按阵营分成若干小队（同阵营尽量均分；不足一队也成队） */
  assignMembers(members: SquadMemberRef[], squadSize = DEFAULT_SQUAD_SIZE): void {
    this.clear();
    const byTeam = new Map<TeamId, SquadMemberRef[]>();
    for (const member of members) {
      const list = byTeam.get(member.team) ?? [];
      list.push(member);
      byTeam.set(member.team, list);
    }
    for (const [team, list] of byTeam) {
      for (let i = 0; i < list.length; i += squadSize) {
        this.squads.push({
          id: this.nextSquadId++,
          team,
          members: list.slice(i, i + squadSize),
        });
      }
    }
  }

  clear(): void {
    this.squads = [];
  }

  getSquadsForTeam(team: TeamId): Squad[] {
    return this.squads.filter((squad) => squad.team === team);
  }

  /**
   * 获取玩家所属阵营的存活小队重生点。
   * 规则：只考虑有存活成员的小队；候选点 = 存活成员位置；
   * 距玩家死亡点 ≥ minDistance 才可用（防止贴脸重生/被蹲点）；
   * 返回最近可用候选（体验：最贴近战场的存活队友）。
   */
  getSquadRespawnCandidate(
    team: TeamId,
    playerPos: { x: number; z: number },
    minDistance: number,
  ): RespawnCandidate | null {
    let best: RespawnCandidate | null = null;
    for (const squad of this.getSquadsForTeam(team)) {
      for (const member of squad.members) {
        if (!member.alive) continue;
        const dist = Math.hypot(member.position.x - playerPos.x, member.position.z - playerPos.z);
        if (dist < minDistance) continue;
        const candidate: RespawnCandidate = {
          position: { ...member.position },
          squadId: squad.id,
          memberId: member.id,
          distanceToPlayer: dist,
        };
        if (!best || dist < best.distanceToPlayer) best = candidate;
      }
    }
    return best;
  }

  /** 描述小队状态（HUD 播报用）：第 N 小队存活 M 人 */
  describeSquad(team: TeamId): string | null {
    const squads = this.getSquadsForTeam(team);
    if (squads.length === 0) return null;
    const alive = squads.flatMap((s) => s.members).filter((m) => m.alive).length;
    const total = squads.flatMap((s) => s.members).length;
    return `友军小队：存活 ${alive}/${total}`;
  }
}
