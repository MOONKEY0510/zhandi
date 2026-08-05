import { describe, it, expect, beforeEach } from 'vitest';
import { HUD, shouldRedrawMinimap, MINIMAP_REFRESH_MS } from './HUD';

function baseData(overrides: Partial<Parameters<HUD['update']>[0]> = {}) {
  return {
    health: 100,
    maxHealth: 100,
    ammo: 30,
    reserveAmmo: 90,
    weaponName: '步枪',
    killCount: 0,
    deathCount: 0,
    isReloading: false,
    reloadProgress: 0,
    hitMarker: false,
    hitMarkerTime: 0,
    damageIndicator: null,
    score: 0,
    position: { x: 0, y: 0, z: 0 },
    ...overrides,
  };
}

describe('HUD（阶段 9 P0：只在数据变化时写 DOM）', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  function mount() {
    const hud = new HUD();
    document.body.appendChild(hud.container);
    return hud;
  }

  it('值变化时正确写入 DOM', () => {
    const hud = mount();
    hud.update(baseData(), 0);

    expect(hud.container.querySelector('#health-text')?.textContent).toBe('100');
    expect(hud.container.querySelector('#health-bar')?.getAttribute('style')).toContain('width: 100%');
    expect(hud.container.querySelector('#ammo-text')?.textContent).toBe('30 / 90');
    expect(hud.container.querySelector('#weapon-name')?.textContent).toBe('步枪');
    expect(hud.container.querySelector('#score-container')?.textContent).toContain('K: 0 / D: 0');
    hud.dispose();
  });

  it('数据未变化时不重复写 DOM（domWriteCount 不增）', () => {
    const hud = mount();

    hud.update(baseData(), 0);
    const afterFirst = hud.domWriteCount;
    expect(afterFirst).toBeGreaterThan(0);
    expect(hud.container.querySelector('#health-text')?.textContent).toBe('100');

    hud.update(baseData(), 16);
    hud.update(baseData(), 32);
    expect(hud.domWriteCount).toBe(afterFirst); // 数据未变：零 DOM 写入
    hud.dispose();
  });

  it('血量变化才重写血量文本，弹药文本独立缓存', () => {
    const hud = mount();

    hud.update(baseData({ health: 100 }), 0);
    const afterFirst = hud.domWriteCount;

    hud.update(baseData({ health: 100, ammo: 29 }), 16); // 弹药变、血量不变
    expect(hud.container.querySelector('#health-text')?.textContent).toBe('100');
    expect(hud.domWriteCount).toBeGreaterThan(afterFirst); // 弹药文本写入

    const afterAmmo = hud.domWriteCount;
    hud.update(baseData({ health: 80 }), 32);
    expect(hud.container.querySelector('#health-text')?.textContent).toBe('80');
    expect(hud.domWriteCount).toBeGreaterThan(afterAmmo);
    hud.dispose();
  });

  it('弹药低量变色只在状态翻转时写', () => {
    const hud = mount();
    const ammoText = hud.container.querySelector<HTMLElement>('#ammo-text')!;

    hud.update(baseData({ ammo: 30 }), 0);
    const afterFirst = hud.domWriteCount;
    hud.update(baseData({ ammo: 30 }), 16);
    expect(hud.domWriteCount).toBe(afterFirst);
    expect(ammoText.style.color).toBe('white');

    hud.update(baseData({ ammo: 4 }), 32);
    expect(ammoText.style.color).toBe('rgb(255, 102, 102)'); // jsdom 规范化 #ff6666
    const afterLow = hud.domWriteCount;
    hud.update(baseData({ ammo: 4 }), 48);
    expect(hud.domWriteCount).toBe(afterLow);

    hud.update(baseData({ ammo: 30 }), 64);
    expect(ammoText.style.color).toBe('white');
    hud.dispose();
  });

  it('换弹条显示/隐藏状态缓存，进度连续更新', () => {
    const hud = mount();

    hud.update(baseData({ isReloading: false }), 0);
    const afterFirst = hud.domWriteCount;
    hud.update(baseData({ isReloading: false }), 16);
    expect(hud.domWriteCount).toBe(afterFirst); // 未换弹：只首次写 opacity '0'

    hud.update(baseData({ isReloading: true, reloadProgress: 0.5 }), 32);
    expect(hud.container.querySelector<HTMLElement>('#reload-bar')?.style.opacity).toBe('1');
    expect(hud.container.querySelector<HTMLElement>('#reload-progress')?.style.width).toContain('50%');

    const afterReload = hud.domWriteCount;
    hud.update(baseData({ isReloading: false }), 48);
    expect(hud.container.querySelector<HTMLElement>('#reload-bar')?.style.opacity).toBe('0');
    expect(hud.domWriteCount).toBeGreaterThan(afterReload);
    hud.dispose();
  });

  it('据点 UI（兵力值/控制点）只在数据变化时写 DOM', () => {
    const hud = mount();
    const axisTickets = hud.container.querySelector<HTMLElement>('#axis-ticket-count')!;
    const alliesTickets = hud.container.querySelector<HTMLElement>('#allies-ticket-count')!;
    const cpA = hud.container.querySelector<HTMLElement>('#cp-A')!;
    const cps = (owner: string) => [{ id: 'A', owner, progress: 0.5 }, { id: 'B', owner: 'allies', progress: 0.2 }, { id: 'C', owner: 'allies', progress: 0 }];

    hud.update(baseData({ axisTickets: 100, alliesTickets: 100, controlPoints: cps('axis') }), 0);
    expect(axisTickets.textContent).toBe('100');
    expect(alliesTickets.textContent).toBe('100');
    expect(cpA.style.background).toContain('rgba(255, 68, 68'); // axis 红色
    const afterFirst = hud.domWriteCount;

    // 数据未变：零写入
    hud.update(baseData({ axisTickets: 100, alliesTickets: 100, controlPoints: cps('axis') }), 16);
    expect(hud.domWriteCount).toBe(afterFirst);

    // 兵力变化：只写兵力文本
    hud.update(baseData({ axisTickets: 95, alliesTickets: 100, controlPoints: cps('axis') }), 32);
    expect(axisTickets.textContent).toBe('95');

    // 控制点归属变化：重绘据点
    const beforeCp = hud.domWriteCount;
    hud.update(baseData({ axisTickets: 95, alliesTickets: 100, controlPoints: cps('allies') }), 48);
    expect(hud.domWriteCount).toBeGreaterThan(beforeCp);
    expect(cpA.style.background).toContain('rgba(68, 136, 255'); // allies 蓝色
    hud.dispose();
  });
});
