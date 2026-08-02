import * as THREE from 'three';
import { Weapon, type WeaponConfig, WeaponType } from './WeaponSystem';

export class WeaponView {
  scene: THREE.Scene;
  camera: THREE.Camera;
  weaponMesh: THREE.Group | null = null;
  currentWeapon: Weapon | null = null;
  basePosition = new THREE.Vector3(0.3, -0.25, -0.5);
  swayAmount = 0;
  swayVelocity = 0;
  recoilOffset = 0;
  recoilRecovery = 0;
  bobPhase = 0;

  constructor(scene: THREE.Scene, camera: THREE.Camera) {
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
  }

  update(_deltaTime: number, isMoving: boolean, isFiring: boolean, dt: number): void {
    if (!this.weaponMesh) return;

    this.swayVelocity *= 0.85;
    this.swayAmount += this.swayVelocity * dt;
    this.swayAmount *= 0.85;

    if (isMoving) {
      this.swayVelocity += (Math.random() - 0.5) * 5 * dt;
    }

    if (isFiring) {
      this.bobPhase += dt * 20;
    } else {
      this.bobPhase *= 0.95;
    }

    this.recoilOffset *= 0.85;
    this.recoilRecovery = Math.min(1, this.recoilRecovery + dt * 5);

    const swayX = Math.sin(this.bobPhase) * 0.005;
    const swayY = Math.abs(Math.cos(this.bobPhase)) * 0.008;

    this.weaponMesh.position.x = this.basePosition.x + swayX + this.swayAmount * 0.1;
    this.weaponMesh.position.y = this.basePosition.y - swayY - this.recoilOffset;
    this.weaponMesh.position.z = this.basePosition.z - this.recoilOffset * 0.3;
    this.weaponMesh.rotation.x = this.recoilOffset * 2;
  }
}
