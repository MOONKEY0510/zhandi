import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { TeamId } from '../game/ConquestMode';
import { Vehicle, VehicleSystem, VehicleType, VehicleDamagePart } from './VehicleSystem';

describe('VehicleSystem（阶段 7 载具 P0）', () => {
  beforeAll(async () => {
    await RAPIER.init();
  });

  function createVehicle(type: VehicleType = VehicleType.JEEP) {
    const scene = new THREE.Scene();
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const vehicle = new Vehicle(scene, type, new THREE.Vector3(0, 1, 0));
    vehicle.createPhysicsBody(world);
    return { scene, world, vehicle };
  }

  it('座位系统：上车（司机/乘客）、座位切换、下车', () => {
    const { vehicle } = createVehicle();
    expect(vehicle.enterVehicle('p1')).toBe('driver');
    expect(vehicle.enterVehicle('p2')).toBe('passenger');
    expect(vehicle.getSeatIndexOf('p1')).toBe(0);
    expect(vehicle.getSeatIndexOf('p2')).toBe(1);

    // 乘客切到司机
    expect(vehicle.switchSeat('p2')).toBe(true);
    expect(vehicle.getSeatIndexOf('p2')).toBe(0);
    expect(vehicle.getSeatIndexOf('p1')).toBe(1);
    expect(vehicle.getSeatLabel('p2')).toBe('驾驶员');

    vehicle.exitVehicle('p1');
    expect(vehicle.getSeatIndexOf('p1')).toBe(-1);
    expect(vehicle.getOccupants()).toEqual(['p2']);
  });

  it('已摧毁载具不能上车', () => {
    const { vehicle } = createVehicle();
    vehicle.takeDamage(9999, undefined, 0);
    expect(vehicle.destroyed).toBe(true);
    expect(vehicle.enterVehicle('p1')).toBeNull();
    expect(vehicle.getOccupants().length).toBe(0);
  });

  it('模块化伤害：后部伤害修正最高（正面最硬）', () => {
    const { vehicle } = createVehicle(VehicleType.TANK);
    const rear = vehicle.mesh.position.clone().add(new THREE.Vector3(0, 0, 3));
    const front = vehicle.mesh.position.clone().add(new THREE.Vector3(0, 0, -3));

    const rearResult = vehicle.takeDamage(50, rear, 0);
    expect(rearResult.direction).toBe('rear');
    // armor 0.8，后部 1.6 → 50 * 0.2 * 1.6 = 16
    expect(rearResult.damage).toBeCloseTo(16, 5);
    expect(rearResult.part).toBe(VehicleDamagePart.HULL);

    const frontResult = vehicle.takeDamage(50, front, 0);
    expect(frontResult.direction).toBe('front');
    // 正面 0.8 → 50 * 0.2 * 0.8 = 8
    expect(frontResult.damage).toBeCloseTo(8, 5);
    expect(frontResult.part).toBe(VehicleDamagePart.ENGINE);
  });

  it('部位摧毁：引擎失效', () => {
    const { vehicle } = createVehicle(VehicleType.TANK);
    const front = vehicle.mesh.position.clone().add(new THREE.Vector3(0, 0, -3));
    // 反复正面打击摧毁引擎
    for (let i = 0; i < 40; i++) {
      vehicle.takeDamage(50, front, i * 10);
      if (vehicle.partStates[VehicleDamagePart.ENGINE].destroyed) break;
    }
    expect(vehicle.partStates[VehicleDamagePart.ENGINE].destroyed).toBe(true);
    expect(vehicle.health).toBeLessThan(vehicle.config.health);
  });

  it('炮塔高命中点分配到 TURRET 部位', () => {
    const { vehicle } = createVehicle(VehicleType.TANK);
    const turretPoint = vehicle.mesh.position.clone().add(new THREE.Vector3(0, 2.2, 0));
    const result = vehicle.takeDamage(30, turretPoint, 0);
    expect(result.part).toBe(VehicleDamagePart.TURRET);
  });

  it('武器：主炮弹药消耗、装填冷却、弹药耗尽', () => {
    const { vehicle } = createVehicle(VehicleType.TANK);
    const initialAmmo = vehicle.ammo;
    const shot1 = vehicle.fireWeapon(0);
    expect(shot1).not.toBeNull();
    expect(vehicle.ammo).toBe(initialAmmo - 1);

    // 冷却中（1.5s 装填）
    expect(vehicle.fireWeapon(1400)).toBeNull();
    expect(vehicle.fireWeapon(1500)).not.toBeNull();

    // 弹药耗尽
    vehicle.ammo = 0;
    expect(vehicle.fireWeapon(3000)).toBeNull();
  });

  it('摧毁 → 登记重生 → 到期自动重生复位', () => {
    const { scene, world, vehicle } = createVehicle();
    const system = new VehicleSystem(scene, world);
    system.vehicles.push(vehicle);

    vehicle.takeDamage(9999, undefined, 0);
    expect(vehicle.destroyed).toBe(true);
    system.scheduleRespawn(vehicle);
    expect(system.getRespawnQueue().length).toBe(1);

    // 16 秒后重生
    system.update(16, 1000);
    expect(system.getRespawnQueue().length).toBe(0);
    expect(vehicle.destroyed).toBe(false);
    expect(vehicle.health).toBe(vehicle.config.health);
    expect(vehicle.ammo).toBe(vehicle.config.ammo);
    expect(vehicle.mesh.visible).toBe(true);
  });

  it('阵营：spawnVehicle 分配 team', () => {
    const { scene, world } = createVehicle();
    const system = new VehicleSystem(scene, world);
    const jeep = system.spawnVehicle(VehicleType.JEEP, new THREE.Vector3(0, 1, 0), TeamId.ALLIES);
    const tank = system.spawnVehicle(VehicleType.TANK, new THREE.Vector3(0, 1, 0), TeamId.AXIS);
    expect(jeep.team).toBe(TeamId.ALLIES);
    expect(tank.team).toBe(TeamId.AXIS);
    expect(system.spawnVehicle(VehicleType.JEEP, new THREE.Vector3(0, 1, 0)).team).toBe(TeamId.NEUTRAL);
  });

  it('补给站：同阵营载具进入半径快速维修 + 补弹', () => {
    const { scene, world, vehicle } = createVehicle(VehicleType.TANK);
    vehicle.team = TeamId.ALLIES;
    const system = new VehicleSystem(scene, world);
    system.vehicles.push(vehicle);
    system.addSupplyStation(new THREE.Vector3(0, 0, 0), 10, TeamId.ALLIES);

    vehicle.health = 100;
    vehicle.ammo = 5;
    vehicle.currentSpeed = 0;

    system.update(2, 0);
    expect(vehicle.health).toBeGreaterThan(100);
    expect(vehicle.ammo).toBeGreaterThan(5);
    expect(system.isVehicleInSupplyZone(vehicle)).toBe(true);
  });

  it('补给站：异阵营载具不享受维修', () => {
    const { scene, world, vehicle } = createVehicle(VehicleType.TANK);
    vehicle.team = TeamId.AXIS;
    const system = new VehicleSystem(scene, world);
    system.vehicles.push(vehicle);
    system.addSupplyStation(new THREE.Vector3(0, 0, 0), 10, TeamId.ALLIES);

    vehicle.health = 100;
    system.update(2, 0);
    expect(vehicle.health).toBe(100);
    expect(system.isVehicleInSupplyZone(vehicle)).toBe(false);
  });

  it('补给站：超出半径不生效', () => {
    const { scene, world, vehicle } = createVehicle(VehicleType.TANK);
    vehicle.team = TeamId.ALLIES;
    const system = new VehicleSystem(scene, world);
    system.vehicles.push(vehicle);
    system.addSupplyStation(new THREE.Vector3(100, 0, 100), 10, TeamId.ALLIES);

    vehicle.health = 100;
    system.update(2, 0);
    expect(vehicle.health).toBe(100);
  });
});
