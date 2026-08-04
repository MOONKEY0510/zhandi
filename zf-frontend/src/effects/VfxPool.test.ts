import { describe, expect, it } from 'vitest';
import { DEFAULT_VFX_POOL_OPTIONS, VfxPool, VfxType, type VfxPoolOptions } from './VfxPool';

function makeOptions(overrides: Partial<VfxPoolOptions> = {}): VfxPoolOptions {
  return { ...DEFAULT_VFX_POOL_OPTIONS, ...overrides };
}

const ORIGIN = { x: 0, y: 0, z: 0 };

describe('VfxPool', () => {
  it('spawns visible effects with increasing ids', () => {
    const pool = new VfxPool(makeOptions());
    const first = pool.spawn({ type: VfxType.SMOKE, position: ORIGIN }, 0);
    const second = pool.spawn({ type: VfxType.EXPLOSION, position: ORIGIN }, 1);

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(second!.id).toBeGreaterThan(first!.id);
    expect(first!.visible).toBe(true);
    expect(pool.getActiveCount()).toBe(2);
  });

  it('reuses released slots without growing the pool', () => {
    const pool = new VfxPool(makeOptions());
    const vfx = pool.spawn({ type: VfxType.SPARK, position: ORIGIN }, 0)!;
    expect(pool.getTotalAllocated()).toBe(1);

    pool.release(vfx);
    expect(pool.getActiveCount()).toBe(0);
    expect(pool.getFreeSlotCount()).toBe(1);

    const again = pool.spawn({ type: VfxType.SPARK, position: ORIGIN }, 1);
    expect(again).not.toBeNull();
    expect(pool.getTotalAllocated()).toBe(1);
    expect(pool.getActiveCount()).toBe(1);
  });

  it('evicts the lowest importance effect when the pool is full', () => {
    const pool = new VfxPool(makeOptions({ maxActive: 3 }));
    const low = pool.spawn({ type: VfxType.DUST, position: ORIGIN, importance: 'low' }, 0)!;
    const lowId = low.id;
    pool.spawn({ type: VfxType.EXPLOSION, position: ORIGIN, importance: 'high' }, 1);
    pool.spawn({ type: VfxType.EXPLOSION, position: ORIGIN, importance: 'high' }, 2);

    pool.spawn({ type: VfxType.EXPLOSION, position: ORIGIN, importance: 'high' }, 3);

    expect(pool.getActiveCount()).toBe(3);
    expect(pool.getActive().some((vfx) => vfx.id === lowId)).toBe(false);
  });

  it('caps effects per type by evicting the oldest of the same type', () => {
    const pool = new VfxPool(makeOptions({ maxPerType: 2 }));
    const oldest = pool.spawn({ type: VfxType.SMOKE, position: ORIGIN }, 0)!;
    const oldestId = oldest.id;
    pool.spawn({ type: VfxType.SMOKE, position: ORIGIN }, 1);
    pool.spawn({ type: VfxType.SMOKE, position: ORIGIN }, 2);

    expect(pool.getCountByType(VfxType.SMOKE)).toBe(2);
    expect(pool.getActive().some((vfx) => vfx.id === oldestId)).toBe(false);
  });

  it('grades lod by distance to the camera', () => {
    const pool = new VfxPool(makeOptions({ lodDistances: { near: 15, mid: 45, far: 120 } }));
    const near = pool.spawn({ type: VfxType.TRACER, position: { x: 5, y: 0, z: 0 } }, 0)!;
    const mid = pool.spawn({ type: VfxType.TRACER, position: { x: 30, y: 0, z: 0 } }, 1)!;
    const far = pool.spawn({ type: VfxType.TRACER, position: { x: 80, y: 0, z: 0 } }, 2)!;
    const hidden = pool.spawn({ type: VfxType.TRACER, position: { x: 200, y: 0, z: 0 } }, 3)!;

    pool.update(4, ORIGIN);

    expect(near.lod).toBe('near');
    expect(mid.lod).toBe('mid');
    expect(far.lod).toBe('far');
    expect(hidden.lod).toBe('hidden');
    expect(hidden.visible).toBe(false);
    expect(near.visible).toBe(true);
  });

  it('recycles effects when their lifetime expires', () => {
    const pool = new VfxPool(makeOptions());
    pool.spawn({ type: VfxType.MUZZLE_FLASH, position: ORIGIN, durationMs: 100 }, 0);
    expect(pool.getActiveCount()).toBe(1);

    pool.update(200, ORIGIN);
    expect(pool.getActiveCount()).toBe(0);
    expect(pool.getFreeSlotCount()).toBe(1);
  });

  it('recycles hidden effects after the hidden timeout', () => {
    const pool = new VfxPool(makeOptions({ hiddenTimeoutMs: 100, maxLifetimeMs: 10000 }));
    pool.spawn({ type: VfxType.SMOKE, position: { x: 500, y: 0, z: 0 }, durationMs: 5000 }, 0);
    expect(pool.getActiveCount()).toBe(1);

    // 离屏但未超时：保留且不可见
    pool.update(50, ORIGIN);
    expect(pool.getActiveCount()).toBe(1);
    expect(pool.getActive()[0].visible).toBe(false);

    // 超时：回收
    pool.update(150, ORIGIN);
    expect(pool.getActiveCount()).toBe(0);
  });

  it('dispose clears all state', () => {
    const pool = new VfxPool(makeOptions());
    pool.spawn({ type: VfxType.FIRE, position: ORIGIN }, 0);
    pool.dispose();
    expect(pool.getActiveCount()).toBe(0);
    expect(pool.getTotalAllocated()).toBe(0);
  });
});
