export enum GameModeType {
  TDM = 'tdm',
  CTF = 'ctf',
  DOM = 'dom',
}

export interface GameModeConfig {
  type: GameModeType;
  maxPlayers: number;
  timeLimit: number;
  scoreLimit: number;
  teamCount: number;
  respawnTime: number;
  friendlyFire: boolean;
}

export const DEFAULT_GAME_MODES: Record<GameModeType, GameModeConfig> = {
  [GameModeType.TDM]: {
    type: GameModeType.TDM,
    maxPlayers: 16,
    timeLimit: 600,
    scoreLimit: 100,
    teamCount: 2,
    respawnTime: 3,
    friendlyFire: false,
  },
  [GameModeType.CTF]: {
    type: GameModeType.CTF,
    maxPlayers: 16,
    timeLimit: 900,
    scoreLimit: 5,
    teamCount: 2,
    respawnTime: 5,
    friendlyFire: false,
  },
  [GameModeType.DOM]: {
    type: GameModeType.DOM,
    maxPlayers: 16,
    timeLimit: 600,
    scoreLimit: 200,
    teamCount: 2,
    respawnTime: 3,
    friendlyFire: false,
  },
};

export interface Team {
  id: string;
  name: string;
  color: string;
  score: number;
  players: string[];
}

export interface PlayerStats {
  id: string;
  name: string;
  team: string;
  kills: number;
  deaths: number;
  assists: number;
  score: number;
  ping: number;
}

export class GameMode {
  config: GameModeConfig;
  teams: Map<string, Team> = new Map();
  players: Map<string, PlayerStats> = new Map();
  isActive: boolean = false;
  startTime: number = 0;
  endTime: number = 0;
  winner: string | null = null;

  constructor(type: GameModeType) {
    this.config = { ...DEFAULT_GAME_MODES[type] };
  }

  start(): void {
    this.isActive = true;
    this.startTime = Date.now();
    this.endTime = this.startTime + this.config.timeLimit * 1000;
  }

  stop(): void {
    this.isActive = false;
    this.determineWinner();
  }

  addPlayer(id: string, name: string, teamId: string): void {
    this.players.set(id, {
      id,
      name,
      team: teamId,
      kills: 0,
      deaths: 0,
      assists: 0,
      score: 0,
      ping: 0,
    });

    const team = this.teams.get(teamId);
    if (team) {
      team.players.push(id);
    }
  }

  removePlayer(id: string): void {
    const player = this.players.get(id);
    if (player) {
      const team = this.teams.get(player.team);
      if (team) {
        team.players = team.players.filter(pid => pid !== id);
      }
    }
    this.players.delete(id);
  }

  addKill(killerId: string, victimId: string, assistIds: string[] = []): void {
    const killer = this.players.get(killerId);
    const victim = this.players.get(victimId);

    if (killer) {
      killer.kills++;
      killer.score += 100;
    }

    if (victim) {
      victim.deaths++;
    }

    for (const assistId of assistIds) {
      const assist = this.players.get(assistId);
      if (assist) {
        assist.assists++;
        assist.score += 25;
      }
    }

    this.updateTeamScores();
    this.checkWinCondition();
  }

  addScore(playerId: string, points: number): void {
    const player = this.players.get(playerId);
    if (player) {
      player.score += points;
    }
  }

  private updateTeamScores(): void {
    for (const team of this.teams.values()) {
      team.score = team.players.reduce((total, playerId) => {
        const player = this.players.get(playerId);
        return total + (player?.kills || 0);
      }, 0);
    }
  }

  private checkWinCondition(): void {
    for (const team of this.teams.values()) {
      if (team.score >= this.config.scoreLimit) {
        this.winner = team.id;
        this.stop();
        return;
      }
    }

    if (Date.now() >= this.endTime) {
      this.determineWinner();
      this.stop();
    }
  }

  private determineWinner(): void {
    let highestScore = -1;
    let winnerId: string | null = null;

    for (const team of this.teams.values()) {
      if (team.score > highestScore) {
        highestScore = team.score;
        winnerId = team.id;
      }
    }

    this.winner = winnerId;
  }

  getTimeRemaining(): number {
    if (!this.isActive) return 0;
    return Math.max(0, this.endTime - Date.now());
  }

  getTeamScores(): { teamId: string; score: number }[] {
    return Array.from(this.teams.values()).map(team => ({
      teamId: team.id,
      score: team.score,
    }));
  }

  getPlayerStats(): PlayerStats[] {
    return Array.from(this.players.values());
  }

  getLeaderboard(): PlayerStats[] {
    return this.getPlayerStats().sort((a, b) => b.score - a.score);
  }

  reset(): void {
    this.isActive = false;
    this.startTime = 0;
    this.endTime = 0;
    this.winner = null;

    for (const player of this.players.values()) {
      player.kills = 0;
      player.deaths = 0;
      player.assists = 0;
      player.score = 0;
    }

    for (const team of this.teams.values()) {
      team.score = 0;
    }
  }
}
