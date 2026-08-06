/**
 * 玩家档案（阶段 10 P0：完整流程「首次设置」）。
 * 持久化昵称与首次设置完成标记；isFirstRun 驱动首次设置向导。
 */

export interface PlayerProfile {
  nickname: string;
  completedSetup: boolean;
  completedAt: number;
}

const PROFILE_KEY = 'zhandi.player-profile.v1';

export function loadPlayerProfile(
  storage: Pick<Storage, 'getItem'> = localStorage,
): PlayerProfile | null {
  try {
    const raw = storage.getItem(PROFILE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PlayerProfile>;
    if (typeof parsed.nickname !== 'string' || typeof parsed.completedSetup !== 'boolean') {
      return null;
    }
    return {
      nickname: parsed.nickname.slice(0, 24) || '士兵',
      completedSetup: parsed.completedSetup,
      completedAt: typeof parsed.completedAt === 'number' ? parsed.completedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

export function savePlayerProfile(
  profile: PlayerProfile,
  storage: Pick<Storage, 'setItem'> = localStorage,
): PlayerProfile {
  const sanitized: PlayerProfile = {
    nickname: (profile.nickname ?? '').trim().slice(0, 24) || '士兵',
    completedSetup: profile.completedSetup,
    completedAt: profile.completedAt || Date.now(),
  };
  storage.setItem(PROFILE_KEY, JSON.stringify(sanitized));
  return sanitized;
}

/** 是否首次运行（无档案或未完成首次设置）——驱动首次设置向导 */
export function isFirstRun(profile: PlayerProfile | null = loadPlayerProfile()): boolean {
  return profile === null || !profile.completedSetup;
}
