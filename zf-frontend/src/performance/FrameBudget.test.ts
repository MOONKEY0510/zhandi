import { describe, it, expect } from 'vitest';
import { FrameBudget, FRAME_BUDGET_TABLE } from './FrameBudget';

/** 确定性时钟：手动推进 */
class FakeClock {
  private t = 0;
  now = (): number => this.t;
  advance(ms: number): void {
    this.t += ms;
  }
}

describe('FrameBudget（阶段 9：CPU 帧预算采集）', () => {
  it('预算表与计划文档 7 段对齐（平均 / P95 上限）', () => {
    expect(FRAME_BUDGET_TABLE.map((d) => d.id)).toEqual([
      'simulation',
      'ai',
      'physics',
      'animation',
      'network',
      'ui',
      'render',
    ]);
    const byId = Object.fromEntries(FRAME_BUDGET_TABLE.map((d) => [d.id, d]));
    expect(byId.simulation).toMatchObject({ budgetMs: 1.0, p95LimitMs: 2.0 });
    expect(byId.ai).toMatchObject({ budgetMs: 2.5, p95LimitMs: 5.0 });
    expect(byId.physics).toMatchObject({ budgetMs: 2.0, p95LimitMs: 4.0 });
    expect(byId.animation).toMatchObject({ budgetMs: 1.5, p95LimitMs: 3.0 });
    expect(byId.network).toMatchObject({ budgetMs: 0.7, p95LimitMs: 1.5 });
    expect(byId.ui).toMatchObject({ budgetMs: 0.7, p95LimitMs: 1.5 });
    expect(byId.render).toMatchObject({ budgetMs: 7.0, p95LimitMs: 12.0 });
  });

  it('begin/end 累计各段耗时，窗口统计正确', () => {
    const clock = new FakeClock();
    const fb = new FrameBudget(300, clock.now);
    fb.begin('physics');
    clock.advance(2.5);
    fb.end('physics');
    fb.begin('render');
    clock.advance(8);
    fb.end('render');

    const physics = fb.stats('physics');
    expect(physics.lastMs).toBeCloseTo(2.5);
    expect(physics.avgMs).toBeCloseTo(2.5);
    expect(physics.samples).toBe(1);
    expect(physics.overBudgetCount).toBe(1); // 2.5 > 物理平均预算 2.0

    const render = fb.stats('render');
    expect(render.lastMs).toBeCloseTo(8);
    expect(render.samples).toBe(1);
    expect(render.overBudgetCount).toBe(1); // 8 > 渲染平均预算 7.0

    // 未采样的段为 0
    expect(fb.stats('ai').samples).toBe(0);
    expect(fb.stats('ai').lastMs).toBe(0);
  });

  it('滚动窗口：超窗丢弃最旧样本，P50/P95 反映窗口内数据', () => {
    const clock = new FakeClock();
    const fb = new FrameBudget(4, clock.now);
    // 5 个样本：1,2,3,4,5（窗口 4 → 保留 2,3,4,5）
    for (let i = 1; i <= 5; i += 1) {
      fb.begin('ai');
      clock.advance(i);
      fb.end('ai');
    }
    const stats = fb.stats('ai');
    expect(stats.samples).toBe(4);
    expect(stats.maxMs).toBe(5);
    expect(stats.p50Ms).toBe(3); // nearest-rank：[2,3,4,5] 第 ceil(0.5*4)=2 个
    expect(stats.p95Ms).toBe(5); // ceil(0.95*4)=4 → 最大值
    expect(stats.avgMs).toBeCloseTo(3.5);
  });

  it('end 无 begin 静默忽略；begin 覆盖未 end 旧起点（防御漏配对）', () => {
    const clock = new FakeClock();
    const fb = new FrameBudget(300, clock.now);
    fb.end('ui'); // 无 begin：忽略，不产生样本
    expect(fb.stats('ui').samples).toBe(0);

    fb.begin('network');
    clock.advance(1);
    fb.begin('network'); // 覆盖旧起点
    clock.advance(2);
    fb.end('network');
    expect(fb.stats('network').lastMs).toBeCloseTo(2);
  });

  it('allStats 覆盖全部 7 段；isWithinBudget 按平均预算判定', () => {
    const clock = new FakeClock();
    const fb = new FrameBudget(300, clock.now);
    expect(fb.allStats()).toHaveLength(7);
    expect(fb.isWithinBudget()).toBe(true); // 无样本 → 0 ≤ 预算

    fb.begin('render');
    clock.advance(20); // 远超平均预算 7.0
    fb.end('render');
    expect(fb.isWithinBudget()).toBe(false);
  });

  it('reset 清空全部采样与超预算计数', () => {
    const clock = new FakeClock();
    const fb = new FrameBudget(300, clock.now);
    fb.begin('simulation');
    clock.advance(3);
    fb.end('simulation');
    expect(fb.stats('simulation').samples).toBe(1);

    fb.reset();
    expect(fb.stats('simulation').samples).toBe(0);
    expect(fb.stats('simulation').overBudgetCount).toBe(0);
    expect(fb.isWithinBudget()).toBe(true);
  });
});
