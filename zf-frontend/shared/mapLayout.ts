/**
 * 静态遮挡地图布局（阶段 9：确定性化）
 *
 * 阶段 8 遗留：不可破坏建筑/墙体仅客户端随机生成（gameplayRandom），服务端无确定性
 * 几何可裁决弹道遮挡——子弹穿楼、命中裁决与视觉不一致。
 * 此文件为唯一同源：客户端 BerlinRuins 按此布局渲染 + 碰撞，服务端 ProjectileSim
 * 按此布局做弹道挡弹裁决（静态建筑转 ProjectileObstacle，rotationY=0 旋转矩形）。
 * 生成使用 mulberry32 固定种子（确定性 PRNG），同种子同布局。
 */

export interface StaticBuildingLayout {
  /** 中心坐标（ground 平面，y 向上；x/z 为地图坐标） */
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  /** 建筑配色索引（客户端 5 色调色板） */
  colorIndex: number;
  /** 窗户（客户端渲染用，贴在建筑 z+ 面；不参与挡弹） */
  windows: { x: number; y: number; z: number }[];
}

/** 地图边界（与 DEFAULT_MAP_CONFIG.size 一致） */
export const BERLIN_MAP_SIZE = 120;
export const BERLIN_BUILDING_COUNT = 20;
/** 默认种子：固定地图布局（对战地图固定，服务端/客户端/回放一致） */
export const BERLIN_LAYOUT_SEED = 20260805;
/** 静态建筑障碍物 id 基址（与可破坏物 id 空间隔离；可破坏物 id 0-7 远小于此） */
export const STATIC_OBSTACLE_ID_BASE = 10_000;

/** mulberry32：确定性 PRNG（与 src/core/Random.ts 同算法，shared 内独立实现避免依赖前端目录） */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** 生成静态建筑布局（随机调用顺序与客户端原实现一致，同种子下布局不变） */
export function generateBerlinLayout(seed: number = BERLIN_LAYOUT_SEED): StaticBuildingLayout[] {
  const rand = mulberry32(seed);
  const layouts: StaticBuildingLayout[] = [];

  for (let i = 0; i < BERLIN_BUILDING_COUNT; i++) {
    const width = 8 + rand() * 12;
    const depth = 8 + rand() * 12;
    const height = 5 + rand() * 15;

    const x = (rand() - 0.5) * (BERLIN_MAP_SIZE - width);
    const z = (rand() - 0.5) * (BERLIN_MAP_SIZE - depth);
    const colorIndex = Math.floor(rand() * 5);

    const windows: { x: number; y: number; z: number }[] = [];
    for (let j = 0; j < 3; j++) {
      windows.push({
        x: x + (rand() - 0.5) * (width - 2),
        y: 2 + rand() * (height - 4),
        z: z + width / 2 + 0.1,
      });
    }

    layouts.push({ x, z, width, depth, height, colorIndex, windows });
  }

  return layouts;
}

/** 静态建筑 → 服务端弹道障碍物（旋转矩形 + 垂直范围；不可破坏，destroyed 恒 false）
 * 形状与 ProjectileObstacle 对齐（rotationY=0：建筑轴对齐） */
export interface StaticObstacle {
  id: number;
  x: number;
  z: number;
  rotationY: 0;
  halfWidth: number;
  halfDepth: number;
  centerY: number;
  halfHeight: number;
  destroyed: false;
}

export function layoutToStaticObstacles(layouts: StaticBuildingLayout[]): StaticObstacle[] {
  return layouts.map((b, i) => ({
    id: STATIC_OBSTACLE_ID_BASE + i,
    x: b.x,
    z: b.z,
    rotationY: 0,
    halfWidth: b.width / 2,
    halfDepth: b.depth / 2,
    centerY: b.height / 2,
    halfHeight: b.height / 2,
    destroyed: false,
  }));
}
