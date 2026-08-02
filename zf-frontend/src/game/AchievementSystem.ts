export enum AchievementType {
  KILLS = 'kills',
  HEADSHOTS = 'headshots',
  WINS = 'wins',
  GAMES_PLAYED = 'games_played',
  WEAPON_MASTER = 'weapon_master',
  SURVIVOR = 'survivor',
  TEAM_PLAYER = 'team_player',
}

export interface Achievement {
  id: string;
  name: string;
  description: string;
  type: AchievementType;
  requirement: number;
  reward: number;
  icon: string;
  unlocked: boolean;
  progress: number;
  unlockedAt: number | null;
}

export const ACHIEVEMENTS: Achievement[] = [
  {
    id: 'first_blood',
    name: '第一滴血',
    description: '获得首次击杀',
    type: AchievementType.KILLS,
    requirement: 1,
    reward: 100,
    icon: '🩸',
    unlocked: false,
    progress: 0,
    unlockedAt: null,
  },
  {
    id: 'sharpshooter',
    name: '神射手',
    description: '获得10次爆头击杀',
    type: AchievementType.HEADSHOTS,
    requirement: 10,
    reward: 500,
    icon: '🎯',
    unlocked: false,
    progress: 0,
    unlockedAt: null,
  },
  {
    id: 'veteran',
    name: '老兵',
    description: '完成50场游戏',
    type: AchievementType.GAMES_PLAYED,
    requirement: 50,
    reward: 1000,
    icon: '🎖️',
    unlocked: false,
    progress: 0,
    unlockedAt: null,
  },
  {
    id: 'weapon_master',
    name: '武器大师',
    description: '使用所有武器类型获得击杀',
    type: AchievementType.WEAPON_MASTER,
    requirement: 4,
    reward: 2000,
    icon: '🔫',
    unlocked: false,
    progress: 0,
    unlockedAt: null,
  },
  {
    id: 'survivor',
    name: '幸存者',
    description: '单局存活时间超过5分钟',
    type: AchievementType.SURVIVOR,
    requirement: 300,
    reward: 500,
    icon: '🛡️',
    unlocked: false,
    progress: 0,
    unlockedAt: null,
  },
  {
    id: 'team_player',
    name: '团队玩家',
    description: '获得100次助攻',
    type: AchievementType.TEAM_PLAYER,
    requirement: 100,
    reward: 1500,
    icon: '🤝',
    unlocked: false,
    progress: 0,
    unlockedAt: null,
  },
];

export class AchievementSystem {
  achievements: Map<string, Achievement> = new Map();
  playerProgress: Map<string, Map<string, number>> = new Map();
  totalScore: number = 0;

  constructor() {
    for (const achievement of ACHIEVEMENTS) {
      this.achievements.set(achievement.id, { ...achievement });
    }
  }

  addPlayer(playerId: string): void {
    this.playerProgress.set(playerId, new Map());
  }

  updateProgress(playerId: string, type: AchievementType, amount: number = 1): Achievement[] {
    const progress = this.playerProgress.get(playerId);
    if (!progress) return [];

    const currentProgress = progress.get(type) || 0;
    progress.set(type, currentProgress + amount);

    const unlocked: Achievement[] = [];

    for (const achievement of this.achievements.values()) {
      if (achievement.unlocked) continue;
      if (achievement.type !== type) continue;

      const playerProgress = progress.get(type) || 0;
      achievement.progress = playerProgress;

      if (playerProgress >= achievement.requirement) {
        achievement.unlocked = true;
        achievement.unlockedAt = Date.now();
        this.totalScore += achievement.reward;
        unlocked.push({ ...achievement });
      }
    }

    return unlocked;
  }

  getPlayerAchievements(playerId: string): Achievement[] {
    const progress = this.playerProgress.get(playerId);
    if (!progress) return [];

    return Array.from(this.achievements.values()).map(achievement => {
      const playerProgress = progress.get(achievement.type) || 0;
      return {
        ...achievement,
        progress: playerProgress,
      };
    });
  }

  getUnlockedAchievements(playerId: string): Achievement[] {
    return this.getPlayerAchievements(playerId).filter(a => a.unlocked);
  }

  getLockedAchievements(playerId: string): Achievement[] {
    return this.getPlayerAchievements(playerId).filter(a => !a.unlocked);
  }

  getAchievementProgress(playerId: string, achievementId: string): number {
    const achievement = this.achievements.get(achievementId);
    if (!achievement) return 0;

    const progress = this.playerProgress.get(playerId);
    if (!progress) return 0;

    const playerProgress = progress.get(achievement.type) || 0;
    return Math.min(1, playerProgress / achievement.requirement);
  }

  getTotalScore(): number {
    return this.totalScore;
  }

  reset(): void {
    this.playerProgress.clear();
    this.totalScore = 0;
    for (const achievement of this.achievements.values()) {
      achievement.unlocked = false;
      achievement.progress = 0;
      achievement.unlockedAt = null;
    }
  }
}
