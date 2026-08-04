import * as THREE from 'three';
import { gameplayRandom } from '../core/Random';
import { TeamId } from '../game/ConquestMode';
import { AIPerception } from './AIPerception';
import { getAILodBudget } from './AILod';
import { evaluateAIVisibility, type SmokeVolume } from './AIVisibility';
import { decideTacticalAction, type AITacticalAction, type AITacticalDecision } from './SquadTactics';

export enum AIState {
  PATROL = 'patrol',
  CHASE = 'chase',
  ATTACK = 'attack',
  COVER = 'cover',
  DEAD = 'dead',
}

export enum AIDifficulty {
  NORMAL = 'normal',
  ELITE = 'elite',
  SNIPER = 'sniper',
}

export interface PatrolPoint {
  position: THREE.Vector3;
  waitTime: number;
}

interface DifficultyConfig {
  health: number;
  moveSpeed: number;
  sprintSpeed: number;
  detectionRange: number;
  attackRange: number;
  fireRate: number;
  damage: number;
  accuracy: number;
  reactionTime: number;
  reloadTime: number;
  weaponColor: number;
  bodyColor: number;
  headColor: number;
  name: string;
}

const DIFFICULTY_CONFIGS: Record<AIDifficulty, DifficultyConfig> = {
  [AIDifficulty.NORMAL]: {
    health: 100, moveSpeed: 3, sprintSpeed: 5,
    detectionRange: 40, attackRange: 25, fireRate: 3, damage: 10,
    accuracy: 0.6, reactionTime: 0.5, reloadTime: 2.5,
    weaponColor: 0x2a2a2a, bodyColor: 0x5a5a5a, headColor: 0xd4a574,
    name: '步兵',
  },
  [AIDifficulty.ELITE]: {
    health: 150, moveSpeed: 4, sprintSpeed: 6.5,
    detectionRange: 55, attackRange: 35, fireRate: 5, damage: 18,
    accuracy: 0.8, reactionTime: 0.25, reloadTime: 1.8,
    weaponColor: 0x1a1a1a, bodyColor: 0x3a3a4a, headColor: 0xc0a070,
    name: '精英',
  },
  [AIDifficulty.SNIPER]: {
    health: 80, moveSpeed: 2.5, sprintSpeed: 4,
    detectionRange: 80, attackRange: 70, fireRate: 1, damage: 45,
    accuracy: 0.95, reactionTime: 0.15, reloadTime: 3,
    weaponColor: 0x4a3a2a, bodyColor: 0x4a5a3a, headColor: 0xb09060,
    name: '狙击手',
  },
};

// AI 射击事件回调
export type AIFireCallback = (
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  damage: number,
  bot: AIBot
) => void;

export class AIBot {
  // 玩家阵营（静态字段，所有 AI 共享）
  static playerTeam: TeamId = TeamId.ALLIES;

  scene: THREE.Scene;
  mesh: THREE.Group;
  state: AIState = AIState.PATROL;
  difficulty: AIDifficulty;
  config: DifficultyConfig;
  team: TeamId = TeamId.NEUTRAL;
  squadRole: 'leader' | 'assault' | 'support' | 'medic' = 'assault';
  tacticalDecision: AITacticalDecision = { action: 'advance', reason: '初始化战术状态' };
  lastTargetVisible = false;

  health: number = 100;
  maxHealth: number = 100;
  moveSpeed: number = 3;
  attackRange: number = 30;
  detectionRange: number = 50;
  fireRate: number = 2;
  lastFireTime: number = 0;
  damage: number = 15;
  accuracy: number = 0.6;
  reactionTime: number = 0.5;
  reloadTime: number = 2.5;

  patrolPath: PatrolPoint[] = [];
  currentPatrolIndex: number = 0;
  target: THREE.Object3D | null = null;
  lastDamageTime: number = 0;
  deathTime: number = 0;
  respawnTime: number = 10000;
  canRespawn: boolean = true;

  // 行走动画
  private walkPhase = 0;
  private isMoving = false;
  private leftArm!: THREE.Mesh;
  private rightArm!: THREE.Mesh;
  private leftLeg!: THREE.Mesh;
  private rightLeg!: THREE.Mesh;
  private weaponMesh!: THREE.Group;
  private muzzleFlashMesh!: THREE.Mesh;
  private muzzleFlashTime = 0;

  // 寻路
  private pathFindTimer = 0;
  private avoidDirection = new THREE.Vector3();
  private stuckTimer = 0;
  private lastPosition = new THREE.Vector3();
  private readonly perception = new AIPerception();
  private visibilityEvaluator: ((observer: THREE.Vector3, target: THREE.Vector3, maxDistance: number) => boolean) | null = null;
  private nextPerceptionAt = 0;
  private nextDecisionAt = 0;

  // 掩体
  private coverPosition: THREE.Vector3 | null = null;
  private coverTimer = 0;
  private coverCooldown = 0;

  // 状态计时
  private stateTimer = 0;
  private reloadEndTime = 0;
  private isReloading = false;

  get isReloadingWeapon(): boolean {
    return this.isReloading;
  }
  private targetAcquiredTime = 0;
  private hasAcquiredTarget = false;

  // 射击回调
  private static fireCallbacks: AIFireCallback[] = [];

  constructor(scene: THREE.Scene, position: THREE.Vector3, difficulty: AIDifficulty = AIDifficulty.NORMAL, team: TeamId = TeamId.NEUTRAL) {
    this.scene = scene;
    this.difficulty = difficulty;
    this.team = team;
    this.config = DIFFICULTY_CONFIGS[difficulty];
    this.health = this.config.health;
    this.maxHealth = this.config.health;
    this.moveSpeed = this.config.moveSpeed;
    this.attackRange = this.config.attackRange;
    this.detectionRange = this.config.detectionRange;
    this.fireRate = this.config.fireRate;
    this.damage = this.config.damage;
    this.accuracy = this.config.accuracy;
    this.reactionTime = this.config.reactionTime;
    this.reloadTime = this.config.reloadTime;

    this.mesh = this.createBotMesh();
    this.mesh.position.copy(position);
    this.lastPosition.copy(position);
    scene.add(this.mesh);

    this.setupPatrolPath(position);
  }

  static onFire(cb: AIFireCallback): void {
    AIBot.fireCallbacks.push(cb);
  }

  static clearFireCallbacks(): void {
    AIBot.fireCallbacks = [];
  }

  setVisibilityEvaluator(
    evaluator: (observer: THREE.Vector3, target: THREE.Vector3, maxDistance: number) => boolean,
  ): void {
    this.visibilityEvaluator = evaluator;
  }

  applyTacticalDecision(decision: AITacticalDecision): void {
    this.tacticalDecision = decision;
    const actions: Record<AITacticalAction, AIState> = {
      follow: AIState.PATROL,
      focus_fire: AIState.ATTACK,
      suppress: AIState.ATTACK,
      advance: AIState.CHASE,
      retreat: AIState.COVER,
      revive: AIState.CHASE,
    };
    if (this.state !== AIState.DEAD) this.state = actions[decision.action];
  }

  // 头顶标识
  private nameTagMesh!: THREE.Sprite;

  private createBotMesh(): THREE.Group {
    const group = new THREE.Group();

    // 阵营颜色 - 使用更鲜明的颜色
    const isAxis = this.team === TeamId.AXIS;
    const isAllies = this.team === TeamId.ALLIES;
    const teamColor = isAxis ? 0xe63946 :
                      isAllies ? 0x1d3557 : this.config.bodyColor;
    const accentColor = isAxis ? 0xff0000 :
                        isAllies ? 0x0066ff : 0x888888;

    // MC 风格像素人 - 全部使用 BoxGeometry
    // 模型总高度约 1.8m，脚底在 Y=0

    // 腿部 (0.25 x 0.75 x 0.25)，脚底在 Y=0 - 使用阵营颜色裤子
    const legGeo = new THREE.BoxGeometry(0.25, 0.75, 0.25);
    const legMat = new THREE.MeshStandardMaterial({ color: isAxis ? 0x5c1818 : isAllies ? 0x1a3a5c : 0x2a2a2a });

    this.leftLeg = new THREE.Mesh(legGeo, legMat);
    this.leftLeg.position.set(-0.13, 0.375, 0);
    this.leftLeg.userData.bodyPart = 'limb';
    this.leftLeg.name = 'leftLeg';
    group.add(this.leftLeg);

    this.rightLeg = new THREE.Mesh(legGeo, legMat);
    this.rightLeg.position.set(0.13, 0.375, 0);
    this.rightLeg.userData.bodyPart = 'limb';
    this.rightLeg.name = 'rightLeg';
    group.add(this.rightLeg);

    // 身体 (0.5 x 0.75 x 0.25)，在腿部上方 - 使用阵营主色
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.75, 0.25),
      new THREE.MeshStandardMaterial({ color: teamColor })
    );
    body.position.y = 1.125;
    body.castShadow = true;
    body.userData.bodyPart = 'torso';
    body.name = 'body';
    group.add(body);

    // 身体正面添加阵营标识色块
    const chestBadge = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.3, 0.02),
      new THREE.MeshStandardMaterial({ color: accentColor, emissive: accentColor, emissiveIntensity: 0.2 })
    );
    chestBadge.position.set(0, 1.125, 0.13);
    group.add(chestBadge);

    // 手臂 (0.25 x 0.75 x 0.25)，与身体同高
    const armGeo = new THREE.BoxGeometry(0.25, 0.75, 0.25);
    const armMat = new THREE.MeshStandardMaterial({ color: this.config.bodyColor });

    this.leftArm = new THREE.Mesh(armGeo, armMat);
    this.leftArm.position.set(-0.38, 1.125, 0);
    this.leftArm.userData.bodyPart = 'limb';
    this.leftArm.name = 'leftArm';
    group.add(this.leftArm);

    this.rightArm = new THREE.Mesh(armGeo, armMat);
    this.rightArm.position.set(0.38, 1.125, 0);
    this.rightArm.userData.bodyPart = 'limb';
    this.rightArm.name = 'rightArm';
    group.add(this.rightArm);

    // 头部 (0.5 x 0.5 x 0.5)，在身体上方
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.5, 0.5),
      new THREE.MeshStandardMaterial({ color: this.config.headColor })
    );
    head.position.y = 1.75;
    head.castShadow = true;
    head.userData.bodyPart = 'head';
    head.name = 'head';
    group.add(head);

    // 头盔 - 使用阵营颜色
    const helmet = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.2, 0.55),
      new THREE.MeshStandardMaterial({ color: accentColor, metalness: 0.3 })
    );
    helmet.position.y = 1.95;
    helmet.castShadow = true;
    group.add(helmet);

    // 武器模型
    this.weaponMesh = this.createWeaponMesh();
    this.weaponMesh.position.set(0.35, 0.95, 0.3);
    group.add(this.weaponMesh);

    // 枪口火焰
    const flashGeo = new THREE.BoxGeometry(0.15, 0.15, 0.15);
    const flashMat = new THREE.MeshBasicMaterial({
      color: 0xffaa00, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
    });
    this.muzzleFlashMesh = new THREE.Mesh(flashGeo, flashMat);
    this.muzzleFlashMesh.position.set(0.35, 0.95, 0.85);
    group.add(this.muzzleFlashMesh);

    // 头顶阵营标识
    this.nameTagMesh = this.createNameTag();
    this.nameTagMesh.position.set(0, 2.4, 0);
    group.add(this.nameTagMesh);

    return group;
  }

  private createNameTag(): THREE.Sprite {
    const isAxis = this.team === TeamId.AXIS;
    const isAllies = this.team === TeamId.ALLIES;
    const label = isAxis ? '敌军' : isAllies ? '友军' : '中立';
    const color = isAxis ? '#ff3333' : isAllies ? '#4488ff' : '#888888';

    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;

    // 背景
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(0, 0, 256, 64, 8);
    ctx.fill();

    // 文字
    ctx.fillStyle = 'white';
    ctx.font = 'bold 32px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 128, 32);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(1.5, 0.375, 1);

    return sprite;
  }

  private createWeaponMesh(): THREE.Group {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color: this.config.weaponColor, metalness: 0.5, roughness: 0.6,
    });

    // 枪身
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.6), mat);
    body.position.z = 0.2;
    group.add(body);

    // 枪管
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.4, 6), mat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.z = 0.55;
    group.add(barrel);

    // 弹匣
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.2, 0.08), mat);
    mag.position.set(0, -0.15, 0.15);
    group.add(mag);

    // 枪托
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.2), mat);
    stock.position.z = -0.1;
    group.add(stock);

    // 狙击手加瞄镜
    if (this.difficulty === AIDifficulty.SNIPER) {
      const scope = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.04, 0.15, 6),
        new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.7 })
      );
      scope.rotation.x = Math.PI / 2;
      scope.position.set(0, 0.1, 0.25);
      group.add(scope);
    }

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

  // 受击反应
  private flinchTimer = 0;
  private accuracyPenalty = 0;
  // 受击后仰/击退
  private knockbackVelocity = new THREE.Vector3();
  private hitPulse = 0;

  takeDamage(amount: number, hitPoint: THREE.Vector3, currentTime: number): boolean {
    if (this.state === AIState.DEAD) return false;

    this.health = Math.max(0, this.health - amount);
    this.lastDamageTime = currentTime;

    // 受击反应：短暂硬直 + 精度下降
    this.flinchTimer = 0.3;
    this.accuracyPenalty = Math.min(0.3, this.accuracyPenalty + 0.1);

    // 受击击退：子弹方向推动模型
    const pushDir = this.mesh.position.clone().sub(hitPoint);
    pushDir.y = 0;
    const len = pushDir.length();
    if (len > 0.01) {
      pushDir.normalize();
      const power = this.difficulty === AIDifficulty.ELITE ? 1.0 : 1.6;
      this.knockbackVelocity.add(pushDir.multiplyScalar(power));
    }

    // 命中脉冲（模型膨胀反馈）
    this.hitPulse = 1;

    if (this.health <= 0) {
      this.die(hitPoint, currentTime);
      return true;
    }

    // 受伤后立即进入攻击状态
    if (this.target) {
      this.state = AIState.ATTACK;
    }
    // 低血量时找掩体
    if (this.health < this.maxHealth * 0.3 && this.coverCooldown <= 0) {
      this.state = AIState.COVER;
      this.coverTimer = 3000;
    }
    return false;
  }

  private die(hitPoint: THREE.Vector3, currentTime: number): void {
    this.state = AIState.DEAD;
    this.deathTime = currentTime;
    this.health = 0;

    // 死亡击飞：向命中反方向倒飞
    const knockDir = this.mesh.position.clone().sub(hitPoint);
    knockDir.y = 0;
    knockDir.normalize();
    const knockback = knockDir.multiplyScalar(0.8);
    knockback.y = 0.3;
    this.mesh.position.add(knockback);
    this.mesh.rotation.x = Math.PI / 2;
    (this.muzzleFlashMesh.material as THREE.MeshBasicMaterial).opacity = 0;

    // 死亡红闪
    this.hitPulse = 1.5;
  }

  respawn(): void {
    this.state = AIState.PATROL;
    this.health = this.maxHealth;
    this.mesh.rotation.set(0, 0, 0);
    this.mesh.position.copy(this.patrolPath[0].position);
    this.currentPatrolIndex = 0;
    this.isReloading = false;
    this.hasAcquiredTarget = false;
    this.coverCooldown = 0;
    this.flinchTimer = 0;
    this.accuracyPenalty = 0;
    this.knockbackVelocity.set(0, 0, 0);
    this.hitPulse = 0;
    // 恢复身体材质（清除死亡红闪）
    const body = this.mesh.getObjectByName('body');
    if (body instanceof THREE.Mesh) {
      const mat = body.material as THREE.MeshStandardMaterial;
      mat.emissive.setHex(0x000000);
      mat.emissiveIntensity = 0;
    }
  }

  setTarget(target: THREE.Object3D | null): void {
    if (this.target !== target) {
      this.hasAcquiredTarget = false;
      this.targetAcquiredTime = performance.now();
    }
    this.target = target;
    if (target && this.state === AIState.PATROL) {
      this.state = AIState.CHASE;
    }
  }

  update(deltaTime: number, currentTime: number, playerPosition: THREE.Vector3): void {
    if (this.state === AIState.DEAD) {
      // 死亡红闪动画（尸体短暂闪烁后稳定）
      if (this.hitPulse > 0) {
        this.hitPulse = Math.max(0, this.hitPulse - deltaTime * 5);
        const body = this.mesh.getObjectByName('body');
        if (body instanceof THREE.Mesh) {
          const mat = body.material as THREE.MeshStandardMaterial;
          mat.emissive.setHex(this.hitPulse > 0.4 ? 0xff0000 : 0x000000);
          mat.emissiveIntensity = this.hitPulse * 0.8;
        }
      }
      if (this.canRespawn && currentTime - this.deathTime >= this.respawnTime) {
        this.respawn();
      }
      return;
    }

    // 计时器递减
    this.stateTimer += deltaTime;
    if (this.coverCooldown > 0) this.coverCooldown -= deltaTime * 1000;

    // 受击硬直恢复
    if (this.flinchTimer > 0) {
      this.flinchTimer -= deltaTime;
    }

    // 击退位移（衰减）
    if (this.knockbackVelocity.lengthSq() > 0.0001) {
      this.mesh.position.add(this.knockbackVelocity.clone().multiplyScalar(deltaTime));
      this.knockbackVelocity.multiplyScalar(Math.max(0, 1 - 10 * deltaTime));
      if (this.knockbackVelocity.lengthSq() < 0.0001) {
        this.knockbackVelocity.set(0, 0, 0);
      }
    }

    // 命中脉冲：模型短暂放大反馈（红闪 + 膨胀）
    if (this.hitPulse > 0) {
      this.hitPulse = Math.max(0, this.hitPulse - deltaTime * 6);
      const scale = 1 + this.hitPulse * 0.12;
      this.mesh.scale.set(scale, scale, scale);
      // 受击红色闪光的材质处理
      const body = this.mesh.getObjectByName('body');
      if (body instanceof THREE.Mesh) {
        const mat = body.material as THREE.MeshStandardMaterial;
        mat.emissive.setHex(this.hitPulse > 0.4 ? 0xffffff : 0x000000);
        mat.emissiveIntensity = this.hitPulse * 0.6;
      }
    } else {
      this.mesh.scale.set(1, 1, 1);
    }

    // 精度惩罚恢复
    if (this.accuracyPenalty > 0) {
      this.accuracyPenalty = Math.max(0, this.accuracyPenalty - deltaTime * 0.2);
    }

    // 换弹完成
    if (this.isReloading && currentTime >= this.reloadEndTime) {
      this.isReloading = false;
    }

    const distanceToPlayer = this.mesh.position.distanceTo(playerPosition);
    const visible = this.visibilityEvaluator
      ? this.visibilityEvaluator(this.mesh.position, playerPosition, this.detectionRange)
      : distanceToPlayer <= this.detectionRange;
    this.lastTargetVisible = visible;
    const lod = getAILodBudget(distanceToPlayer, visible);
    this.mesh.visible = lod.animate || visible;

    if (currentTime >= this.nextPerceptionAt) {
      this.nextPerceptionAt = currentTime + lod.perceptionIntervalMs;
      this.perception.update(currentTime);
      if (visible && this.team !== AIBot.playerTeam) {
        this.perception.see('player', playerPosition, 1, currentTime);
      }
    }
    if (currentTime < this.nextDecisionAt) return;
    this.nextDecisionAt = currentTime + lod.decisionIntervalMs;

    // 反应时间
    if (this.target && !this.hasAcquiredTarget) {
      if (currentTime - this.targetAcquiredTime >= this.reactionTime * 1000) {
        this.hasAcquiredTarget = true;
      }
    }

    // 状态机
    switch (this.state) {
      case AIState.PATROL:
        this.patrol(deltaTime);
        // 只有敌方 AI 才检测玩家
        if (this.team !== AIBot.playerTeam && visible) {
          this.setTarget(this.scene.getObjectByName('player') ?? null);
        }
        break;

      case AIState.CHASE:
        this.chase(deltaTime, currentTime, playerPosition, distanceToPlayer, visible);
        break;

      case AIState.ATTACK:
        this.attack(deltaTime, currentTime, playerPosition, distanceToPlayer, visible);
        break;

      case AIState.COVER:
        this.seekCover(deltaTime, currentTime, playerPosition);
        break;
    }

    // 行走动画
    this.updateWalkAnimation(deltaTime);

    // 枪口火焰淡出
    const muzzleMat = this.muzzleFlashMesh.material as THREE.MeshBasicMaterial;
    if (muzzleMat.opacity > 0) {
      muzzleMat.opacity = Math.max(0, muzzleMat.opacity - deltaTime * 15);
    }

    // 卡住检测
    this.checkStuck(deltaTime);
  }

  private patrol(deltaTime: number): void {
    if (this.patrolPath.length === 0) return;
    this.isMoving = true;

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

  private chase(
    deltaTime: number,
    _currentTime: number,
    playerPosition: THREE.Vector3,
    distanceToPlayer: number,
    visible: boolean,
  ): void {
    if (!this.target) return;
    if (!visible) {
      this.target = null;
      this.state = AIState.PATROL;
      return;
    }
    this.isMoving = true;

    if (distanceToPlayer <= this.attackRange) {
      this.state = AIState.ATTACK;
      return;
    }

    // 追击 + 避障
    const direction = playerPosition.clone().sub(this.mesh.position);
    direction.y = 0;
    direction.normalize();

    // 加入避障偏移
    direction.add(this.avoidDirection.multiplyScalar(0.5));
    direction.normalize();

    const speed = this.config.sprintSpeed;
    this.mesh.position.add(direction.multiplyScalar(speed * deltaTime));
    this.mesh.lookAt(playerPosition);
  }

  private attack(
    deltaTime: number,
    currentTime: number,
    playerPosition: THREE.Vector3,
    distanceToPlayer: number,
    visible: boolean,
  ): void {
    if (!this.target) return;
    if (!visible) {
      this.target = null;
      this.hasAcquiredTarget = false;
      this.state = AIState.PATROL;
      return;
    }
    this.isMoving = false;

    // 超出攻击范围 → 追击
    if (distanceToPlayer > this.attackRange * 1.2) {
      this.state = AIState.CHASE;
      return;
    }

    // 丢失目标 → 巡逻
    if (distanceToPlayer > this.detectionRange * 1.5) {
      this.target = null;
      this.state = AIState.PATROL;
      return;
    }

    // 面朝玩家
    this.mesh.lookAt(playerPosition);

    // 换弹中不射击
    if (this.isReloading) return;

    // 反应时间未到
    if (!this.hasAcquiredTarget) return;

    // 受击硬直时不射击
    if (this.flinchTimer > 0) return;

    // 射击
    this.attemptFire(currentTime, playerPosition);

    // 战术移动：狙击手保持距离，步兵侧翼包抄
    if (this.difficulty === AIDifficulty.SNIPER && distanceToPlayer < 30) {
      const dir = playerPosition.clone().sub(this.mesh.position);
      dir.y = 0;
      dir.normalize();
      const strafe = new THREE.Vector3(-dir.z, 0, dir.x);
      this.mesh.position.add(strafe.multiplyScalar(this.moveSpeed * deltaTime));
    } else if (this.difficulty !== AIDifficulty.SNIPER && distanceToPlayer > 10) {
      // 侧翼包抄：向玩家侧面移动
      const dir = playerPosition.clone().sub(this.mesh.position);
      dir.y = 0;
      dir.normalize();
      // 根据 AI 的巡逻索引决定包抄方向（左或右）
      const flankDir = this.currentPatrolIndex % 2 === 0 ? 1 : -1;
      const strafe = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(flankDir);
      // 混合前进和侧移
      const moveDir = dir.clone().multiplyScalar(0.6).add(strafe.multiplyScalar(0.4));
      moveDir.normalize();
      this.mesh.position.add(moveDir.multiplyScalar(this.moveSpeed * 0.5 * deltaTime));
    }
  }

  private seekCover(deltaTime: number, currentTime: number, playerPosition: THREE.Vector3): void {
    this.isMoving = true;
    this.coverTimer -= deltaTime * 1000;

    // 掩体时间结束 → 重新攻击
    if (this.coverTimer <= 0) {
      this.state = AIState.ATTACK;
      this.coverCooldown = 8000; // 8秒冷却
      return;
    }

    // 寻找远离玩家的方向作为"掩体"
    if (!this.coverPosition) {
      const awayDir = this.mesh.position.clone().sub(playerPosition);
      awayDir.y = 0;
      awayDir.normalize();
      this.coverPosition = this.mesh.position.clone().add(awayDir.multiplyScalar(5));
    }

    const direction = this.coverPosition.clone().sub(this.mesh.position);
    direction.y = 0;

    if (direction.length() < 1) {
      // 到达掩体，蹲下回血
      this.isMoving = false;
      this.health = Math.min(this.maxHealth, this.health + 20 * deltaTime);
    } else {
      direction.normalize();
      this.mesh.position.add(direction.multiplyScalar(this.config.sprintSpeed * deltaTime));
      this.mesh.lookAt(this.coverPosition);
    }
  }

  private attemptFire(currentTime: number, playerPosition: THREE.Vector3): void {
    const timeSinceLastFire = (currentTime - this.lastFireTime) / 1000;
    const effectiveFireRate = this.isReloading ? 0 : this.fireRate;

    // 随机射击间隔（±30%）
    const randomInterval = (1 / effectiveFireRate) * (0.7 + gameplayRandom() * 0.6);
    if (timeSinceLastFire < randomInterval) return;

    // 模拟弹匣：每 10 发换弹
    if (this.lastFireTime > 0 && Math.floor((this.lastFireTime) / 1000) !== Math.floor(currentTime / 1000)) {
      // 每秒检查一次是否需要换弹
      if (gameplayRandom() < 0.15) {
        this.isReloading = true;
        this.reloadEndTime = currentTime + this.reloadTime * 1000;
        return;
      }
    }

    this.lastFireTime = currentTime;

    // 枪口火焰
    (this.muzzleFlashMesh.material as THREE.MeshBasicMaterial).opacity = 1;

    // 计算射击方向（从枪口到玩家，带散布）
    const muzzlePos = new THREE.Vector3();
    this.muzzleFlashMesh.getWorldPosition(muzzlePos);

    const direction = playerPosition.clone().sub(muzzlePos).normalize();

    // 散布：精度越低散布越大 + 受击精度惩罚
    const effectiveAccuracy = Math.max(0.2, this.accuracy - this.accuracyPenalty);
    const spread = (1 - effectiveAccuracy) * 0.2;
    direction.x += (gameplayRandom() - 0.5) * spread;
    direction.y += (gameplayRandom() - 0.5) * spread;
    direction.z += (gameplayRandom() - 0.5) * spread;
    direction.normalize();

    // 触发射击回调（由 GameScene 处理弹道轨迹和伤害）
    for (const cb of AIBot.fireCallbacks) {
      cb(muzzlePos, direction, this.damage, this);
    }
  }

  private updateWalkAnimation(deltaTime: number): void {
    if (!this.isMoving || this.state === AIState.DEAD) {
      // 停止时四肢归位
      this.leftArm.rotation.x *= 0.8;
      this.rightArm.rotation.x *= 0.8;
      this.leftLeg.rotation.x *= 0.8;
      this.rightLeg.rotation.x *= 0.8;
      // 恢复地面高度
      this.mesh.position.y = 0;
      return;
    }

    this.walkPhase += deltaTime * 10;

    // 手臂和腿摆动（幅度更大更明显）
    const swing = Math.sin(this.walkPhase) * 0.7;
    this.leftArm.rotation.x = swing;
    this.rightArm.rotation.x = -swing;
    this.leftLeg.rotation.x = -swing;
    this.rightLeg.rotation.x = swing;

    // 轻微上下浮动（脚底在地面，所以浮动很小）
    this.mesh.position.y = Math.abs(Math.sin(this.walkPhase * 2)) * 0.03;
  }

  private checkStuck(deltaTime: number): void {
    const moved = this.mesh.position.distanceTo(this.lastPosition);
    if (this.isMoving && moved < 0.01 * deltaTime * 60) {
      this.stuckTimer += deltaTime;
      if (this.stuckTimer > 0.5) {
        // 卡住了，随机改变避障方向
        const angle = gameplayRandom() * Math.PI * 2;
        this.avoidDirection.set(Math.cos(angle), 0, Math.sin(angle));
        this.stuckTimer = 0;
      }
    } else {
      this.stuckTimer = 0;
      this.avoidDirection.set(0, 0, 0);
    }
    this.lastPosition.copy(this.mesh.position);
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
  private currentTime = 0;
  private lastTacticalUpdate = 0;
  private readonly tacticalLog: { botIndex: number; action: AITacticalAction; reason: string; time: number }[] = [];

  constructor(scene: THREE.Scene, count: number = 5) {
    this.spawnBots(scene, count);
  }

  // 战地模式：分阵营生成 AI
  // playerTeam: 玩家阵营，敌方 AI 会在对方营地深处生成
  static createTeamBots(scene: THREE.Scene, axisCount: number, alliesCount: number, axisSpawn: THREE.Vector3, alliesSpawn: THREE.Vector3, playerTeam: TeamId = TeamId.AXIS): AISystem {
    const system = new AISystem(scene, 0); // 不生成默认 bot

    const difficulties: AIDifficulty[] = [
      AIDifficulty.NORMAL, AIDifficulty.NORMAL, AIDifficulty.ELITE, AIDifficulty.SNIPER,
    ];

    // 德军 AI
    for (let i = 0; i < axisCount; i++) {
      const isEnemy = playerTeam !== TeamId.AXIS;
      const position = AISystem.getSpawnPosition(axisSpawn, i, axisCount, isEnemy);
      const difficulty = difficulties[i % difficulties.length];
      system.bots.push(new AIBot(scene, position, difficulty, TeamId.AXIS));
    }

    // 苏军 AI
    for (let i = 0; i < alliesCount; i++) {
      const isEnemy = playerTeam !== TeamId.ALLIES;
      const position = AISystem.getSpawnPosition(alliesSpawn, i, alliesCount, isEnemy);
      const difficulty = difficulties[i % difficulties.length];
      system.bots.push(new AIBot(scene, position, difficulty, TeamId.ALLIES));
    }

    system.assignSquadRoles();
    return system;
  }

  private assignSquadRoles(): void {
    const roles: AIBot['squadRole'][] = ['leader', 'assault', 'support', 'medic'];
    this.bots.forEach((bot, index) => {
      bot.squadRole = roles[index % roles.length];
    });
  }

  // 计算 AI 生成位置
  // 敌方 AI 在营地深处生成（远离地图中心），友方 AI 在营地边缘生成
  private static getSpawnPosition(campCenter: THREE.Vector3, index: number, total: number, isEnemy: boolean): THREE.Vector3 {
    const angle = (index / total) * Math.PI * 2 + gameplayRandom() * 0.5;

    if (isEnemy) {
      // 敌方：在营地深处生成，远离地图中心
      // 营地中心向远离原点方向偏移 10-20 米
      const awayFromCenter = campCenter.clone().normalize();
      const depthOffset = 10 + gameplayRandom() * 10;
      const spreadRadius = 3 + gameplayRandom() * 5;

      return new THREE.Vector3(
        campCenter.x + awayFromCenter.x * depthOffset + Math.cos(angle) * spreadRadius,
        0, // 脚底在地面
        campCenter.z + awayFromCenter.z * depthOffset + Math.sin(angle) * spreadRadius
      );
    } else {
      // 友方：在营地边缘生成，靠近玩家出生点
      const radius = 3 + gameplayRandom() * 5;
      return new THREE.Vector3(
        campCenter.x + Math.cos(angle) * radius,
        0, // 脚底在地面
        campCenter.z + Math.sin(angle) * radius
      );
    }
  }

  private spawnBots(scene: THREE.Scene, count: number): void {
    if (count === 0) return;

    const difficulties: AIDifficulty[] = [
      AIDifficulty.NORMAL, AIDifficulty.NORMAL, AIDifficulty.NORMAL,
      AIDifficulty.ELITE, AIDifficulty.SNIPER,
    ];

    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const radius = 20 + gameplayRandom() * 10;
      const position = new THREE.Vector3(
        Math.cos(angle) * radius,
        0, // 脚底在地面
        Math.sin(angle) * radius
      );
      const difficulty = difficulties[i % difficulties.length];
      this.bots.push(new AIBot(scene, position, difficulty));
    }
  }

  // 获取指定阵营的 bot
  getBotsByTeam(team: TeamId): AIBot[] {
    return this.bots.filter(b => b.team === team);
  }

  // 获取敌方 bot（相对玩家阵营）
  getEnemyBots(playerTeam: TeamId): AIBot[] {
    return this.bots.filter(b => b.team !== playerTeam && b.team !== TeamId.NEUTRAL);
  }

  // 获取友方 bot
  getFriendlyBots(playerTeam: TeamId): AIBot[] {
    return this.bots.filter(b => b.team === playerTeam);
  }

  configureVisibility(
    environmentObjects: readonly THREE.Object3D[],
    getSmokeVolumes: (currentTime: number) => readonly SmokeVolume[],
  ): void {
    const raycaster = new THREE.Raycaster();
    for (const bot of this.bots) {
      bot.setVisibilityEvaluator((observer, target, maxDistance) => {
        const direction = target.clone().sub(observer);
        const distance = direction.length();
        if (distance === 0) return true;
        raycaster.set(observer, direction.normalize());
        raycaster.far = Math.min(distance, maxDistance);
        const occludedByWorld = raycaster.intersectObjects([...environmentObjects], true)
          .some((hit) => hit.distance < distance - 0.25);
        return evaluateAIVisibility(observer, target, {
          maxDistance,
          occludedByWorld,
          smokeVolumes: getSmokeVolumes(this.currentTime),
        }).visible;
      });
    }
  }

  update(deltaTime: number, currentTime: number, playerPosition: THREE.Vector3): void {
    this.currentTime = currentTime;
    if (currentTime - this.lastTacticalUpdate >= 1_000) {
      this.lastTacticalUpdate = currentTime;
      this.updateSquadTactics(currentTime, playerPosition);
    }
    for (const bot of this.bots) {
      bot.update(deltaTime, currentTime, playerPosition);
    }
  }

  getTacticalLog(): readonly { botIndex: number; action: AITacticalAction; reason: string; time: number }[] {
    return this.tacticalLog;
  }

  private updateSquadTactics(currentTime: number, _playerPosition: THREE.Vector3): void {
    for (let index = 0; index < this.bots.length; index++) {
      const bot = this.bots[index];
      if (bot.state === AIState.DEAD) continue;
      const squadStart = Math.floor(index / 4) * 4;
      const leader = this.bots[squadStart] ?? bot;
      const downedAlly = this.bots
        .filter((candidate) => candidate.team === bot.team && candidate.state === AIState.DEAD)
        .reduce<number | null>((nearest, candidate) => {
          const distance = bot.mesh.position.distanceTo(candidate.mesh.position);
          return nearest === null || distance < nearest ? distance : nearest;
        }, null);
      const visibleEnemies = bot.team !== AIBot.playerTeam && bot.lastTargetVisible ? 1 : 0;
      const decision = decideTacticalAction({
        distanceToLeader: bot.mesh.position.distanceTo(leader.mesh.position),
        visibleEnemies,
        healthRatio: bot.health / bot.maxHealth,
        ammoRatio: bot.isReloadingWeapon ? 0 : 1,
        downedAllyDistance: downedAlly,
        objectiveDistance: bot.mesh.position.distanceTo(new THREE.Vector3()),
        role: bot.squadRole,
      });
      bot.applyTacticalDecision(decision);
      this.tacticalLog.push({ botIndex: index, action: decision.action, reason: decision.reason, time: currentTime });
    }
    if (this.tacticalLog.length > 256) this.tacticalLog.splice(0, this.tacticalLog.length - 256);
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
    AIBot.clearFireCallbacks();
  }
}
