import * as THREE from 'three';

export class MuzzleFlash {
  scene: THREE.Scene;
  camera: THREE.Camera;
  flashLight: THREE.PointLight;
  flashMesh: THREE.Mesh;
  duration: number = 50;
  isActive: boolean = false;
  startTime: number = 0;

  constructor(scene: THREE.Scene, camera: THREE.Camera) {
    this.scene = scene;
    this.camera = camera;

    this.flashLight = new THREE.PointLight(0xffaa00, 0, 5);
    this.flashLight.position.set(0, 0, -0.8);
    this.camera.add(this.flashLight);

    const flashGeometry = new THREE.PlaneGeometry(0.15, 0.15);
    const flashMaterial = new THREE.MeshBasicMaterial({
      color: 0xffdd00,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
    });
    this.flashMesh = new THREE.Mesh(flashGeometry, flashMaterial);
    this.flashMesh.position.set(0, 0.02, -0.85);
    this.camera.add(this.flashMesh);
  }

  trigger(currentTime: number): void {
    this.isActive = true;
    this.startTime = currentTime;
    this.flashLight.intensity = 5;
    (this.flashMesh.material as THREE.MeshBasicMaterial).opacity = 1;

    // 随机旋转 + 随机缩放，火焰更有冲击感
    const scale = 0.9 + Math.random() * 0.6;
    this.flashMesh.scale.set(scale, scale, scale);
    this.flashMesh.rotation.z = Math.random() * Math.PI;
  }

  update(currentTime: number): void {
    if (!this.isActive) return;

    const elapsed = currentTime - this.startTime;
    if (elapsed >= this.duration) {
      this.isActive = false;
      this.flashLight.intensity = 0;
      (this.flashMesh.material as THREE.MeshBasicMaterial).opacity = 0;
      return;
    }

    // 二次衰减曲线，爆闪后快速熄灭
    const t = elapsed / this.duration;
    const fade = (1 - t) * (1 - t);
    this.flashLight.intensity = 6 * fade;
    (this.flashMesh.material as THREE.MeshBasicMaterial).opacity = fade;
  }
}
