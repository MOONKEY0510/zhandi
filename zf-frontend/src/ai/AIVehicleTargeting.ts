import { TeamId } from '../game/ConquestMode';

/**
 * AI 反载具目标决策（阶段 7 P1）。
 * 纯函数模块，不依赖 THREE/Rapier，便于单测：
 * - 找到观察者附近最近的敌方载具（按阵营过滤，中立载具不参与）；
 * - 判定是否应把当前目标切换为载具（威胁优先级）。
 */

/** AI 能感知的载具最小信息（GameScene 传入真实 Vehicle，结构兼容） */
export interface VehicleTargetInfo {
  id: string | number;
  team: TeamId;
  destroyed: boolean;
  position: { x: number; z: number };
}

export interface BotVehicleContext {
  botTeam: TeamId;
  /** 载具威胁感知距离（相对 detectionRange 的比例） */
  hasRocketLauncher: boolean;
  hasTarget: boolean;
  targetIsVehicle: boolean;
  /** 当前目标距离（米），无目标为 null */
  currentTargetDistance: number | null;
  /** 玩家距离（米），无玩家为 null */
  playerDistance: number | null;
}

/** 载具进入该距离视为迫近威胁，AI 会放下当前目标优先反载具 */
export const VEHICLE_THREAT_DISTANCE = 18;

/** 感知距离 = 基础探测范围 × 系数（载具目标比步兵更容易被发现） */
export const VEHICLE_DETECTION_MULTIPLIER = 1.2;

/** 找到最近的敌方载具（destroyed 或同阵营/中立排除） */
export function findNearestEnemyVehicle(
  vehicles: readonly VehicleTargetInfo[],
  observer: { x: number; z: number },
  botTeam: TeamId,
  maxDistance: number,
): VehicleTargetInfo | null {
  let nearest: VehicleTargetInfo | null = null;
  let nearestDistance = maxDistance;
  for (const vehicle of vehicles) {
    if (vehicle.destroyed) continue;
    if (vehicle.team === TeamId.NEUTRAL || vehicle.team === botTeam) continue;
    const dx = vehicle.position.x - observer.x;
    const dz = vehicle.position.z - observer.z;
    const distance = Math.sqrt(dx * dx + dz * dz);
    if (distance <= nearestDistance) {
      nearest = vehicle;
      nearestDistance = distance;
    }
  }
  return nearest;
}

/**
 * 是否切换/保持载具目标：
 * - 已在打载具 → 保持（由上层在载具被毁/超距时清除）；
 * - 无目标 → 打；
 * - 正在打步兵/玩家 → 只有载具进入威胁距离（或明显更近）才切换，
 *   且携带火箭筒的 AI（反坦克兵）切换阈值更激进。
 */
export function shouldEngageVehicle(
  distance: number,
  ctx: BotVehicleContext,
): boolean {
  if (ctx.hasTarget && ctx.targetIsVehicle) return true;
  if (!ctx.hasTarget) return true;

  const threatDistance = ctx.hasRocketLauncher
    ? VEHICLE_THREAT_DISTANCE * 1.4
    : VEHICLE_THREAT_DISTANCE;

  if (distance <= threatDistance) return true;

  const currentDist = ctx.currentTargetDistance ?? ctx.playerDistance ?? Number.POSITIVE_INFINITY;
  // 载具显著更近（< 当前目标距离的 60%）也切换
  return distance < currentDist * 0.6;
}

/** 载具目标是否已失效（被摧毁或超出感知距离） */
export function isVehicleTargetStale(
  vehicle: VehicleTargetInfo | null,
  observer: { x: number; z: number },
  maxDistance: number,
): boolean {
  if (!vehicle || vehicle.destroyed) return true;
  const dx = vehicle.position.x - observer.x;
  const dz = vehicle.position.z - observer.z;
  return Math.sqrt(dx * dx + dz * dz) > maxDistance;
}
