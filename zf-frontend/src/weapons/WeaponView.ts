import * as THREE from 'three';
import { Weapon, type WeaponConfig, WeaponType } from './WeaponSystem';

const ADS_POSITION = new THREE.Vector3(0, -0.15, -0.35);
const ADS_LERP_SPEED = 10;
const SWITCH_DURATION = 0.4;

export class WeaponView {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  weaponMesh: THREE.Group | null = null;
  currentWeapon: Weapon | null = null;
  basePosition = new THREE.Vector3(0.3, -0.25, -0.5);
  swayAmount = 0;
  swayVelocity = 0;
  recoilOffset = 0;
  recoilRecovery = 0;
  bobPhase = 0;

  // ADS
  private isAiming = false;
  private adsProgress = 0;

  // 切枪动画
  private switchProgress = 1;
  private isSwitching = false;

  // 相机后坐力回调
  onCameraRecoil?: (pitch: number, yaw: number) => void;

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.scene = scene;
    this.camera = camera;
  }

  equipWeapon(weapon: Weapon): void {
    if (this.weaponMesh) {
      this.camera.remove(this.weaponMesh);
    }

    this.currentWeapon = weapon;
    this.weaponMesh = this.createWeaponMesh(weapon.config);
    this.weaponMesh.position.copy(this.basePosition);
    this.camera.add(this.weaponMesh);

    // 切枪动画
    this.isSwitching = true;
    this.switchProgress = 0;
  }

  private createWeaponMesh(config: WeaponConfig): THREE.Group {
    const group = new THREE.Group();

    const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, metalness: 0.8, roughness: 0.4 });
    const woodMaterial = new THREE.MeshStandardMaterial({ color: 0x5c3a1e, roughness: 0.7 });

    let body: THREE.Mesh;
    let barrel: THREE.Mesh;
    let magazine: THREE.Mesh;
    let stock: THREE.Mesh | null = null;

    switch (config.type) {
      case WeaponType.ASSAULT_RIFLE:
        body = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.45), bodyMaterial);
        barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.3, 8), bodyMaterial);
        magazine = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.15, 0.05), bodyMaterial);
        stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.2), woodMaterial);
        break;
      case WeaponType.SMG:
        body = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.35), bodyMaterial);
        barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.015, 0.2, 8), bodyMaterial);
        magazine = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.18, 0.04), bodyMaterial);
        break;
      case WeaponType.LMG:
        body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.55), bodyMaterial);
        barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.4, 8), bodyMaterial);
        magazine = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.2, 0.05), bodyMaterial);
        stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.25), woodMaterial);
        break;
      case WeaponType.BOLT_RIFLE:
        body = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.08, 0.5), bodyMaterial);
        barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.018, 0.45, 8), bodyMaterial);
        magazine = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.08, 0.05), bodyMaterial);
        stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.3), woodMaterial);
        break;
    }

    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.02, -0.35);

    magazine.position.set(0, -0.12, 0);

    if (stock) {
      stock.position.set(0, 0, 0.25);
      group.add(stock);
    }

    group.add(body, barrel, magazine);

    const scope = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.015, 0.08, 8),
      new THREE.MeshStandardMaterial({ color: 0x1a1a1a })
    );
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.06, -0.05);
    group.add(scope);

    return group;
  }

  applyRecoil(recoilAmount: number): void {
    this.recoilOffset += recoilAmount;

    // 相机后坐力
    if (this.onCameraRecoil) {
      const pitchRecoil = recoilAmount * 0.15;
      const yawRecoil = recoilAmount * 0.05;
      this.onCameraRecoil(pitchRecoil, yawRecoil);
    }
  }

  setAiming(aiming: boolean): void {
    this.isAiming = aiming;
  }

  update(_deltaTime: number, isMoving: boolean, isFiring: boolean, dt: number): void {
    if (!this.weaponMesh) return;

    // 切枪动画
    if (this.isSwitching) {
      this.switchProgress += dt / SWITCH_DURATION;
      if (this.switchProgress >= 1) {
        this.switchProgress = 1;
        this.isSwitching = false;
      }
    }

    // ADS 进度（FOV 由 PlayerController 统一处理）
    const adsTarget = this.isAiming ? 1 : 0;
    this.adsProgress += (adsTarget - this.adsProgress) * Math.min(1, ADS_LERP_SPEED * dt);

    this.swayVelocity *= 0.85;
    this.swayAmount += this.swayVelocity * dt;
    this.swayAmount *= 0.85;

    if (isMoving && !this.isAiming) {
      this.swayVelocity += (Math.random() - 0.5) * 5 * dt;
    }

    if (isFiring) {
      this.bobPhase += dt * 20;
    } else {
      this.bobPhase *= 0.95;
    }

    this.recoilOffset *= 0.82;
    this.recoilRecovery = Math.min(1, this.recoilRecovery + dt * 5);

    const swayX = Math.sin(this.bobPhase) * 0.005;
    const swayY = Math.abs(Math.cos(this.bobPhase)) * 0.008;

    // 射击时的随机横向抖动（增强打击感）
    let recoilJitterX = 0;
    if (isFiring) {
      recoilJitterX = (Math.random() - 0.5) * this.recoilOffset * 0.6;
    }

    // 基础位置 + 摆动 + 后坐力抖动
    let posX = this.basePosition.x + swayX + this.swayAmount * 0.1 + recoilJitterX;
    let posY = this.basePosition.y - swayY - this.recoilOffset;
    let posZ = this.basePosition.z - this.recoilOffset * 0.3;

    // ADS 位置插值
    posX = posX + (ADS_POSITION.x - posX) * this.adsProgress;
    posY = posY + (ADS_POSITION.y - posY) * this.adsProgress;
    posZ = posZ + (ADS_POSITION.z - posZ) * this.adsProgress;

    // 切枪动画：武器从下方升起
    if (this.isSwitching) {
      const t = this.switchProgress;
      const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      posY -= (1 - ease) * 0.3;
      posZ += (1 - ease) * 0.2;
    }

    this.weaponMesh.position.set(posX, posY, posZ);
    this.weaponMesh.rotation.x = this.recoilOffset * 2;

    // ADS 时减少摆动
    if (this.isAiming) {
      this.weaponMesh.position.x *= 0.3;
      this.weaponMesh.position.y = this.weaponMesh.position.y * 0.3 + ADS_POSITION.y * 0.7;
    }
  }

  getAdsProgress(): number {
    return this.adsProgress;
  }
}
