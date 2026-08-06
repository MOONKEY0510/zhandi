/**
 * 新手训练场教程管理器（阶段 10 P1：新手训练场、兵种引导、载具教程）。
 * 纯逻辑核心：步骤顺序推进；事件驱动完成（射击/换弹/切装/投掷/载具）
 * 与位置检测完成（移动/机动/占点）由 GameScene 调用 completeStep 驱动。
 */

export type TrainingStepId =
  | 'move'
  | 'mobility'
  | 'shoot'
  | 'reload'
  | 'weapon'
  | 'grenade'
  | 'prone'
  | 'lean'
  | 'scope'
  | 'melee'
  | 'mark'
  | 'artillery'
  | 'capture'
  | 'vehicle';

export interface TrainingStep {
  id: TrainingStepId;
  title: string;
  description: string;
}

/** 射击训练所需靶子命中次数 */
export const TARGET_HITS_REQUIRED = 5;

export const TRAINING_STEPS: TrainingStep[] = [
  { id: 'move', title: '移动', description: '使用 WASD 移动，走到前方金色标记点' },
  { id: 'mobility', title: '机动', description: '穿过障碍区：Shift 冲刺 / 空格跳跃 / Ctrl 蹲伏' },
  { id: 'shoot', title: '射击', description: `瞄准靶子射击，命中 ${TARGET_HITS_REQUIRED} 次` },
  { id: 'reload', title: '换弹', description: '按 R 换弹' },
  { id: 'weapon', title: '兵种装备', description: '按数字键 1-4 切换武器与装备（突击兵）' },
  { id: 'grenade', title: '投掷', description: '按 G 投掷手雷' },
  { id: 'prone', title: '匍匐', description: '按 Z 匍匐，再按 Z 起立' },
  { id: 'lean', title: '侧身', description: '按住 Q 或 E 侧身探身' },
  { id: 'scope', title: '瞄具', description: '切到带瞄具的武器（1-4）后按 B 开镜' },
  { id: 'melee', title: '近战', description: '按 V 近战攻击' },
  { id: 'mark', title: '小队标记', description: '瞄准前方靶子按 M 标记（当作假想敌）' },
  { id: 'artillery', title: '炮击', description: '按 H 呼叫炮击支援' },
  { id: 'capture', title: '占点', description: '站进训练据点，等待占领完成' },
  { id: 'vehicle', title: '载具', description: '靠近吉普按 E 进入载具' },
];

export class TrainingMode {
  readonly steps: TrainingStep[];
  currentIndex = 0;
  private completedIds = new Set<TrainingStepId>();
  private targetHits = 0;
  private lastWeaponId: string | null = null;

  constructor(steps: TrainingStep[] = TRAINING_STEPS) {
    this.steps = steps;
  }

  get current(): TrainingStep | null {
    return this.steps[this.currentIndex] ?? null;
  }

  get isCompleted(): boolean {
    return this.currentIndex >= this.steps.length;
  }

  get completedIdsList(): TrainingStepId[] {
    return [...this.completedIds];
  }

  get progress(): { done: number; total: number } {
    return { done: this.completedIds.size, total: this.steps.length };
  }

  get targetHitsCount(): number {
    return this.targetHits;
  }

  reset(): void {
    this.currentIndex = 0;
    this.completedIds.clear();
    this.targetHits = 0;
    this.lastWeaponId = null;
  }

  /** 完成当前步骤并推进；非当前步骤或重复完成返回 false（乱序/重复忽略） */
  completeStep(id: TrainingStepId): boolean {
    const current = this.current;
    if (!current || current.id !== id || this.completedIds.has(id)) return false;
    this.completedIds.add(id);
    this.currentIndex++;
    return true;
  }

  /** 射击训练：命中靶子计数，达到阈值完成射击步骤 */
  registerTargetHit(): boolean {
    if (this.current?.id !== 'shoot') return false;
    this.targetHits++;
    if (this.targetHits >= TARGET_HITS_REQUIRED) return this.completeStep('shoot');
    return false;
  }

  /**
   * 兵种装备训练：首次记录当前武器为基线，之后切换到不同武器即完成。
   * 防止「按 1 切同一把武器」误判为完成。
   */
  registerWeaponSwitch(weaponId: string): boolean {
    if (this.current?.id !== 'weapon') return false;
    if (this.lastWeaponId === null) {
      this.lastWeaponId = weaponId;
      return false;
    }
    if (weaponId === this.lastWeaponId) return false;
    this.lastWeaponId = weaponId;
    return this.completeStep('weapon');
  }
}
