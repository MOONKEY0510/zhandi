/**
 * 统一 VFX 池（阶段 6 特效 P0）。
 * 枪口火焰、曳光弹、火花、尘土、爆炸、烟雾、火焰、弹孔统一走池化句柄：
 * - 槽位复用，避免每帧 new Geometry/Material；
 * - 全局与单类型预算，超限时按“重要性最低 + 最旧”淘汰；
 * - 按距离分级 near/mid/far/hidden，离屏超时自动回收。
 * 本模块只管理句柄与预算，渲染表现由接入层根据 handle 驱动。
 */
export enum VfxType {
  MUZZLE_FLASH = 'muzzle_flash',
  TRACER = 'tracer',
  SPARK = 'spark',
  DUST = 'dust',
  EXPLOSION = 'explosion',
  SMOKE = 'smoke',
  FIRE = 'fire',
  BULLET_HOLE = 'bullet_hole',
}

export type VfxImportance = 'low' | 'medium' | 'high';

export type VfxLod = 'near' | 'mid' | 'far' | 'hidden';

export interface VfxPosition {
  x: number;
  y: number;
  z: number;
}

export interface ActiveVfx {
  id: number;
  type: VfxType;
  position: VfxPosition;
  importance: VfxImportance;
  durationMs: number;
  startedAtMs: number;
  lod: VfxLod;
  visible: boolean;
}

export interface VfxSpawnOptions {
  type: VfxType;
  position: VfxPosition;
  importance?: VfxImportance;
  /** 生命周期 ms，到期自动回收 */
  durationMs?: number;
}

export interface VfxPoolOptions {
  maxActive: number;
  maxPerType: number;
  lodDistances: { near: number; mid: number; far: number };
  /** 离屏（hidden）超过该时长回收，ms */
  hiddenTimeoutMs: number;
  /** 绝对生命周期上限，防止泄漏，ms */
  maxLifetimeMs: number;
}

export const DEFAULT_VFX_POOL_OPTIONS: VfxPoolOptions = {
  maxActive: 256,
  maxPerType: 64,
  lodDistances: { near: 15, mid: 45, far: 120 },
  hiddenTimeoutMs: 5000,
  maxLifetimeMs: 30000,
};

const IMPORTANCE_RANK: Record<VfxImportance, number> = { low: 0, medium: 1, high: 2 };

export class VfxPool {
  private readonly active: ActiveVfx[] = [];
  private readonly freeSlots: ActiveVfx[] = [];
  private nextId = 1;

  constructor(private readonly options: VfxPoolOptions = DEFAULT_VFX_POOL_OPTIONS) {}

  spawn(options: VfxSpawnOptions, nowMs: number): ActiveVfx | null {
    const slot = this.acquireSlot(options.type, nowMs);
    if (!slot) return null;

    slot.id = this.nextId++;
    slot.type = options.type;
    slot.position = { ...options.position };
    slot.importance = options.importance ?? 'medium';
    slot.durationMs = options.durationMs ?? 1000;
    slot.startedAtMs = nowMs;
    slot.lod = 'near';
    slot.visible = true;

    this.active.push(slot);
    return slot;
  }

  /** 每帧调用：按距离更新 LOD，回收到期/离屏超时实体 */
  update(nowMs: number, cameraPosition: VfxPosition): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const vfx = this.active[i];
      const distance = distanceBetween(vfx.position, cameraPosition);
      vfx.lod = this.resolveLod(distance);
      vfx.visible = vfx.lod !== 'hidden';

      const age = nowMs - vfx.startedAtMs;
      const expired = age >= vfx.durationMs || age >= this.options.maxLifetimeMs;
      const hiddenTooLong = vfx.lod === 'hidden' && age >= this.options.hiddenTimeoutMs;
      if (expired || hiddenTooLong) {
        this.releaseAt(i);
      }
    }
  }

  release(vfx: ActiveVfx): void {
    const index = this.active.findIndex((candidate) => candidate.id === vfx.id);
    if (index >= 0) this.releaseAt(index);
  }

  dispose(): void {
    this.active.length = 0;
    this.freeSlots.length = 0;
  }

  getActive(): readonly ActiveVfx[] {
    return this.active;
  }

  getActiveCount(): number {
    return this.active.length;
  }

  getFreeSlotCount(): number {
    return this.freeSlots.length;
  }

  /** 已分配的槽位总数（active + free），用于观察池是否稳定 */
  getTotalAllocated(): number {
    return this.active.length + this.freeSlots.length;
  }

  getCountByType(type: VfxType): number {
    let count = 0;
    for (const vfx of this.active) {
      if (vfx.type === type) count++;
    }
    return count;
  }

  private acquireSlot(type: VfxType, nowMs: number): ActiveVfx | null {
    if (this.getCountByType(type) >= this.options.maxPerType) {
      const oldestSameType = this.findOldestOfType(type);
      if (oldestSameType) this.release(oldestSameType);
    }

    const reused = this.freeSlots.pop();
    if (reused) return reused;

    if (this.active.length < this.options.maxActive) {
      return {
        id: 0,
        type,
        position: { x: 0, y: 0, z: 0 },
        importance: 'medium',
        durationMs: 0,
        startedAtMs: nowMs,
        lod: 'near',
        visible: true,
      };
    }

    const victim = this.findEvictionCandidate();
    if (!victim) return null;
    this.release(victim);
    return this.freeSlots.pop() ?? null;
  }

  private findOldestOfType(type: VfxType): ActiveVfx | null {
    let oldest: ActiveVfx | null = null;
    for (const vfx of this.active) {
      if (vfx.type !== type) continue;
      if (!oldest || vfx.startedAtMs < oldest.startedAtMs) oldest = vfx;
    }
    return oldest;
  }

  private findEvictionCandidate(): ActiveVfx | null {
    let victim: ActiveVfx | null = null;
    for (const vfx of this.active) {
      if (!victim) {
        victim = vfx;
        continue;
      }
      const rank = IMPORTANCE_RANK[vfx.importance];
      const victimRank = IMPORTANCE_RANK[victim.importance];
      if (rank < victimRank || (rank === victimRank && vfx.startedAtMs < victim.startedAtMs)) {
        victim = vfx;
      }
    }
    return victim;
  }

  private resolveLod(distance: number): VfxLod {
    const { near, mid, far } = this.options.lodDistances;
    if (distance <= near) return 'near';
    if (distance <= mid) return 'mid';
    if (distance <= far) return 'far';
    return 'hidden';
  }

  private releaseAt(index: number): void {
    const [vfx] = this.active.splice(index, 1);
    this.freeSlots.push(vfx);
  }
}

export function distanceBetween(a: VfxPosition, b: VfxPosition): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
