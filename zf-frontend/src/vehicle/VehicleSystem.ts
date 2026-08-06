import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { getRapier, type RapierModule } from '../physics/PhysicsLoader';
import { TeamId } from '../game/ConquestMode';

export enum VehicleType {
  JEEP = 'jeep',
  TANK = 'tank',
  TRUCK = 'truck',
  MOTORCYCLE = 'motorcycle',
}

/** 载具武器类别：机枪（直射/快速）、主炮（弹道/爆炸） */
export type VehicleWeaponKind = 'machinegun' | 'cannon' | 'none';

/** 模块化伤害部位（阶段 7 P0） */
export enum VehicleDamagePart {
  HULL = 'hull',
  TRACKS = 'tracks',
  TURRET = 'turret',
  ENGINE = 'engine',
}

export interface VehicleConfig {
  type: VehicleType;
  name: string;
  maxSpeed: number;
  acceleration: number;
  turnSpeed: number;
  health: number;
  armor: number;
  seats: number;
  weaponMount: boolean;
  weaponKind: VehicleWeaponKind;
  weaponDamage: number;
  weaponRange: number;
  /** 发射间隔 ms */
  fireIntervalMs: number;
  /** 最大弹药量 */
  ammo: number;
  /** 主炮爆炸半径（m），机枪为 0 */
  explosionRadius: number;
  mass: number;
  dimensions: { width: number; height: number; length: number };
}

export const VEHICLE_CONFIGS: Record<VehicleType, VehicleConfig> = {
  [VehicleType.JEEP]: {
    type: VehicleType.JEEP,
    name: '军用吉普',
    maxSpeed: 30,
    acceleration: 8,
    turnSpeed: 2,
    health: 200,
    armor: 0.3,
    seats: 4,
    weaponMount: true,
    weaponKind: 'machinegun',
    weaponDamage: 14,
    weaponRange: 200,
    fireIntervalMs: 120,
    ammo: 400,
    explosionRadius: 0,
    mass: 1500,
    dimensions: { width: 2, height: 1.8, length: 4 },
  },
  [VehicleType.TANK]: {
    type: VehicleType.TANK,
    name: '轻型坦克',
    maxSpeed: 15,
    acceleration: 3,
    turnSpeed: 1,
    health: 500,
    armor: 0.8,
    seats: 3,
    weaponMount: true,
    weaponKind: 'cannon',
    weaponDamage: 120,
    weaponRange: 500,
    fireIntervalMs: 1500,
    ammo: 30,
    explosionRadius: 7,
    mass: 8000,
    dimensions: { width: 3.5, height: 2.5, length: 6 },
  },
  [VehicleType.TRUCK]: {
    type: VehicleType.TRUCK,
    name: '运输卡车',
    maxSpeed: 20,
    acceleration: 4,
    turnSpeed: 1.5,
    health: 300,
    armor: 0.4,
    seats: 6,
    weaponMount: false,
    weaponKind: 'none',
    weaponDamage: 0,
    weaponRange: 0,
    fireIntervalMs: 0,
    ammo: 0,
    explosionRadius: 0,
    mass: 3000,
    dimensions: { width: 2.5, height: 2.8, length: 7 },
  },
  [VehicleType.MOTORCYCLE]: {
    type: VehicleType.MOTORCYCLE,
    name: '军用摩托',
    maxSpeed: 40,
    acceleration: 12,
    turnSpeed: 3,
    health: 80,
    armor: 0.1,
    seats: 2,
    weaponMount: false,
    weaponKind: 'none',
    weaponDamage: 0,
    weaponRange: 0,
    fireIntervalMs: 0,
    ammo: 0,
    explosionRadius: 0,
    mass: 200,
    dimensions: { width: 0.8, height: 1.2, length: 2 },
  },
};

export interface VehiclePartState {
  health: number;
  maxHealth: number;
  destroyed: boolean;
}

export type VehicleHitDirection = 'front' | 'side' | 'rear';

export interface VehicleHitResult {
  damage: number;
  part: VehicleDamagePart;
  direction: VehicleHitDirection;
  killed: boolean;
}

export interface VehicleShot {
  kind: VehicleWeaponKind;
  /** 炮口世界坐标 */
  origin: THREE.Vector3;
  /** 炮口朝向（世界） */
  direction: THREE.Vector3;
  damage: number;
  range: number;
  explosionRadius: number;
  owner: Vehicle;
}

export interface VehicleSeatInfo {
  index: number;
  label: string;
  occupant: string | null;
}

/** 载具补给站（阶段 7 P1）：进入半径内的同阵营载具快速维修 + 弹药补充 */
export interface SupplyStation {
  id: number;
  position: THREE.Vector3;
  radius: number;
  team: TeamId;
}

interface GroundProbeResult {
  hit: boolean;
  groundY: number;
}

const PART_HEALTH_FACTORS: Record<VehicleDamagePart, number> = {
  // 部位血量 = 整车血量 × 系数：部件在整车被摧毁前即可失效
  [VehicleDamagePart.HULL]: 1,
  [VehicleDamagePart.TRACKS]: 0.3,
  [VehicleDamagePart.TURRET]: 0.25,
  [VehicleDamagePart.ENGINE]: 0.4,
};

export class Vehicle {
  config: VehicleConfig;
  mesh: THREE.Group;
  body: RAPIER.RigidBody | null = null;
  collider: RAPIER.Collider | null = null;
  /** Rapier 模块引用（阶段 9：延迟加载，物理模块经 PhysicsLoader 注入） */
  private readonly rapier: RapierModule = getRapier();
  /** 所属阵营（阶段 7 AI 反载具：友方载具不被打，敌方载具被 AI 集火） */
  team: TeamId = TeamId.NEUTRAL;
  health: number;
  currentSpeed: number = 0;
  currentTurn: number = 0;
  isOccupied: boolean = false;
  destroyed: boolean = false;
  ammo: number;
  lastFireTime: number = Number.NEGATIVE_INFINITY;
  lastDamageTime: number = 0;

  /** 模块化伤害状态（阶段 7） */
  partStates: Record<VehicleDamagePart, VehiclePartState>;
  private currentMaxSpeed: number;
  private currentTurnSpeed: number;

  /** 座位槽位：0 = 驾驶员，其余为乘客 */
  private seats: (string | null)[] = [];
  private seatLabels: string[] = [];

  /** 炮塔组（含炮管），主炮旋转用 */
  private turretGroup: THREE.Group | null = null;
  /** 炮塔当前 yaw（相对车体） */
  private turretYaw = 0;
  /** 炮塔目标 yaw，平滑逼近 */
  private turretTargetYaw = 0;
  /** 炮塔被摧毁后禁用武器 */
  private weaponDisabled = false;

  /** 重生数据：初始位置与朝向 */
  readonly spawnPosition: THREE.Vector3;
  private spawnRotationY = 0;

  constructor(scene: THREE.Scene, type: VehicleType, position: THREE.Vector3, team: TeamId = TeamId.NEUTRAL) {
    this.config = VEHICLE_CONFIGS[type];
    this.team = team;
    this.health = this.config.health;
    this.ammo = this.config.ammo;
    this.currentMaxSpeed = this.config.maxSpeed;
    this.currentTurnSpeed = this.config.turnSpeed;

    this.partStates = {
      [VehicleDamagePart.HULL]: this.createPart(PART_HEALTH_FACTORS[VehicleDamagePart.HULL]),
      [VehicleDamagePart.TRACKS]: this.createPart(PART_HEALTH_FACTORS[VehicleDamagePart.TRACKS]),
      [VehicleDamagePart.TURRET]: this.createPart(PART_HEALTH_FACTORS[VehicleDamagePart.TURRET]),
      [VehicleDamagePart.ENGINE]: this.createPart(PART_HEALTH_FACTORS[VehicleDamagePart.ENGINE]),
    };

    // 座位槽：司机 + 乘客（武器装载载具的第二座位为炮手）
    this.seats = Array.from({ length: Math.max(1, this.config.seats) }, () => null);
    this.seatLabels = ['驾驶员'];
    for (let i = 1; i < this.seats.length; i++) {
      // 阶段 10+ 扩展：武器装载载具（坦克/吉普）第二座位命名炮手
      this.seatLabels.push(this.config.weaponMount && i === 1 ? '炮手' : `乘员${i}`);
    }

    this.mesh = this.createVehicleMesh();
    this.mesh.position.copy(position);
    this.spawnPosition = position.clone();
    this.spawnRotationY = 0;
    scene.add(this.mesh);
  }

  private createPart(factor: number): VehiclePartState {
    return { health: this.config.health * factor, maxHealth: this.config.health * factor, destroyed: false };
  }

  private createVehicleMesh(): THREE.Group {
    const group = new THREE.Group();

    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: 0x4a5a3a,
      roughness: 0.7,
      metalness: 0.3,
    });

    const bodyGeometry = new THREE.BoxGeometry(
      this.config.dimensions.width,
      this.config.dimensions.height,
      this.config.dimensions.length
    );
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.position.y = this.config.dimensions.height / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    const wheelGeometry = new THREE.CylinderGeometry(0.4, 0.4, 0.3, 16);
    const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 });

    const wheelPositions = [
      { x: -this.config.dimensions.width / 2, z: -this.config.dimensions.length / 3 },
      { x: this.config.dimensions.width / 2, z: -this.config.dimensions.length / 3 },
      { x: -this.config.dimensions.width / 2, z: this.config.dimensions.length / 3 },
      { x: this.config.dimensions.width / 2, z: this.config.dimensions.length / 3 },
    ];

    for (const pos of wheelPositions) {
      const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(pos.x, 0.4, pos.z);
      wheel.castShadow = true;
      group.add(wheel);
    }

    if (this.config.weaponMount) {
      // 炮塔组：旋转该组即可联动炮管
      const turretGroup = new THREE.Group();
      const turretGeometry = new THREE.CylinderGeometry(0.3, 0.3, 0.5, 16);
      const turretMaterial = new THREE.MeshStandardMaterial({ color: 0x3a4a2a });
      const turret = new THREE.Mesh(turretGeometry, turretMaterial);
      turret.position.y = this.config.dimensions.height + 0.25;
      turretGroup.add(turret);

      const barrelGeometry = new THREE.CylinderGeometry(0.1, 0.1, 2, 8);
      const barrelMaterial = new THREE.MeshStandardMaterial({ color: 0x2a2a2a });
      const barrel = new THREE.Mesh(barrelGeometry, barrelMaterial);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, this.config.dimensions.height + 0.25, 1);
      turretGroup.add(barrel);

      group.add(turretGroup);
      this.turretGroup = turretGroup;
      this.weapon = barrel;
    }

    return group;
  }

  createPhysicsBody(world: RAPIER.World): void {
    this.world = world;
    const bodyDesc = this.rapier.RigidBodyDesc.dynamic()
      .setTranslation(this.mesh.position.x, this.mesh.position.y, this.mesh.position.z)
      .setLinearDamping(0.5)
      .setAngularDamping(0.5);

    this.body = world.createRigidBody(bodyDesc);

    const colliderDesc = this.rapier.ColliderDesc.cuboid(
      this.config.dimensions.width / 2,
      this.config.dimensions.height / 2,
      this.config.dimensions.length / 2
    )
      .setFriction(0.5)
      .setRestitution(0.1);

    this.collider = world.createCollider(colliderDesc, this.body);
  }

  private world: RAPIER.World | null = null;
  weapon: THREE.Mesh | null = null;

  /** 向下射线探测地面高度（排除自身碰撞体） */
  private raycastGround(x: number, y: number, z: number, maxDistance = 6): GroundProbeResult {
    if (!this.world) return { hit: false, groundY: y - 0.5 };
    const ray = new this.rapier.Ray(new this.rapier.Vector3(x, y + 0.5, z), new this.rapier.Vector3(0, -1, 0));
    const hit = this.world.castRay(ray, maxDistance, true, undefined, undefined, this.collider ?? undefined, this.body ?? undefined);
    if (!hit) return { hit: false, groundY: y - 0.5 };
    return { hit: true, groundY: y + 0.5 - hit.timeOfImpact };
  }

  private getForward(): THREE.Vector3 {
    return new THREE.Vector3(0, 0, -1).applyQuaternion(this.mesh.quaternion);
  }

  update(deltaTime: number, nowMs: number): void {
    if (!this.body) return;
    if (this.destroyed) return;

    // ===== 运动学地面控制（阶段 7 P0）：防穿地 / 防翻车 / 横向钳制 =====
    const pos = this.body.translation();
    const probe = this.raycastGround(pos.x, pos.y, pos.z);
    if (probe.hit) {
      const targetY = probe.groundY + 0.35;
      if (pos.y < targetY - 0.02) {
        this.body.setTranslation(new this.rapier.Vector3(pos.x, targetY, pos.z), true);
      }
      const vel = this.body.linvel();
      if (vel.y < -0.5) {
        this.body.setLinvel(new this.rapier.Vector3(vel.x, 0, vel.z), true);
      }
    }

    // 防翻车：车身倾斜过大时回正（只保留 yaw），同时清零俯仰/横滚角速度
    const rot = this.body.rotation();
    const q = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);
    const euler = new THREE.Euler().setFromQuaternion(q);
    if (Math.abs(euler.x) > 0.35 || Math.abs(euler.z) > 0.35) {
      const yawOnly = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), euler.y);
      this.body.setRotation(new this.rapier.Quaternion(yawOnly.x, yawOnly.y, yawOnly.z, yawOnly.w), true);
      const ang = this.body.angvel();
      this.body.setAngvel(new this.rapier.Vector3(0, ang.y, 0), true);
    }

    // 横向速度钳制：把速度分解为前向/横向，横向强阻尼
    const forward = this.getForward();
    forward.y = 0;
    if (forward.lengthSq() > 0.0001) forward.normalize();
    const vel2 = this.body.linvel();
    const v = new THREE.Vector3(vel2.x, vel2.y, vel2.z);
    const forwardSpeed = v.dot(forward);
    const lateral = v.clone().addScaledVector(forward, -forwardSpeed);
    if (lateral.lengthSq() > 1) {
      const damped = v.addScaledVector(lateral, -0.08);
      this.body.setLinvel(new this.rapier.Vector3(damped.x, damped.y, damped.z), true);
    }

    // 同步 mesh
    const p2 = this.body.translation();
    const r2 = this.body.rotation();
    this.mesh.position.set(p2.x, p2.y, p2.z);
    this.mesh.rotation.set(r2.x, r2.y, r2.z);

    const velocity = this.body.linvel();
    this.currentSpeed = Math.sqrt(velocity.x ** 2 + velocity.z ** 2);

    // 炮塔平滑旋转
    if (this.turretGroup) {
      this.turretYaw += (this.turretTargetYaw - this.turretYaw) * Math.min(1, deltaTime * 4);
      this.turretGroup.rotation.y = this.turretYaw;
    }

    // 自动维修 + 弹药缓慢补充（简化维修闭环）
    if (nowMs - this.lastDamageTime > 5000) {
      if (this.health < this.config.health) {
        this.health = Math.min(this.config.health, this.health + 1.5 * deltaTime);
      }
      if (this.ammo < this.config.ammo) {
        this.ammo = Math.min(this.config.ammo, this.ammo + 0.8 * deltaTime);
      }
    }
  }

  /** 驱动：前向力 + 转向扭矩（受部位损坏影响） */
  drive(forward: number, turn: number, deltaTime: number): void {
    if (!this.body || this.destroyed) return;

    const forwardVec = this.getForward();
    forwardVec.y = 0;
    if (forwardVec.lengthSq() > 0.0001) forwardVec.normalize();

    const vel = this.body.linvel();
    const v = new THREE.Vector3(vel.x, vel.y, vel.z);
    const forwardSpeed = v.dot(forwardVec);

    if (Math.abs(forwardSpeed) < this.currentMaxSpeed) {
      const force = forward * this.config.acceleration * this.config.mass * Math.min(1, deltaTime * 2);
      this.body.applyImpulse(
        new this.rapier.Vector3(forwardVec.x * force, 0, forwardVec.z * force),
        true,
      );
    }

    if (Math.abs(turn) > 0.1) {
      const torque = turn * this.currentTurnSpeed * this.config.mass * Math.min(1, deltaTime * 2);
      this.body.applyTorqueImpulse(new this.rapier.Vector3(0, torque, 0), true);
    }
  }

  /** 设置炮塔目标角度（相对车体前向），载具内瞄准用 */
  setTurretTargetYaw(worldYaw: number): void {
    if (!this.turretGroup) return;
    const bodyYaw = this.mesh.rotation.y;
    let relative = worldYaw - bodyYaw;
    // 归一化到 [-PI, PI]
    while (relative > Math.PI) relative -= Math.PI * 2;
    while (relative < -Math.PI) relative += Math.PI * 2;
    this.turretTargetYaw = relative;
  }

  /** 开火：返回弹道发射参数；弹药/装填/炮塔损坏时返回 null */
  fireWeapon(nowMs: number): VehicleShot | null {
    if (!this.weapon || !this.config.weaponMount || this.weaponDisabled) return null;
    if (nowMs - this.lastFireTime < this.config.fireIntervalMs) return null;
    if (this.ammo <= 0) return null;

    this.lastFireTime = nowMs;
    this.ammo = Math.max(0, this.ammo - 1);

    const muzzle = new THREE.Vector3();
    this.weapon.getWorldPosition(muzzle);

    let direction: THREE.Vector3;
    if (this.turretGroup) {
      const q = new THREE.Quaternion();
      this.turretGroup.getWorldQuaternion(q);
      direction = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    } else {
      direction = this.getForward();
    }
    direction.normalize();

    return {
      kind: this.config.weaponKind,
      origin: muzzle,
      direction,
      damage: this.config.weaponDamage,
      range: this.config.weaponRange,
      explosionRadius: this.config.explosionRadius,
      owner: this,
    };
  }

  // ===== 模块化伤害（阶段 7 P0） =====

  /** 根据命中点相对车体方位判定受击面 */
  private hitDirectionFrom(hitPointWorld: THREE.Vector3): VehicleHitDirection {
    const toHit = hitPointWorld.clone().sub(this.mesh.position);
    toHit.y = 0;
    const forward = this.getForward();
    forward.y = 0;
    if (toHit.lengthSq() < 0.001 || forward.lengthSq() < 0.001) return 'front';
    toHit.normalize();
    forward.normalize();
    const dot = toHit.dot(forward);
    if (dot > 0.5) return 'front';
    if (dot < -0.5) return 'rear';
    return 'side';
  }

  private resolvePart(hitPointWorld: THREE.Vector3 | undefined, direction: VehicleHitDirection): VehicleDamagePart {
    if (this.config.weaponMount && hitPointWorld) {
      // 高命中点 → 炮塔
      const localY = hitPointWorld.y - this.mesh.position.y;
      if (localY > this.config.dimensions.height * 0.65) return VehicleDamagePart.TURRET;
    }
    if (direction === 'front') return VehicleDamagePart.ENGINE;
    if (direction === 'side') return VehicleDamagePart.TRACKS;
    return VehicleDamagePart.HULL;
  }

  /** 部位失效效果：引擎减速、履带转向失灵、炮塔禁用武器 */
  private applyPartLoss(part: VehicleDamagePart): void {
    if (part === VehicleDamagePart.ENGINE) {
      this.currentMaxSpeed = this.config.maxSpeed * 0.4;
    } else if (part === VehicleDamagePart.TRACKS) {
      this.currentTurnSpeed = this.config.turnSpeed * 0.25;
    } else if (part === VehicleDamagePart.TURRET) {
      this.weaponDisabled = true;
    }
  }

  /**
   * 受击：装甲修正（正面 0.8 / 侧面 1.25 / 后部 1.6）× 基础装甲；
   * 伤害分配至部位；返回命中详情供 HUD/击杀反馈。
   */
  takeDamage(amount: number, hitPointWorld?: THREE.Vector3, nowMs?: number): VehicleHitResult {
    if (this.destroyed) {
      return { damage: 0, part: VehicleDamagePart.HULL, direction: 'front', killed: false };
    }
    if (nowMs !== undefined) this.lastDamageTime = nowMs;

    const direction = hitPointWorld ? this.hitDirectionFrom(hitPointWorld) : 'front';
    const armorMod = direction === 'rear' ? 1.6 : direction === 'side' ? 1.25 : 0.8;
    const actual = Math.max(1, amount * (1 - this.config.armor) * armorMod);

    const part = this.resolvePart(hitPointWorld, direction);
    const partState = this.partStates[part];
    if (!partState.destroyed) {
      partState.health -= actual;
      if (partState.health <= 0) {
        partState.destroyed = true;
        this.applyPartLoss(part);
      }
    }

    this.health -= actual;
    if (this.health <= 0) {
      this.health = 0;
      this.destroy();
      return { damage: actual, part, direction, killed: true };
    }
    return { damage: actual, part, direction, killed: false };
  }

  getPartStates(): Record<VehicleDamagePart, VehiclePartState> {
    return this.partStates;
  }

  // ===== 座位系统（阶段 7 P0） =====

  getSeats(): VehicleSeatInfo[] {
    return this.seats.map((occupant, index) => ({ index, label: this.seatLabels[index] ?? `座位${index}`, occupant }));
  }

  getSeatIndexOf(playerId: string): number {
    return this.seats.indexOf(playerId);
  }

  getSeatLabel(playerId: string): string {
    const index = this.getSeatIndexOf(playerId);
    return index >= 0 ? this.seatLabels[index] ?? `座位${index}` : '';
  }

  /** 上车：优先司机位，否则乘客位；满员返回 null */
  enterVehicle(playerId: string): 'driver' | 'passenger' | null {
    if (this.destroyed) return null;
    const existing = this.getSeatIndexOf(playerId);
    if (existing >= 0) return existing === 0 ? 'driver' : 'passenger';

    const driverIndex = this.seats.indexOf(null);
    if (driverIndex < 0) return null;
    this.seats[driverIndex] = playerId;
    this.isOccupied = true;
    return driverIndex === 0 ? 'driver' : 'passenger';
  }

  /** 座位切换：司机 → 空乘客位；乘客 → 司机位（司机位被占则互换） */
  switchSeat(playerId: string): boolean {
    if (this.destroyed) return false;
    const current = this.getSeatIndexOf(playerId);
    if (current < 0) return false;
    if (current === 0) {
      // 司机 → 找第一个空乘客位
      for (let i = 1; i < this.seats.length; i++) {
        if (this.seats[i] === null) {
          this.seats[i] = playerId;
          this.seats[0] = null;
          return true;
        }
      }
      return false;
    }
    // 乘客 → 司机：司机位空则直接坐，被占则互换
    if (this.seats[0] === null) {
      this.seats[0] = playerId;
      this.seats[current] = null;
    } else {
      const driver = this.seats[0]!;
      this.seats[0] = playerId;
      this.seats[current] = driver;
    }
    return true;
  }

  exitVehicle(playerId: string): void {
    const index = this.getSeatIndexOf(playerId);
    if (index >= 0) this.seats[index] = null;
    this.isOccupied = this.seats.some((s) => s !== null);
  }

  getOccupants(): string[] {
    return this.seats.filter((s): s is string => s !== null);
  }

  /** 载具被摧毁：禁用物理、隐藏、清空乘员（乘员逃生由接入层处理） */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.body) {
      this.body.setEnabled(false);
    }
    this.mesh.visible = false;
    this.seats = this.seats.map(() => null);
    this.isOccupied = false;
  }

  /** 重生：复位血量/部位/弹药/位置 */
  respawn(): void {
    this.destroyed = false;
    this.health = this.config.health;
    this.ammo = this.config.ammo;
    this.currentMaxSpeed = this.config.maxSpeed;
    this.currentTurnSpeed = this.config.turnSpeed;
    this.weaponDisabled = false;
    for (const part of Object.values(VehicleDamagePart)) {
      this.partStates[part] = this.createPart(PART_HEALTH_FACTORS[part]);
    }
    this.mesh.position.copy(this.spawnPosition);
    this.mesh.rotation.set(0, this.spawnRotationY, 0);
    this.mesh.visible = true;
    if (this.body) {
      this.body.setEnabled(true);
      this.body.setTranslation(
        new this.rapier.Vector3(this.spawnPosition.x, this.spawnPosition.y, this.spawnPosition.z),
        true,
      );
      this.body.setRotation(new this.rapier.Quaternion(0, 0, 0, 1), true);
      this.body.setLinvel(new this.rapier.Vector3(0, 0, 0), true);
      this.body.setAngvel(new this.rapier.Vector3(0, 0, 0), true);
    }
    this.turretYaw = 0;
    this.turretTargetYaw = 0;
  }

  getHealthPercentage(): number {
    return (this.health / this.config.health) * 100;
  }

  dispose(): void {
    if (this.mesh.parent) {
      this.mesh.parent.remove(this.mesh);
    }
    this.mesh.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    });
  }
}

export interface VehicleRespawnEntry {
  vehicle: Vehicle;
  /** 剩余重生秒数 */
  timer: number;
}

export class VehicleSystem {
  scene: THREE.Scene;
  vehicles: Vehicle[] = [];
  world: RAPIER.World;
  /** 摧毁后重生队列（阶段 7 P0） */
  private respawnQueue: VehicleRespawnEntry[] = [];
  /** 重生延迟秒数 */
  respawnDelaySeconds = 15;
  /** 载具补给站（阶段 7 P1） */
  private supplyStations: SupplyStation[] = [];
  private nextStationId = 1;

  constructor(scene: THREE.Scene, world: RAPIER.World) {
    this.scene = scene;
    this.world = world;
  }

  spawnVehicle(type: VehicleType, position: THREE.Vector3, team: TeamId = TeamId.NEUTRAL): Vehicle {
    const vehicle = new Vehicle(this.scene, type, position, team);
    vehicle.createPhysicsBody(this.world);
    this.vehicles.push(vehicle);
    return vehicle;
  }

  /** 添加载具补给站：同阵营载具进入半径后快速维修 + 弹药补充 */
  addSupplyStation(position: THREE.Vector3, radius: number, team: TeamId): SupplyStation {
    const station: SupplyStation = { id: this.nextStationId++, position: position.clone(), radius, team };
    this.supplyStations.push(station);
    return station;
  }

  getSupplyStations(): readonly SupplyStation[] {
    return this.supplyStations;
  }

  /** 载具是否处于补给站生效范围（同阵营 + 半径内） */
  isVehicleInSupplyZone(vehicle: Vehicle): boolean {
    if (vehicle.destroyed) return false;
    for (const station of this.supplyStations) {
      if (station.team !== TeamId.NEUTRAL && station.team !== vehicle.team) continue;
      if (vehicle.mesh.position.distanceTo(station.position) <= station.radius) return true;
    }
    return false;
  }

  private updateSupplyStations(deltaTime: number): void {
    for (const vehicle of this.vehicles) {
      if (vehicle.destroyed) continue;
      for (const station of this.supplyStations) {
        if (station.team !== TeamId.NEUTRAL && station.team !== vehicle.team) continue;
        if (vehicle.mesh.position.distanceTo(station.position) > station.radius) continue;
        // 快速维修：80 HP/s（远高于 5 秒未受击的 1.5 HP/s 自动维修）
        if (vehicle.health < vehicle.config.health) {
          vehicle.health = Math.min(vehicle.config.health, vehicle.health + 80 * deltaTime);
        }
        // 弹药补充：停车时 30 发/s，移动中 5 发/s
        const ammoRate = vehicle.currentSpeed < 1 ? 30 : 5;
        if (vehicle.ammo < vehicle.config.ammo) {
          vehicle.ammo = Math.min(vehicle.config.ammo, vehicle.ammo + ammoRate * deltaTime);
        }
        break;
      }
    }
  }

  update(deltaTime: number, nowMs: number): void {
    for (const vehicle of this.vehicles) {
      vehicle.update(deltaTime, nowMs);
    }
    this.updateSupplyStations(deltaTime);
    this.updateRespawns(deltaTime);
  }

  private updateRespawns(deltaTime: number): void {
    for (let i = this.respawnQueue.length - 1; i >= 0; i--) {
      const entry = this.respawnQueue[i];
      entry.timer -= deltaTime;
      if (entry.timer <= 0) {
        entry.vehicle.respawn();
        this.respawnQueue.splice(i, 1);
      }
    }
  }

  /** 载具被摧毁后登记重生 */
  scheduleRespawn(vehicle: Vehicle): void {
    if (this.respawnQueue.some((e) => e.vehicle === vehicle)) return;
    this.respawnQueue.push({ vehicle, timer: this.respawnDelaySeconds });
  }

  getRespawnQueue(): readonly VehicleRespawnEntry[] {
    return this.respawnQueue;
  }

  getVehicles(): Vehicle[] {
    return this.vehicles;
  }

  getVehicleById(playerId: string): Vehicle | null {
    for (const vehicle of this.vehicles) {
      if (vehicle.getSeatIndexOf(playerId) >= 0) {
        return vehicle;
      }
    }
    return null;
  }

  /** 车辆是否可被命中（未摧毁） */
  isHittable(vehicle: Vehicle): boolean {
    return !vehicle.destroyed;
  }

  removeVehicle(vehicle: Vehicle): void {
    const index = this.vehicles.indexOf(vehicle);
    if (index >= 0) {
      vehicle.dispose();
      this.vehicles.splice(index, 1);
    }
  }

  dispose(): void {
    for (const vehicle of this.vehicles) {
      vehicle.dispose();
    }
    this.vehicles = [];
    this.respawnQueue = [];
  }
}
