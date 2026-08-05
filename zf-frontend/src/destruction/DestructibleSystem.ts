import * as THREE from 'three';
import { DESTRUCTIBLE_KIND_CONFIGS } from '../../shared/protocol';

/**
 * 局部破坏系统（阶段 7 P0，阶段 8 接入服务端权威状态）。
 * 采用“预切片/状态切换”，不做任意体素破坏：
 * - 完整对象（intact）参与碰撞与 AI 视线遮挡；被摧毁后隐藏并移出遮挡列表；
 * - 碎片（broken）仅客户端表现，不进入长期同步；
 * - 破坏状态使用稳定对象 ID + bitset 表达，`getStateBitset` / `applyStateBitset`
 *   供网络同步使用（联网模式：服务端 destructible_state 广播驱动，只破坏不回滚；
 *   新回合经 `reset` 恢复完整）。
 * - 类型/血量/尺寸配置来自 shared `DESTRUCTIBLE_KIND_CONFIGS`（服务端裁决同源，防漂移）。
 */
export enum DestructibleKind {
  DOOR = 'door',
  SANDBAG = 'sandbag',
  FENCE = 'fence',
  COVER = 'cover',
}

export interface DestructibleConfig {
  kind: DestructibleKind;
  name: string;
  health: number;
  /** 近似碰撞盒尺寸（m），供破坏判定与碎片生成使用 */
  dimensions: { width: number; height: number; depth: number };
}

/** 破坏物配置（shared 同源：服务端裁决血量/挡弹尺寸与客户端渲染共用） */
export const DESTRUCTIBLE_CONFIGS: Record<DestructibleKind, DestructibleConfig> = DESTRUCTIBLE_KIND_CONFIGS as unknown as Record<DestructibleKind, DestructibleConfig>;
/** 每类对象点位布局（服务端权威同源，联网场景破坏物与裁决对象一一对应） */
export { DESTRUCTIBLE_SPAWN_DEFS } from '../../shared/protocol';

/** 每类对象的颜色基线（沙袋/木料/混凝土） */
const KIND_COLORS: Record<DestructibleKind, number> = {
  [DestructibleKind.DOOR]: 0x8a6a4a,
  [DestructibleKind.SANDBAG]: 0x9a8f70,
  [DestructibleKind.FENCE]: 0x7a5a3a,
  [DestructibleKind.COVER]: 0x6a6a6a,
};

export interface DestructibleObject {
  id: number;
  kind: DestructibleKind;
  config: DestructibleConfig;
  /** 完整对象（参与碰撞/AI 视线） */
  mesh: THREE.Group;
  /** 破坏后展示的预切片碎片（仅表现） */
  brokenGroup: THREE.Group;
  health: number;
  destroyed: boolean;
  position: THREE.Vector3;
}

interface Debris {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  angular: THREE.Vector3;
  life: number;
  maxLife: number;
}

export class DestructibleSystem {
  private objects: DestructibleObject[] = [];
  private debris: Debris[] = [];
  private nextId = 1;
  /** 破坏发生时回调（接入层用于移除碰撞/视线引用） */
  onDestroy?: (obj: DestructibleObject) => void;

  constructor(private readonly scene: THREE.Scene) {}

  create(kind: DestructibleKind, position: THREE.Vector3, rotationY = 0): DestructibleObject {
    const config = DESTRUCTIBLE_CONFIGS[kind];
    const mesh = this.createIntactMesh(config, position, rotationY);
    const brokenGroup = this.createBrokenGroup(config, position, rotationY);
    brokenGroup.visible = false;
    this.scene.add(mesh);
    this.scene.add(brokenGroup);

    const obj: DestructibleObject = {
      id: this.nextId++,
      kind,
      config,
      mesh,
      brokenGroup,
      health: config.health,
      destroyed: false,
      position: position.clone(),
    };
    // 命中检测用：射线命中子网格后沿父链读取 id
    mesh.userData.destructibleId = obj.id;
    this.objects.push(obj);
    return obj;
  }

  /** 受击：返回是否因此被摧毁 */
  damage(id: number, amount: number, _hitPoint?: THREE.Vector3): boolean {
    const obj = this.objects.find((o) => o.id === id);
    if (!obj || obj.destroyed) return false;
    obj.health -= amount;
    if (obj.health <= 0) {
      this.destroy(id);
      return true;
    }
    return false;
  }

  /** 摧毁：隐藏完整对象、展示碎片、触发回调（移出碰撞/视线） */
  destroy(id: number): void {
    const obj = this.objects.find((o) => o.id === id);
    if (!obj || obj.destroyed) return;
    obj.destroyed = true;
    obj.mesh.visible = false;
    obj.brokenGroup.visible = true;
    this.spawnDebris(obj);
    this.onDestroy?.(obj);
  }

  /** 破坏状态 → 二进制串（1=已破坏），用于网络同步/存档 */
  getStateBitset(): string {
    let bits = '';
    for (const obj of this.objects) bits += obj.destroyed ? '1' : '0';
    return bits;
  }

  /** 从二进制串恢复破坏状态（只破坏，不回滚） */
  applyStateBitset(bits: string): void {
    for (let i = 0; i < this.objects.length; i++) {
      if (bits[i] === '1' && !this.objects[i].destroyed) {
        this.destroy(this.objects[i].id);
      }
    }
  }

  /** 回合重置：全部恢复完整（联网新回合开始时调用，清除碎片表现） */
  reset(): void {
    for (const obj of this.objects) {
      obj.destroyed = false;
      obj.health = obj.config.health;
      obj.mesh.visible = true;
      obj.brokenGroup.visible = false;
    }
    for (const d of this.debris) {
      this.scene.remove(d.mesh);
      d.mesh.geometry.dispose();
      (d.mesh.material as THREE.Material).dispose();
    }
    this.debris = [];
  }

  getById(id: number): DestructibleObject | null {
    return this.objects.find((o) => o.id === id) ?? null;
  }

  getAll(): readonly DestructibleObject[] {
    return this.objects;
  }

  getDestroyedCount(): number {
    return this.objects.filter((o) => o.destroyed).length;
  }

  /** 碎片飞散动画（客户端表现） */
  update(deltaTime: number): void {
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.life += deltaTime;
      d.velocity.y -= 9.8 * deltaTime;
      d.mesh.position.addScaledVector(d.velocity, deltaTime);
      d.mesh.rotation.x += d.angular.x * deltaTime;
      d.mesh.rotation.y += d.angular.y * deltaTime;
      d.mesh.rotation.z += d.angular.z * deltaTime;
      if (d.life >= d.maxLife) {
        this.scene.remove(d.mesh);
        d.mesh.geometry.dispose();
        (d.mesh.material as THREE.Material).dispose();
        this.debris.splice(i, 1);
      }
    }
  }

  dispose(): void {
    for (const obj of this.objects) {
      this.scene.remove(obj.mesh);
      this.scene.remove(obj.brokenGroup);
      obj.mesh.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          (child.material as THREE.Material).dispose();
        }
      });
      obj.brokenGroup.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          (child.material as THREE.Material).dispose();
        }
      });
    }
    for (const d of this.debris) {
      this.scene.remove(d.mesh);
    }
    this.objects = [];
    this.debris = [];
  }

  // ===== 预切片网格 =====

  private createIntactMesh(config: DestructibleConfig, position: THREE.Vector3, rotationY: number): THREE.Group {
    const group = new THREE.Group();
    const { width, height, depth } = config.dimensions;
    const geometry = new THREE.BoxGeometry(width, height, depth);
    const material = new THREE.MeshStandardMaterial({
      color: KIND_COLORS[config.kind],
      roughness: 0.85,
      metalness: 0.05,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = height / 2;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    group.position.copy(position);
    group.rotation.y = rotationY;
    return group;
  }

  private createBrokenGroup(config: DestructibleConfig, position: THREE.Vector3, rotationY: number): THREE.Group {
    const group = new THREE.Group();
    const { width, height, depth } = config.dimensions;
    // 预切片：碎成若干小块，初始与完整对象重合
    const pieces = config.kind === DestructibleKind.SANDBAG ? 6 : 5;
    const color = KIND_COLORS[config.kind];
    for (let i = 0; i < pieces; i++) {
      const pw = Math.max(0.15, width * (0.3 + ((i * 37) % 40) / 100));
      const ph = Math.max(0.12, height * (0.3 + ((i * 53) % 35) / 100));
      const pd = Math.max(0.1, depth * (0.4 + ((i * 29) % 30) / 100));
      const geometry = new THREE.BoxGeometry(pw, ph, pd);
      const material = new THREE.MeshStandardMaterial({
        color: color * (0.85 + ((i * 13) % 30) / 200),
        roughness: 0.9,
        metalness: 0.05,
      });
      const piece = new THREE.Mesh(geometry, material);
      piece.position.set(
        (i % 2 === 0 ? 1 : -1) * width * 0.18,
        ph / 2 + ((i * 11) % 5) * 0.08,
        ((i % 3) - 1) * depth * 0.2,
      );
      group.add(piece);
    }
    group.position.copy(position);
    group.rotation.y = rotationY;
    return group;
  }

  /** 生成飞散碎片（一次性表现，不参与碰撞） */
  private spawnDebris(obj: DestructibleObject): void {
    const { height } = obj.config.dimensions;
    const color = KIND_COLORS[obj.kind];
    const count = obj.config.kind === DestructibleKind.SANDBAG ? 8 : 6;
    for (let i = 0; i < count; i++) {
      const size = 0.12 + ((i * 17) % 20) / 100 * 0.25;
      const geometry = new THREE.BoxGeometry(size, size, size);
      const material = new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(obj.position);
      mesh.position.y += height * 0.5;
      this.scene.add(mesh);
      this.debris.push({
        mesh,
        velocity: new THREE.Vector3(
          (Math.random() - 0.5) * 6,
          3 + Math.random() * 4,
          (Math.random() - 0.5) * 6,
        ),
        angular: new THREE.Vector3(
          (Math.random() - 0.5) * 12,
          (Math.random() - 0.5) * 12,
          (Math.random() - 0.5) * 12,
        ),
        life: 0,
        maxLife: 0.9 + Math.random() * 0.5,
      });
    }
  }
}
