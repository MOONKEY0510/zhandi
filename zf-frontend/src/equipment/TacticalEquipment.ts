import * as THREE from 'three';

export enum EquipmentType {
  SMOKE_GRENADE = 'smoke_grenade',
  FLASHBANG = 'flashbang',
  FRAG_GRENADE = 'frag_grenade',
  MOLOTOV = 'molotov',
  DECOY = 'decoy',
}

export interface EquipmentConfig {
  type: EquipmentType;
  name: string;
  maxCount: number;
  fuseTime: number;
  effectDuration: number;
  radius: number;
  damage: number;
  throwSpeed: number;
  throwArc: number;
}

export const EQUIPMENT_CONFIGS: Record<EquipmentType, EquipmentConfig> = {
  [EquipmentType.SMOKE_GRENADE]: {
    type: EquipmentType.SMOKE_GRENADE,
    name: '烟雾弹',
    maxCount: 2,
    fuseTime: 2,
    effectDuration: 20,
    radius: 8,
    damage: 0,
    throwSpeed: 15,
    throwArc: 0.3,
  },
  [EquipmentType.FLASHBANG]: {
    type: EquipmentType.FLASHBANG,
    name: '闪光弹',
    maxCount: 2,
    fuseTime: 1.5,
    effectDuration: 3,
    radius: 10,
    damage: 0,
    throwSpeed: 20,
    throwArc: 0.2,
  },
  [EquipmentType.FRAG_GRENADE]: {
    type: EquipmentType.FRAG_GRENADE,
    name: '破片手雷',
    maxCount: 1,
    fuseTime: 3,
    effectDuration: 0,
    radius: 6,
    damage: 100,
    throwSpeed: 18,
    throwArc: 0.4,
  },
  [EquipmentType.MOLOTOV]: {
    type: EquipmentType.MOLOTOV,
    name: '燃烧瓶',
    maxCount: 1,
    fuseTime: 0,
    effectDuration: 8,
    radius: 4,
    damage: 30,
    throwSpeed: 12,
    throwArc: 0.5,
  },
  [EquipmentType.DECOY]: {
    type: EquipmentType.DECOY,
    name: '诱饵弹',
    maxCount: 1,
    fuseTime: 1,
    effectDuration: 15,
    radius: 5,
    damage: 0,
    throwSpeed: 15,
    throwArc: 0.3,
  },
};

export class Equipment {
  config: EquipmentConfig;
  count: number;
  mesh: THREE.Mesh | null = null;
  isActive: boolean = false;
  activationTime: number = 0;
  position: THREE.Vector3 = new THREE.Vector3();
  velocity: THREE.Vector3 = new THREE.Vector3();
  particles: THREE.Points | null = null;

  constructor(type: EquipmentType) {
    this.config = EQUIPMENT_CONFIGS[type];
    this.count = this.config.maxCount;
  }

  throw(position: THREE.Vector3, direction: THREE.Vector3, scene: THREE.Scene, currentTime: number): void {
    if (this.count <= 0) return;

    this.count--;
    this.position.copy(position);
    this.velocity.copy(direction).multiplyScalar(this.config.throwSpeed);
    this.velocity.y += this.config.throwArc * this.config.throwSpeed;
    this.isActive = true;
    this.activationTime = currentTime;

    this.createMesh();
    if (this.mesh) {
      scene.add(this.mesh);
    }
  }

  private createMesh(): void {
    const geometry = new THREE.SphereGeometry(0.1, 8, 8);
    const material = new THREE.MeshStandardMaterial({
      color: this.getEquipmentColor(),
      roughness: 0.7,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.copy(this.position);
  }

  private getEquipmentColor(): number {
    switch (this.config.type) {
      case EquipmentType.SMOKE_GRENADE:
        return 0x888888;
      case EquipmentType.FLASHBANG:
        return 0xffffff;
      case EquipmentType.FRAG_GRENADE:
        return 0x444444;
      case EquipmentType.MOLOTOV:
        return 0xff4400;
      case EquipmentType.DECOY:
        return 0x4444ff;
      default:
        return 0x888888;
    }
  }

  update(deltaTime: number, scene: THREE.Scene, currentTime: number): boolean {
    if (!this.isActive) return false;

    const elapsed = (currentTime - this.activationTime) / 1000;

    if (elapsed < this.config.fuseTime) {
      this.velocity.y -= 9.81 * deltaTime;
      this.position.add(this.velocity.clone().multiplyScalar(deltaTime));

      if (this.mesh) {
        this.mesh.position.copy(this.position);
        this.mesh.rotation.x += deltaTime * 5;
        this.mesh.rotation.z += deltaTime * 3;
      }
      return true;
    }

    this.activateEffect(scene);

    if (elapsed >= this.config.fuseTime + this.config.effectDuration) {
      this.isActive = false;
      this.cleanup(scene);
      return false;
    }

    return true;
  }

  private activateEffect(scene: THREE.Scene): void {
    if (this.particles) return;

    switch (this.config.type) {
      case EquipmentType.SMOKE_GRENADE:
        this.createSmokeEffect(scene);
        break;
      case EquipmentType.FLASHBANG:
        this.createFlashEffect(scene);
        break;
      case EquipmentType.FRAG_GRENADE:
        this.createExplosionEffect(scene);
        break;
      case EquipmentType.MOLOTOV:
        this.createFireEffect(scene);
        break;
      case EquipmentType.DECOY:
        this.createDecoyEffect(scene);
        break;
    }
  }

  private createSmokeEffect(scene: THREE.Scene): void {
    const particleCount = 1000;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount; i++) {
      const i3 = i * 3;
      positions[i3] = this.position.x + (Math.random() - 0.5) * this.config.radius;
      positions[i3 + 1] = this.position.y + Math.random() * this.config.radius;
      positions[i3 + 2] = this.position.z + (Math.random() - 0.5) * this.config.radius;

      colors[i3] = 0.8;
      colors[i3 + 1] = 0.8;
      colors[i3 + 2] = 0.8;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: 0.5,
      vertexColors: true,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
    });

    this.particles = new THREE.Points(geometry, material);
    scene.add(this.particles);
  }

  private createFlashEffect(scene: THREE.Scene): void {
    const light = new THREE.PointLight(0xffffff, 10, this.config.radius * 2);
    light.position.copy(this.position);
    scene.add(light);

    setTimeout(() => {
      scene.remove(light);
    }, 100);
  }

  private createExplosionEffect(scene: THREE.Scene): void {
    const particleCount = 500;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const velocities: THREE.Vector3[] = [];

    for (let i = 0; i < particleCount; i++) {
      const i3 = i * 3;
      positions[i3] = this.position.x;
      positions[i3 + 1] = this.position.y;
      positions[i3 + 2] = this.position.z;

      velocities.push(new THREE.Vector3(
        (Math.random() - 0.5) * 10,
        Math.random() * 10,
        (Math.random() - 0.5) * 10
      ));
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
      size: 0.3,
      color: 0xff4400,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
    });

    this.particles = new THREE.Points(geometry, material);
    scene.add(this.particles);

    const light = new THREE.PointLight(0xff4400, 5, this.config.radius * 3);
    light.position.copy(this.position);
    scene.add(light);

    setTimeout(() => {
      scene.remove(light);
    }, 200);
  }

  private createFireEffect(scene: THREE.Scene): void {
    const particleCount = 300;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount; i++) {
      const i3 = i * 3;
      positions[i3] = this.position.x + (Math.random() - 0.5) * this.config.radius;
      positions[i3 + 1] = this.position.y + Math.random() * 2;
      positions[i3 + 2] = this.position.z + (Math.random() - 0.5) * this.config.radius;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
      size: 0.4,
      color: 0xff6600,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
    });

    this.particles = new THREE.Points(geometry, material);
    scene.add(this.particles);

    const light = new THREE.PointLight(0xff4400, 2, this.config.radius * 2);
    light.position.copy(this.position);
    scene.add(light);
  }

  private createDecoyEffect(scene: THREE.Scene): void {
    const light = new THREE.PointLight(0x4444ff, 3, this.config.radius);
    light.position.copy(this.position);
    scene.add(light);

    setTimeout(() => {
      scene.remove(light);
    }, this.config.effectDuration * 1000);
  }

  cleanup(scene: THREE.Scene): void {
    if (this.mesh) {
      scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      (this.mesh.material as THREE.Material).dispose();
      this.mesh = null;
    }

    if (this.particles) {
      scene.remove(this.particles);
      this.particles.geometry.dispose();
      (this.particles.material as THREE.Material).dispose();
      this.particles = null;
    }
  }

  getEffectRadius(): number {
    return this.config.radius;
  }

  getDamage(): number {
    return this.config.damage;
  }

  isInEffectArea(position: THREE.Vector3): boolean {
    return this.position.distanceTo(position) <= this.config.radius;
  }
}

export class EquipmentSystem {
  scene: THREE.Scene;
  activeEquipment: Equipment[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  throwEquipment(type: EquipmentType, position: THREE.Vector3, direction: THREE.Vector3, currentTime: number): Equipment | null {
    const equipment = new Equipment(type);
    if (equipment.count > 0) {
      equipment.throw(position, direction, this.scene, currentTime);
      this.activeEquipment.push(equipment);
      return equipment;
    }
    return null;
  }

  update(deltaTime: number, currentTime: number): void {
    this.activeEquipment = this.activeEquipment.filter(equipment => {
      return equipment.update(deltaTime, this.scene, currentTime);
    });
  }

  getActiveEquipment(): Equipment[] {
    return this.activeEquipment;
  }

  dispose(): void {
    for (const equipment of this.activeEquipment) {
      equipment.cleanup(this.scene);
    }
    this.activeEquipment = [];
  }
}
