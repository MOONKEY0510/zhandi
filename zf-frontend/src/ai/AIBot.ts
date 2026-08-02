import * as THREE from 'three';

export enum AIState {
  PATROL = 'patrol',
  CHASE = 'chase',
  ATTACK = 'attack',
  DEAD = 'dead',
}

export interface PatrolPoint {
  position: THREE.Vector3;
  waitTime: number;
}

export class AIBot {
  scene: THREE.Scene;
  mesh: THREE.Group;
  state: AIState = AIState.PATROL;
  health: number = 100;
  maxHealth: number = 100;
  moveSpeed: number = 3;
  attackRange: number = 30;
  detectionRange: number = 50;
  fireRate: number = 2;
  lastFireTime: number = 0;
  damage: number = 15;
  patrolPath: PatrolPoint[] = [];
  currentPatrolIndex: number = 0;
  target: THREE.Object3D | null = null;
  lastDamageTime: number = 0;
  ragdollVelocity: THREE.Vector3 = new THREE.Vector3();
  deathTime: number = 0;
  respawnTime: number = 10000;
  canRespawn: boolean = true;

  constructor(scene: THREE.Scene, position: THREE.Vector3) {
    this.scene = scene;
    this.mesh = this.createBotMesh();
    this.mesh.position.copy(position);
    scene.add(this.mesh);

    this.setupPatrolPath(position);
  }

  private createBotMesh(): THREE.Group {
    const group = new THREE.Group();

    const bodyGeometry = new THREE.CapsuleGeometry(0.4, 1.0, 4, 8);
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x5a5a5a });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.position.y = 0.85;
    body.castShadow = true;
    body.userData.bodyPart = 'torso';
    body.name = 'body';
    group.add(body);

    const headGeometry = new THREE.SphereGeometry(0.25, 8, 8);
    const headMaterial = new THREE.MeshStandardMaterial({ color: 0xd4a574 });
    const head = new THREE.Mesh(headGeometry, headMaterial);
    head.position.y = 1.6;
    head.castShadow = true;
    head.userData.bodyPart = 'head';
    head.name = 'head';
    group.add(head);

    const armGeometry = new THREE.CapsuleGeometry(0.1, 0.6, 4, 8);
    const armMaterial = new THREE.MeshStandardMaterial({ color: 0x5a5a5a });
    const leftArm = new THREE.Mesh(armGeometry, armMaterial);
    leftArm.position.set(-0.5, 0.9, 0);
    leftArm.userData.bodyPart = 'limb';
    leftArm.name = 'leftArm';
    group.add(leftArm);

    const rightArm = new THREE.Mesh(armGeometry, armMaterial);
    rightArm.position.set(0.5, 0.9, 0);
    rightArm.userData.bodyPart = 'limb';
    rightArm.name = 'rightArm';
    group.add(rightArm);

    const legGeometry = new THREE.CapsuleGeometry(0.12, 0.7, 4, 8);
    const legMaterial = new THREE.MeshStandardMaterial({ color: 0x2a2a2a });
    const leftLeg = new THREE.Mesh(legGeometry, legMaterial);
    leftLeg.position.set(-0.2, 0.35, 0);
    leftLeg.userData.bodyPart = 'limb';
    leftLeg.name = 'leftLeg';
    group.add(leftLeg);

    const rightLeg = new THREE.Mesh(legGeometry, legMaterial);
    rightLeg.position.set(0.2, 0.35, 0);
    rightLeg.userData.bodyPart = 'limb';
    rightLeg.name = 'rightLeg';
    group.add(rightLeg);

    return group;
  }

  private setupPatrolPath(centerPos: THREE.Vector3): void {
    const radius = 10;
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2;
      this.patrolPath.push({
        position: new THREE.Vector3(
          centerPos.x + Math.cos(angle) * radius,
          centerPos.y,
          centerPos.z + Math.sin(angle) * radius
        ),
        waitTime: 2,
      });
    }
  }

  takeDamage(amount: number, hitPoint: THREE.Vector3, currentTime: number): boolean {
    if (this.state === AIState.DEAD) return false;

    this.health = Math.max(0, this.health - amount);
    this.lastDamageTime = currentTime;

    if (this.health <= 0) {
      this.die(hitPoint, currentTime);
      return true;
    }

    if (this.target) {
      this.state = AIState.ATTACK;
    }
    return false;
  }

  private die(_hitPoint: THREE.Vector3, currentTime: number): void {
    this.state = AIState.DEAD;
    this.deathTime = currentTime;
    this.health = 0;

    const knockback = new THREE.Vector3(
      (Math.random() - 0.5) * 0.5,
      0.2,
      (Math.random() - 0.5) * 0.5
    );
    this.mesh.position.add(knockback);
    this.mesh.rotation.x = Math.PI / 2;
  }

  respawn(): void {
    this.state = AIState.PATROL;
    this.health = this.maxHealth;
    this.mesh.rotation.set(0, 0, 0);
    this.mesh.position.copy(this.patrolPath[0].position);
    this.currentPatrolIndex = 0;
  }

  setTarget(target: THREE.Object3D | null): void {
    this.target = target;
    if (target) {
      this.state = AIState.CHASE;
    }
  }

  update(deltaTime: number, currentTime: number, playerPosition: THREE.Vector3): void {
    if (this.state === AIState.DEAD) {
      if (this.canRespawn && currentTime - this.deathTime >= this.respawnTime) {
        this.respawn();
      }
      return;
    }

    const distanceToPlayer = this.mesh.position.distanceTo(playerPosition);

    if (this.target) {
      this.engageTarget(deltaTime, currentTime, distanceToPlayer);
    } else if (distanceToPlayer < this.detectionRange) {
      this.setTarget(this.scene.getObjectByName('player') ?? null);
    } else {
      this.patrol(deltaTime);
    }
  }

  private patrol(deltaTime: number): void {
    if (this.patrolPath.length === 0) return;

    const target = this.patrolPath[this.currentPatrolIndex].position;
    const direction = target.clone().sub(this.mesh.position);
    direction.y = 0;

    if (direction.length() < 1) {
      this.currentPatrolIndex = (this.currentPatrolIndex + 1) % this.patrolPath.length;
      return;
    }

    direction.normalize();
    this.mesh.position.add(direction.multiplyScalar(this.moveSpeed * deltaTime));

    this.mesh.lookAt(target);
  }

  private engageTarget(deltaTime: number, currentTime: number, distanceToPlayer: number): void {
    if (!this.target) return;

    if (distanceToPlayer > this.attackRange) {
      this.state = AIState.CHASE;
      const direction = this.target.position.clone().sub(this.mesh.position);
      direction.y = 0;
      direction.normalize();
      this.mesh.position.add(direction.multiplyScalar(this.moveSpeed * 1.5 * deltaTime));
    } else {
      this.state = AIState.ATTACK;
    }

    this.mesh.lookAt(this.target.position);

    if (this.state === AIState.ATTACK) {
      this.attemptFire(currentTime);
    }
  }

  private attemptFire(currentTime: number): void {
    const timeSinceLastFire = (currentTime - this.lastFireTime) / 1000;
    if (timeSinceLastFire >= 1 / this.fireRate) {
      this.lastFireTime = currentTime;
    }
  }

  getHealthPercentage(): number {
    return (this.health / this.maxHealth) * 100;
  }

  getTargetableMeshes(): THREE.Object3D[] {
    return [this.mesh];
  }

  dispose(): void {
    this.scene.remove(this.mesh);
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

export class AISystem {
  bots: AIBot[] = [];

  constructor(scene: THREE.Scene, count: number = 5) {
    this.spawnBots(scene, count);
  }

  private spawnBots(scene: THREE.Scene, count: number): void {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const radius = 20;
      const position = new THREE.Vector3(
        Math.cos(angle) * radius,
        0.85,
        Math.sin(angle) * radius
      );
      this.bots.push(new AIBot(scene, position));
    }
  }

  update(deltaTime: number, currentTime: number, playerPosition: THREE.Vector3): void {
    for (const bot of this.bots) {
      bot.update(deltaTime, currentTime, playerPosition);
    }
  }

  getAllTargetableMeshes(): THREE.Object3D[] {
    const meshes: THREE.Object3D[] = [];
    for (const bot of this.bots) {
      meshes.push(...bot.getTargetableMeshes());
    }
    return meshes;
  }

  dispose(): void {
    for (const bot of this.bots) {
      bot.dispose();
    }
    this.bots = [];
  }
}
