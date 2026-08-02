export enum Rank {
  BRONZE = 'bronze',
  SILVER = 'silver',
  GOLD = 'gold',
  PLATINUM = 'platinum',
  DIAMOND = 'diamond',
  MASTER = 'master',
  GRANDMASTER = 'grandmaster',
}

export interface RankConfig {
  name: string;
  minMMR: number;
  maxMMR: number;
  color: string;
  icon: string;
}

export const RANK_CONFIGS: Record<Rank, RankConfig> = {
  [Rank.BRONZE]: { name: '青铜', minMMR: 0, maxMMR: 1000, color: '#cd7f32', icon: '' },
  [Rank.SILVER]: { name: '白银', minMMR: 1000, maxMMR: 1500, color: '#c0c0c0', icon: '🥈' },
  [Rank.GOLD]: { name: '黄金', minMMR: 1500, maxMMR: 2000, color: '#ffd700', icon: '🥇' },
  [Rank.PLATINUM]: { name: '铂金', minMMR: 2000, maxMMR: 2500, color: '#e5e4e2', icon: '💎' },
  [Rank.DIAMOND]: { name: '钻石', minMMR: 2500, maxMMR: 3000, color: '#b9f2ff', icon: '💠' },
  [Rank.MASTER]: { name: '大师', minMMR: 3000, maxMMR: 3500, color: '#ff6b6b', icon: '👑' },
  [Rank.GRANDMASTER]: { name: '宗师', minMMR: 3500, maxMMR: 9999, color: '#ff0000', icon: '🏆' },
};

export interface PlayerRank {
  playerId: string;
  mmr: number;
  rank: Rank;
  wins: number;
  losses: number;
  draws: number;
  totalGames: number;
  winRate: number;
}

export class RankingSystem {
  playerRanks: Map<string, PlayerRank> = new Map();
  mmrChangeBase: number = 25;

  addPlayer(playerId: string, initialMMR: number = 1000): void {
    this.playerRanks.set(playerId, {
      playerId,
      mmr: initialMMR,
      rank: this.getRankFromMMR(initialMMR),
      wins: 0,
      losses: 0,
      draws: 0,
      totalGames: 0,
      winRate: 0,
    });
  }

  updateMMR(playerId: string, result: 'win' | 'loss' | 'draw', opponentMMR: number): void {
    const player = this.playerRanks.get(playerId);
    if (!player) return;

    const mmrDiff = opponentMMR - player.mmr;
    const expectedScore = 1 / (1 + Math.pow(10, mmrDiff / 400));
    let actualScore: number;

    switch (result) {
      case 'win':
        actualScore = 1;
        player.wins++;
        break;
      case 'loss':
        actualScore = 0;
        player.losses++;
        break;
      case 'draw':
        actualScore = 0.5;
        player.draws++;
        break;
    }

    player.totalGames++;
    player.winRate = player.totalGames > 0 ? (player.wins / player.totalGames) * 100 : 0;

    const kFactor = this.getKFactor(player);
    const mmrChange = Math.round(kFactor * (actualScore - expectedScore));
    player.mmr = Math.max(0, player.mmr + mmrChange);
    player.rank = this.getRankFromMMR(player.mmr);
  }

  private getKFactor(player: PlayerRank): number {
    if (player.totalGames < 30) {
      return 40;
    }
    if (player.mmr < 2000) {
      return 30;
    }
    return 20;
  }

  getRankFromMMR(mmr: number): Rank {
    for (const [rank, config] of Object.entries(RANK_CONFIGS)) {
      if (mmr >= config.minMMR && mmr < config.maxMMR) {
        return rank as Rank;
      }
    }
    return Rank.BRONZE;
  }

  getPlayerRank(playerId: string): PlayerRank | undefined {
    return this.playerRanks.get(playerId);
  }

  getLeaderboard(): PlayerRank[] {
    return Array.from(this.playerRanks.values()).sort((a, b) => b.mmr - a.mmr);
  }

  getRankDistribution(): Map<Rank, number> {
    const distribution = new Map<Rank, number>();
    for (const rank of Object.values(Rank)) {
      distribution.set(rank, 0);
    }

    for (const player of this.playerRanks.values()) {
      const currentCount = distribution.get(player.rank) || 0;
      distribution.set(player.rank, currentCount + 1);
    }

    return distribution;
  }
}
