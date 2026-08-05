import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ensureRapierLoaded,
  getRapier,
  isRapierLoaded,
  resetRapierLoaderForTest,
  type RapierModule,
} from './PhysicsLoader';

/** 构造一个最小 fake Rapier 模块（只含 init，够 loader 逻辑使用） */
function fakeRapier(): RapierModule {
  return { init: vi.fn(async () => undefined) } as unknown as RapierModule;
}

describe('PhysicsLoader（阶段 9 P0：Rapier WASM 延迟加载）', () => {
  beforeEach(() => {
    resetRapierLoaderForTest();
  });
  afterEach(() => {
    resetRapierLoaderForTest();
  });

  it('未加载时 getRapier 抛错（防御误用），isRapierLoaded 为 false', () => {
    expect(isRapierLoaded()).toBe(false);
    expect(() => getRapier()).toThrow(/尚未加载/);
  });

  it('ensureRapierLoaded 动态拉取并 init；加载后 getRapier 返回同一模块', async () => {
    const mod = fakeRapier();
    const loader = vi.fn(async () => mod);

    const loaded = await ensureRapierLoaded(loader);

    expect(loader).toHaveBeenCalledTimes(1);
    expect(mod.init).toHaveBeenCalledTimes(1);
    expect(loaded).toBe(mod);
    expect(isRapierLoaded()).toBe(true);
    expect(getRapier()).toBe(mod);
  });

  it('并发调用共享同一 promise：loader 与 init 只执行一次', async () => {
    const mod = fakeRapier();
    const loader = vi.fn(async () => mod);

    const [a, b, c] = await Promise.all([
      ensureRapierLoaded(loader),
      ensureRapierLoaded(loader),
      ensureRapierLoaded(loader),
    ]);

    expect(loader).toHaveBeenCalledTimes(1);
    expect(mod.init).toHaveBeenCalledTimes(1);
    expect(a).toBe(mod);
    expect(b).toBe(mod);
    expect(c).toBe(mod);
  });

  it('加载完成后再次调用不重复拉取（直接返回缓存模块）', async () => {
    const mod = fakeRapier();
    const loader = vi.fn(async () => mod);

    await ensureRapierLoaded(loader);
    const again = await ensureRapierLoaded(loader);

    expect(loader).toHaveBeenCalledTimes(1);
    expect(again).toBe(mod);
  });

  it('init 失败 → 状态重置，下次调用可重试成功', async () => {
    const bad = fakeRapier();
    (bad.init as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('wasm 下载失败'));
    const good = fakeRapier();
    const loader = vi
      .fn()
      .mockResolvedValueOnce(bad)
      .mockResolvedValueOnce(good);

    await expect(ensureRapierLoaded(loader)).rejects.toThrow('wasm 下载失败');
    expect(isRapierLoaded()).toBe(false);

    const loaded = await ensureRapierLoaded(loader);
    expect(loader).toHaveBeenCalledTimes(2);
    expect(loaded).toBe(good);
    expect(isRapierLoaded()).toBe(true);
  });
});
