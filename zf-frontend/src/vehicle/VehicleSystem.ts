import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

export enum VehicleType {
  JEEP = 'jeep',
  TANK = 'tank',
  TRUCK = 'truck',
  MOTORCYCLE = 'motorcycle',
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
    mass: 200,
    dimensions: { width: 0.8, height: 1.2, length: 2 },
  },
};

export class Vehicle {
  config: VehicleConfig;
  mesh: THREE.Group;
  body: RAPIER.RigidBody | null = null;
  collider: RAPIER.Collider | null = null;
  health: number;
  currentSpeed: number = 0;
  currentTurn: number = 0;
  isOccupied: boolean = false;
  driver: string | null = null;
  passengers: string[] = [];
  weapon: THREE.Mesh | null = null;
  turretRotation: number = 0;
  lastFireTime: number = 0;

  constructor(scene: THREE.Scene, type: VehicleType, position: THREE.Vector3) {
    this.config = VEHICLE_CONFIGS[type];
    this.health = this.config.health;
    this.mesh = this.createVehicleMesh();
    this.mesh.position.copy(position);
    scene.add(this.mesh);
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
      const turretGeometry = new THREE.CylinderGeometry(0.3, 0.3, 0.5, 16);
      const turretMaterial = new THREE.MeshStandardMaterial({ color: 0x3a4a2a });
      const turret = new THREE.Mesh(turretGeometry, turretMaterial);
      turret.position.y = this.config.dimensions.height + 0.25;
      group.add(turret);

      const barrelGeometry = new THREE.CylinderGeometry(0.1, 0.1, 2, 8);
      const barrelMaterial = new THREE.MeshStandardMaterial({ color: 0x2a2a2a });
      const barrel = new THREE.Mesh(barrelGeometry, barrelMaterial);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, this.config.dimensions.height + 0.25, 1);
      group.add(barrel);

      this.weapon = barrel;
    }

    return group;
  }

  createPhysicsBody(world: RAPIER.World): void {
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(this.mesh.position.x, this.mesh.position.y, this.mesh.position.z)
      .setLinearDamping(0.5)
      .setAngularDamping(0.5);

    this.body = world.createRigidBody(bodyDesc);

    const colliderDesc = RAPIER.ColliderDesc.cuboid(
      this.config.dimensions.width / 2,
      this.config.dimensions.height / 2,
      this.config.dimensions.length / 2
    )
      .setFriction(0.5)
      .setRestitution(0.1);

    this.collider = world.createCollider(colliderDesc, this.body);
  }

  update(_deltaTime: number): void {
    if (!this.body) return;

    const pos = this.body.translation();
    const rot = this.body.rotation();

    this.mesh.position.set(pos.x, pos.y, pos.z);
    this.mesh.rotation.set(rot.x, rot.y, rot.z);

    const velocity = this.body.linvel();
    this.currentSpeed = Math.sqrt(velocity.x ** 2 + velocity.z ** 2);
  }

  drive(forward: number, turn: number): void {
    if (!this.body) return;

    const speed = this.currentSpeed;
    const maxSpeed = this.config.maxSpeed;

    if (Math.abs(speed) < maxSpeed) {
      const force = forward * this.config.acceleration * this.config.mass;
      const direction = new THREE.Vector3(0, 0, -1).applyEuler(this.mesh.rotation);
      this.body.applyImpulse(new RAPIER.Vector3(
        direction.x * force,
        0,
        direction.z * force
      ), true);
    }

    if (Math.abs(turn) > 0.1) {
      const torque = turn * this.config.turnSpeed * this.config.mass;
      this.body.applyTorqueImpulse(new RAPIER.Vector3(0, torque, 0), true);
    }
  }

  fireWeapon(): void {
    if (!this.weapon || !this.config.weaponMount) return;

    const now = Date.now();
    if (now - this.lastFireTime < 500) return;
    this.lastFireTime = now;

    const muzzleFlash = new THREE.PointLight(0xffaa00, 5, 10);
    muzzleFlash.position.copy(this.weapon.position);
    muzzleFlash.position.z += 1;
    this.mesh.add(muzzleFlash);

    setTimeout(() => {
      this.mesh.remove(muzzleFlash);
    }, 50);
  }

  takeDamage(amount: number): boolean {
    const actualDamage = amount * (1 - this.config.armor);
    this.health -= actualDamage;

    if (this.health <= 0) {
      this.destroy();
      return true;
    }
    return false;
  }

  destroy(): void {
    if (this.body) {
      this.body.setEnabled(false);
    }

    this.mesh.visible = false;
    this.isOccupied = false;
    this.driver = null;
    this.passengers = [];
  }

  enterVehicle(playerId: string, isDriver: boolean): boolean {
    if (this.isOccupied && isDriver) return false;

    if (isDriver) {
      this.driver = playerId;
      this.isOccupied = true;
    } else {
      if (this.passengers.length >= this.config.seats - 1) return false;
      this.passengers.push(playerId);
    }

    return true;
  }

  exitVehicle(playerId: string): void {
    if (this.driver === playerId) {
      this.driver = null;
      this.isOccupied = false;
    } else {
      this.passengers = this.passengers.filter(p => p !== playerId);
    }
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
          child.material.forEach(m => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    });
  }
}

export class VehicleSystem {
  scene: THREE.Scene;
  vehicles: Vehicle[] = [];
  world: RAPIER.World;

  constructor(scene: THREE.Scene, world: RAPIER.World) {
    this.scene = scene;
    this.world = world;
  }

  spawnVehicle(type: VehicleType, position: THREE.Vector3): Vehicle {
    const vehicle = new Vehicle(this.scene, type, position);
    vehicle.createPhysicsBody(this.world);
    this.vehicles.push(vehicle);
    return vehicle;
  }

  update(deltaTime: number): void {
    for (const vehicle of this.vehicles) {
      vehicle.update(deltaTime);
    }
  }

  getVehicles(): Vehicle[] {
    return this.vehicles;
  }

  getVehicleById(playerId: string): Vehicle | null {
    for (const vehicle of this.vehicles) {
      if (vehicle.driver === playerId || vehicle.passengers.includes(playerId)) {
        return vehicle;
      }
    }
    return null;
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
  }
}
