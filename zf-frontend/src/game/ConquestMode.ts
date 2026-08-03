import * as THREE from 'three';

export enum TeamId {
  AXIS = 'axis',   // 德军
  ALLIES = 'allies', // 苏军
  NEUTRAL = 'neutral',
}

export interface TeamInfo {
  id: TeamId;
  name: string;
  color: number;
  colorHex: string;
  tickets: number;
  maxTickets: number;
  spawnPoint: THREE.Vector3;
}

export interface ControlPoint {
  id: string;
  name: string;
  position: THREE.Vector3;
  radius: number;
  owner: TeamId;
  captureProgress: number; // -100 到 100，正=盟军，负=轴心
  capturingTeam: TeamId | null;
  captureSpeed: number;
  contested: boolean;
  axisCount: number;
  alliesCount: number;
}

export type TicketDrainSource = 'death' | 'objective' | 'vehicle';

export interface TicketEvent {
  team: TeamId;
  amount: number;
  source: TicketDrainSource;
}

export interface ConquestConfig {
  maxTickets: number;
  ticketDrainPerDeath: number;
  ticketDrainPerSecond: number; // 每失去一个据点每秒流失
  captureRadius: number;
  captureSpeed: number;
  captureDecaySpeed: number;
}

const DEFAULT_CONFIG: ConquestConfig = {
  maxTickets: 200,
  ticketDrainPerDeath: 1,
  ticketDrainPerSecond: 0.5,
  captureRadius: 8,
  captureSpeed: 15,
  captureDecaySpeed: 10,
};

export class ConquestMode {
  config: ConquestConfig;
  teams: Map<TeamId, TeamInfo> = new Map();
  controlPoints: ControlPoint[] = [];
  playerTeam: TeamId = TeamId.AXIS;
  isGameOver = false;
  winner: TeamId | null = null;
  gameTime = 0;
  onTicketEvent: ((event: TicketEvent) => void) | null = null;

  constructor(config: Partial<ConquestConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.setupTeams();
    this.setupControlPoints();
  }

  private setupTeams(): void {
    this.teams.set(TeamId.AXIS, {
      id: TeamId.AXIS,
      name: '德军',
      color: 0xff4444,
      colorHex: '#ff4444',
      tickets: this.config.maxTickets,
      maxTickets: this.config.maxTickets,
      spawnPoint: new THREE.Vector3(-50, 1.7, 0), // 地图西侧
    });

    this.teams.set(TeamId.ALLIES, {
      id: TeamId.ALLIES,
      name: '苏军',
      color: 0x4488ff,
      colorHex: '#4488ff',
      tickets: this.config.maxTickets,
      maxTickets: this.config.maxTickets,
      spawnPoint: new THREE.Vector3(50, 1.7, 0), // 地图东侧
    });
  }

  private setupControlPoints(): void {
    // 3个据点：A(北), B(中), C(南)
    this.controlPoints = [
      {
        id: 'A', name: '据点 A', position: new THREE.Vector3(0, 0, -30),
        radius: this.config.captureRadius, owner: TeamId.NEUTRAL,
        captureProgress: 0, capturingTeam: null, captureSpeed: this.config.captureSpeed,
        contested: false, axisCount: 0, alliesCount: 0,
      },
      {
        id: 'B', name: '据点 B', position: new THREE.Vector3(0, 0, 0),
        radius: this.config.captureRadius, owner: TeamId.NEUTRAL,
        captureProgress: 0, capturingTeam: null, captureSpeed: this.config.captureSpeed,
        contested: false, axisCount: 0, alliesCount: 0,
      },
      {
        id: 'C', name: '据点 C', position: new THREE.Vector3(0, 0, 30),
        radius: this.config.captureRadius, owner: TeamId.NEUTRAL,
        captureProgress: 0, capturingTeam: null, captureSpeed: this.config.captureSpeed,
        contested: false, axisCount: 0, alliesCount: 0,
      },
    ];
  }

  setPlayerTeam(team: TeamId): void {
    this.playerTeam = team;
  }

  // 更新据点占领逻辑
  update(dt: number, entities: { position: THREE.Vector3; team: TeamId }[]): void {
    this.gameTime += dt;

    for (const point of this.controlPoints) {
      this.updateControlPoint(point, dt, entities);
    }

    // 兵力值流失：失去据点的队伍每秒流失
    this.updateTicketDrain(dt);

    // 检查胜负
    this.checkWinCondition();
  }

  private updateControlPoint(point: ControlPoint, dt: number, entities: { position: THREE.Vector3; team: TeamId }[]): void {
    // 统计据点范围内的各队人数
    let axisCount = 0;
    let alliesCount = 0;

    for (const entity of entities) {
      const dist = entity.position.distanceTo(point.position);
      if (dist <= point.radius) {
        if (entity.team === TeamId.AXIS) axisCount++;
        else if (entity.team === TeamId.ALLIES) alliesCount++;
      }
    }

    point.axisCount = axisCount;
    point.alliesCount = alliesCount;
    point.contested = axisCount > 0 && alliesCount > 0;

    // 确定当前占领方
    let capturingTeam: TeamId | null = null;
    let captureStrength = 0;

    if (axisCount > alliesCount) {
      capturingTeam = TeamId.AXIS;
      captureStrength = axisCount - alliesCount;
    } else if (alliesCount > axisCount) {
      capturingTeam = TeamId.ALLIES;
      captureStrength = alliesCount - axisCount;
    }

    point.capturingTeam = capturingTeam;

    if (capturingTeam === null) {
      if (point.contested) return;
      // 无人占领，进度缓慢衰减
      if (point.captureProgress > 0) {
        point.captureProgress = Math.max(0, point.captureProgress - this.config.captureDecaySpeed * dt);
      } else if (point.captureProgress < 0) {
        point.captureProgress = Math.min(0, point.captureProgress + this.config.captureDecaySpeed * dt);
      }
      return;
    }

    // 占领进度
    const direction = capturingTeam === TeamId.ALLIES ? 1 : -1;
    const speed = point.captureSpeed * Math.min(captureStrength, 3); // 最多3人加速

    if (point.owner !== capturingTeam) {
      // 正在占领
      point.captureProgress += direction * speed * dt;

      // 检查是否占领完成
      if (capturingTeam === TeamId.ALLIES && point.captureProgress >= 100) {
        point.owner = TeamId.ALLIES;
        point.captureProgress = 100;
      } else if (capturingTeam === TeamId.AXIS && point.captureProgress <= -100) {
        point.owner = TeamId.AXIS;
        point.captureProgress = -100;
      }
    } else {
      // 已占领，保持满进度
      point.captureProgress = direction * 100;
    }
  }

  private updateTicketDrain(dt: number): void {
    // 计算各队据点数
    let axisPoints = 0;
    let alliesPoints = 0;

    for (const point of this.controlPoints) {
      if (point.owner === TeamId.AXIS) axisPoints++;
      else if (point.owner === TeamId.ALLIES) alliesPoints++;
    }

    // 据点少的一方流失兵力值
    if (axisPoints < alliesPoints) {
      this.drainTickets(
        TeamId.AXIS,
        this.config.ticketDrainPerSecond * (alliesPoints - axisPoints) * dt,
        'objective',
      );
    } else if (alliesPoints < axisPoints) {
      this.drainTickets(
        TeamId.ALLIES,
        this.config.ticketDrainPerSecond * (axisPoints - alliesPoints) * dt,
        'objective',
      );
    }
  }

  // 玩家死亡扣兵力值
  onPlayerDeath(team: TeamId): void {
    this.drainTickets(team, this.config.ticketDrainPerDeath, 'death');
  }

  onVehicleDestroyed(team: TeamId, ticketCost: number): void {
    this.drainTickets(team, ticketCost, 'vehicle');
  }

  drainTickets(team: TeamId, amount: number, source: TicketDrainSource): void {
    const teamInfo = this.teams.get(team);
    if (!teamInfo || amount <= 0) return;
    const drained = Math.min(teamInfo.tickets, amount);
    teamInfo.tickets -= drained;
    this.onTicketEvent?.({ team, amount: drained, source });
  }

  // AI 死亡扣兵力值
  onAIDeath(team: TeamId): void {
    this.onPlayerDeath(team);
  }

  private checkWinCondition(): void {
    const axisTeam = this.teams.get(TeamId.AXIS)!;
    const alliesTeam = this.teams.get(TeamId.ALLIES)!;

    if (axisTeam.tickets <= 0) {
      this.isGameOver = true;
      this.winner = TeamId.ALLIES;
    } else if (alliesTeam.tickets <= 0) {
      this.isGameOver = true;
      this.winner = TeamId.AXIS;
    }
  }

  // 获取玩家出生点
  getPlayerSpawnPoint(): THREE.Vector3 {
    const team = this.teams.get(this.playerTeam);
    return team ? team.spawnPoint.clone() : new THREE.Vector3(0, 1.7, 0);
  }

  // 获取据点状态（用于 HUD）
  getControlPointStatus(): {
    id: string;
    owner: TeamId;
    progress: number;
    contested: boolean;
    axisCount: number;
    alliesCount: number;
  }[] {
    return this.controlPoints.map(p => ({
      id: p.id,
      owner: p.owner,
      progress: p.captureProgress,
      contested: p.contested,
      axisCount: p.axisCount,
      alliesCount: p.alliesCount,
    }));
  }

  // 获取兵力值
  getTickets(): { axis: number; allies: number } {
    return {
      axis: Math.ceil(this.teams.get(TeamId.AXIS)!.tickets),
      allies: Math.ceil(this.teams.get(TeamId.ALLIES)!.tickets),
    };
  }

  // 获取敌方队伍
  getEnemyTeam(): TeamId {
    return this.playerTeam === TeamId.AXIS ? TeamId.ALLIES : TeamId.AXIS;
  }

  // 获取友方队伍
  getFriendlyTeam(): TeamId {
    return this.playerTeam;
  }
}
