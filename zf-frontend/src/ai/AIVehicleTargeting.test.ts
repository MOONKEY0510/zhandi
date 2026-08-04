import { describe, it, expect } from 'vitest';
import { TeamId } from '../game/ConquestMode';
import {
  findNearestEnemyVehicle,
  shouldEngageVehicle,
  isVehicleTargetStale,
  VEHICLE_THREAT_DISTANCE,
  type VehicleTargetInfo,
  type BotVehicleContext,
} from './AIVehicleTargeting';

const observer = { x: 0, z: 0 };

function vehicle(id: string, x: number, z: number, team: TeamId = TeamId.AXIS, destroyed = false): VehicleTargetInfo {
  return { id, team, destroyed, position: { x, z } };
}

function ctx(partial: Partial<BotVehicleContext> = {}): BotVehicleContext {
  return {
    botTeam: TeamId.ALLIES,
    hasRocketLauncher: false,
    hasTarget: false,
    targetIsVehicle: false,
    currentTargetDistance: null,
    playerDistance: null,
    ...partial,
  };
}

describe('AIVehicleTargeting（阶段 7 AI 反载具决策）', () => {
  it('findNearestEnemyVehicle：只返回最近的敌方载具', () => {
    const vehicles = [
      vehicle('a', 30, 0),
      vehicle('b', 10, 0),
      vehicle('friendly', 5, 0, TeamId.ALLIES),
      vehicle('neutral', 8, 0, TeamId.NEUTRAL),
      vehicle('destroyed', 2, 0, TeamId.AXIS, true),
    ];
    const nearest = findNearestEnemyVehicle(vehicles, observer, TeamId.ALLIES, 50);
    expect(nearest?.id).toBe('b');
  });

  it('findNearestEnemyVehicle：超距返回 null', () => {
    const vehicles = [vehicle('a', 60, 0)];
    expect(findNearestEnemyVehicle(vehicles, observer, TeamId.ALLIES, 50)).toBeNull();
  });

  it('findNearestEnemyVehicle：无敌方载具返回 null', () => {
    const vehicles = [vehicle('friendly', 10, 0, TeamId.ALLIES)];
    expect(findNearestEnemyVehicle(vehicles, observer, TeamId.ALLIES, 50)).toBeNull();
  });

  it('shouldEngageVehicle：无目标时直接接敌', () => {
    expect(shouldEngageVehicle(30, ctx())).toBe(true);
  });

  it('shouldEngageVehicle：已在打载具时保持', () => {
    expect(shouldEngageVehicle(80, ctx({ hasTarget: true, targetIsVehicle: true }))).toBe(true);
  });

  it('shouldEngageVehicle：有步兵目标且载具远时不切换', () => {
    const c = ctx({ hasTarget: true, targetIsVehicle: false, currentTargetDistance: 10, playerDistance: 10 });
    expect(shouldEngageVehicle(50, c)).toBe(false);
  });

  it('shouldEngageVehicle：载具进入威胁距离时切换', () => {
    const c = ctx({ hasTarget: true, targetIsVehicle: false, currentTargetDistance: 30, playerDistance: 30 });
    expect(shouldEngageVehicle(VEHICLE_THREAT_DISTANCE - 1, c)).toBe(true);
  });

  it('shouldEngageVehicle：火箭筒兵种威胁距离更激进', () => {
    const c = ctx({
      hasRocketLauncher: true,
      hasTarget: true,
      targetIsVehicle: false,
      currentTargetDistance: 20,
      playerDistance: 20,
    });
    // 无火箭筒时 20m 载具不切换（20 > 18）；有火箭筒时 20 < 18*1.4 切换
    expect(shouldEngageVehicle(20, c)).toBe(true);
  });

  it('shouldEngageVehicle：载具显著更近（<60% 当前目标距离）时切换', () => {
    const c = ctx({ hasTarget: true, targetIsVehicle: false, currentTargetDistance: 50, playerDistance: 50 });
    expect(shouldEngageVehicle(25, c)).toBe(true);
  });

  it('isVehicleTargetStale：被摧毁或超距视为失效', () => {
    expect(isVehicleTargetStale(vehicle('a', 10, 0, TeamId.AXIS, true), observer, 50)).toBe(true);
    expect(isVehicleTargetStale(vehicle('a', 10, 0), observer, 5)).toBe(true);
    expect(isVehicleTargetStale(vehicle('a', 10, 0), observer, 50)).toBe(false);
    expect(isVehicleTargetStale(null, observer, 50)).toBe(true);
  });
});
