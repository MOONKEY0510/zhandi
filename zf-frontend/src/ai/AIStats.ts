export interface BotStats {
  kills: number;
  deaths: number;
  assists: number;
  score: number;
  ping: number;
}

export class AIStats {
  private readonly stats = new Map<string, BotStats>();

  register(id: string, ping = 30): void {
    this.stats.set(id, { kills: 0, deaths: 0, assists: 0, score: 0, ping });
  }

  recordKill(id: string): void {
    const stats = this.require(id);
    stats.kills++;
    stats.score += 100;
  }

  recordDeath(id: string): void {
    this.require(id).deaths++;
  }

  recordAssist(id: string): void {
    const stats = this.require(id);
    stats.assists++;
    stats.score += 50;
  }

  get(id: string): Readonly<BotStats> {
    return { ...this.require(id) };
  }

  private require(id: string): BotStats {
    const stats = this.stats.get(id);
    if (!stats) throw new Error(`Unknown bot: ${id}`);
    return stats;
  }
}
