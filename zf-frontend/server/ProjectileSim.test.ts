import { describe, it, expect } from 'vitest';
import { ProjectileSim, segmentHitsRotatedRect, segmentYOverlaps, type ProjectileTarget, type ProjectileObstacle } from './ProjectileSim.ts';
import { BULLET_DAMAGE, BULLET_HEIGHT_HALF, BULLET_HIT_RADIUS, BULLET_MAX_RANGE } from '../shared/protocol.ts';

const DT = 1 / 30;

function target(id: string, team: 0 | 1, x: number, z: number, y = 0): ProjectileTarget {
  return { id, team, x, y, z, alive: true };
}

/** 从 (0,0,0) 沿 +x 方向（yaw=π/2）发射 */
function shootForward(sim: ProjectileSim, ownerId = 'p1', team: 0 | 1 = 0, x = 0, z = 0, y = 0, yaw = Math.PI / 2): void {
  sim.spawn({ ownerId, team, x, y, z, yaw, pitch: 0 });
}

describe('ProjectileSim（阶段 8 服务端命中裁决）', () => {
  it('直线推进：逐步逼近并命中正前方敌方玩家', () => {
    const sim = new ProjectileSim();
    shootForward(sim); // 朝 +x，速度 60 m/s
    const enemy = target('e1', 1, 5, 0);
    // 1 tick 后弹丸在 x=2m（尚未到 5m）
    expect(sim.step(DT, [enemy]).length).toBe(0);
    // 第 2 tick → x=4m，仍差 1m
    expect(sim.step(DT, [enemy]).length).toBe(0);
    // 第 3 tick → x=6m，路径覆盖 5±0.6m 命中带（子步进检测）
    const hits = sim.step(DT, [enemy]);
    expect(hits.length).toBe(1);
    expect(hits[0].targetId).toBe('e1');
    expect(hits[0].damage).toBe(BULLET_DAMAGE);
    expect(sim.stats.hits).toBe(1);
  });

  it('多 tick 推进：步进到目标位置时命中，弹丸销毁', () => {
    const sim = new ProjectileSim();
    shootForward(sim);
    const enemy = target('e1', 1, 3, 0);
    let hits = 0;
    for (let i = 0; i < 200; i++) {
      hits += sim.step(DT, [enemy]).length;
    }
    expect(hits).toBe(1); // 一弹一命中
    expect(sim.count).toBe(0); // 命中后销毁
  });

  it('不命中友军与自身', () => {
    const sim = new ProjectileSim();
    shootForward(sim, 'p1', 0);
    const friend = target('f1', 0, 3, 0);
    for (let i = 0; i < 100; i++) sim.step(DT, [friend]);
    expect(sim.stats.hits).toBe(0);
    expect(sim.stats.expired).toBe(1); // 射程到期消散
  });

  it('垂直偏差超过半高不命中', () => {
    const sim = new ProjectileSim();
    shootForward(sim, 'p1', 0, 0, 0, 0); // 弹道 y=0
    const high = target('e1', 1, 3, 0, BULLET_HEIGHT_HALF + 0.5);
    for (let i = 0; i < 100; i++) sim.step(DT, [high]);
    expect(sim.stats.hits).toBe(0);
  });

  it('水平偏差超过命中半径不命中', () => {
    const sim = new ProjectileSim();
    shootForward(sim, 'p1', 0, 0, 0, 0);
    const aside = target('e1', 1, 3, BULLET_HIT_RADIUS + 0.3);
    for (let i = 0; i < 100; i++) sim.step(DT, [aside]);
    expect(sim.stats.hits).toBe(0);
  });

  it('大型目标（载具）：radius 放大命中判定（偏移 > 玩家半径但 < 载具半径仍命中）', () => {
    const sim = new ProjectileSim();
    shootForward(sim, 'p1', 0, 0, 0, 0);
    // 坦克 hitRadius=2.5：横向偏移 1.5m（> BULLET_HIT_RADIUS 0.6 但 < 2.5）
    const tank = { ...target('v1', 1, 5, 0), radius: 2.5 };
    let hits = 0;
    for (let i = 0; i < 200; i++) hits += sim.step(DT, [tank]).length;
    expect(hits).toBe(1);
    expect(sim.stats.hits).toBe(1);
    // 偏移 3m（> 2.5）→ 不命中
    const sim2 = new ProjectileSim();
    shootForward(sim2, 'p1', 0, 0, 0, 0);
    const farTank = { ...target('v1', 1, 5, 3), radius: 2.5 };
    for (let i = 0; i < 200; i++) sim2.step(DT, [farTank]);
    expect(sim2.stats.hits).toBe(0);
  });

  it('射程外目标不命中（弹丸射程到期）', () => {
    const sim = new ProjectileSim();
    shootForward(sim);
    const far = target('e1', 1, BULLET_MAX_RANGE + 50, 0);
    for (let i = 0; i < 400; i++) sim.step(DT, [far]);
    expect(sim.stats.hits).toBe(0);
    expect(sim.stats.expired).toBe(1);
    expect(sim.count).toBe(0);
  });

  it('死亡目标不命中（尸体不挡弹）', () => {
    const sim = new ProjectileSim();
    shootForward(sim);
    const dead = target('e1', 1, 3, 0);
    dead.alive = false;
    for (let i = 0; i < 100; i++) sim.step(DT, [dead]);
    expect(sim.stats.hits).toBe(0);
  });

  it('俯仰角：pitch>0 弹道抬高，地面目标不命中', () => {
    const sim = new ProjectileSim();
    sim.spawn({ ownerId: 'p1', team: 0, x: 0, y: 0, z: 0, yaw: 0, pitch: Math.PI / 4 });
    const ground = target('e1', 1, 0, -5, 0); // yaw=0 朝 -z
    for (let i = 0; i < 100; i++) sim.step(DT, [ground]);
    expect(sim.stats.hits).toBe(0);
  });

  it('多弹丸并行：各自独立裁决', () => {
    const sim = new ProjectileSim();
    shootForward(sim, 'p1', 0, 0, 0, 0, Math.PI / 2); // 朝 +x
    shootForward(sim, 'p2', 0, 0, 0, 0, -Math.PI / 2); // 朝 -x
    const east = target('e1', 1, 3, 0);
    const west = target('e2', 1, -3, 0);
    for (let i = 0; i < 100; i++) sim.step(DT, [east, west]);
    expect(sim.stats.hits).toBe(2);
  });

  it('挡弹：弹道穿过障碍物时弹丸消散，不命中障碍物后方目标', () => {
    const sim = new ProjectileSim();
    shootForward(sim); // 朝 +x
    const enemy = target('e1', 1, 8, 0);
    // 沙袋：中心 (3,0)，2×1×1 → 半宽 1 / 半深 0.5，中心高 0.5
    const sandbag: ProjectileObstacle = {
      id: 0, x: 3, z: 0, rotationY: 0, halfWidth: 1, halfDepth: 0.5, centerY: 0.5, halfHeight: 0.5, destroyed: false,
    };
    const obstacleHits: { obstacleId: number }[] = [];
    for (let i = 0; i < 200; i++) {
      const hits = sim.step(DT, [enemy], undefined, [sandbag], (h) => obstacleHits.push(h));
      if (hits.length > 0 || obstacleHits.length > 0) break;
    }
    expect(obstacleHits).toHaveLength(1);
    expect(obstacleHits[0].obstacleId).toBe(0);
    expect(sim.stats.hits).toBe(0); // 目标未被命中（挡弹优先）
    expect(sim.count).toBe(0); // 弹丸已消散
  });

  it('已破坏障碍物不挡弹（弹丸穿过，正常命中目标）', () => {
    const sim = new ProjectileSim();
    shootForward(sim);
    const enemy = target('e1', 1, 8, 0);
    const broken: ProjectileObstacle = {
      id: 0, x: 3, z: 0, rotationY: 0, halfWidth: 1, halfDepth: 0.5, centerY: 0.5, halfHeight: 0.5, destroyed: true,
    };
    let hits = 0;
    for (let i = 0; i < 200; i++) hits += sim.step(DT, [enemy], undefined, [broken]).length;
    expect(hits).toBe(1);
  });

  it('垂直范围过滤：弹道高于障碍物顶不挡弹', () => {
    const sim = new ProjectileSim();
    sim.spawn({ ownerId: 'p1', team: 0, x: 0, y: 2, z: 0, yaw: Math.PI / 2, pitch: 0 }); // 弹道 y=2
    const enemy = target('e1', 1, 8, 0);
    const sandbag: ProjectileObstacle = {
      id: 0, x: 3, z: 0, rotationY: 0, halfWidth: 1, halfDepth: 0.5, centerY: 0.5, halfHeight: 0.5, destroyed: false,
    };
    const obstacleHits: unknown[] = [];
    let hits = 0;
    for (let i = 0; i < 200; i++) {
      hits += sim.step(DT, [enemy], undefined, [sandbag], (h) => obstacleHits.push(h)).length;
    }
    expect(obstacleHits).toHaveLength(0); // 沙袋高 1m，弹道 2m 不触发
    expect(hits).toBe(0); // 目标 y=0 也不在弹道上（垂直偏差超半高）
  });

  it('旋转矩形相交：旋转后的细长障碍物按局部轴判定', () => {
    // 栅栏：3×1.2×0.1，旋转 90° 后长轴沿世界 z（半深 0.05 沿世界 x）
    const fence: ProjectileObstacle = {
      id: 4, x: 0, z: 0, rotationY: Math.PI / 2, halfWidth: 1.5, halfDepth: 0.05, centerY: 0.6, halfHeight: 0.6, destroyed: false,
    };
    // 弹道沿世界 z 穿过中心（x=0）：命中
    expect(segmentHitsRotatedRect(0, -2, 0, 2, fence)).toBe(true);
    // 弹道沿世界 z 但 x 偏移 0.2m（超出短轴半宽 0.05）：不命中
    expect(segmentHitsRotatedRect(0.2, -2, 0.2, 2, fence)).toBe(false);
    // 弹道沿世界 x 穿过中心：短轴半宽 0.05 沿 x，必然穿过 → 命中（薄栅栏侧面拦截）
    expect(segmentHitsRotatedRect(-2, 0, 2, 0, fence)).toBe(true);
    expect(segmentYOverlaps(0.5, 0.5, fence)).toBe(true); // y=0.5 在 0..1.2 内
    expect(segmentYOverlaps(1.5, 1.5, fence)).toBe(false); // y=1.5 高于栅栏顶
  });
});
