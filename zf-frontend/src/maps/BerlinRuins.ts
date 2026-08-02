import * as THREE from 'three';

export interface MapConfig {
  size: number;
  cellSize: number;
  wallHeight: number;
  debrisDensity: number;
  rubbleCount: number;
  buildingCount: number;
  streetWidth: number;
}

export const DEFAULT_MAP_CONFIG: MapConfig = {
  size: 120,
  cellSize: 4,
  wallHeight: 3,
  debrisDensity: 0.3,
  rubbleCount: 50,
  buildingCount: 20,
  streetWidth: 6,
};

export class BerlinRuins {
  scene: THREE.Scene;
  config: MapConfig;
  ground: THREE.Mesh | null = null;
  buildings: THREE.Group[] = [];
  rubble: THREE.Group[] = [];
  collisionObjects: THREE.Object3D[] = [];

  constructor(scene: THREE.Scene, config: MapConfig = DEFAULT_MAP_CONFIG) {
    this.scene = scene;
    this.config = config;
  }

  generate(): void {
    this.createGround();
    this.createBuildings();
    this.createRubble();
    this.createDebris();
    this.createStreets();
    this.createAtmosphere();
  }

  private createGround(): void {
    const geometry = new THREE.PlaneGeometry(this.config.size, this.config.size);
    const material = new THREE.MeshStandardMaterial({
      color: 0x5a5a5a,
      roughness: 0.9,
      metalness: 0.1,
    });
    this.ground = new THREE.Mesh(geometry, material);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
    this.collisionObjects.push(this.ground);
  }

  private createBuildings(): void {
    const buildingColors = [0x4a4a4a, 0x3a3a3a, 0x5a5a5a, 0x2a2a2a, 0x6a6a6a];

    for (let i = 0; i < this.config.buildingCount; i++) {
      const building = new THREE.Group();

      const width = 8 + Math.random() * 12;
      const depth = 8 + Math.random() * 12;
      const height = 5 + Math.random() * 15;

      const x = (Math.random() - 0.5) * (this.config.size - width);
      const z = (Math.random() - 0.5) * (this.config.size - depth);

      const geometry = new THREE.BoxGeometry(width, height, depth);
      const color = buildingColors[Math.floor(Math.random() * buildingColors.length)];
      const material = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.8,
        metalness: 0.2,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, height / 2, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      building.add(mesh);

      for (let j = 0; j < 3; j++) {
        const windowGeometry = new THREE.PlaneGeometry(1.5, 2);
        const windowMaterial = new THREE.MeshStandardMaterial({
          color: 0x1a1a3a,
          emissive: 0x0a0a1a,
          emissiveIntensity: 0.3,
        });
        const windowMesh = new THREE.Mesh(windowGeometry, windowMaterial);
        windowMesh.position.set(
          x + (Math.random() - 0.5) * (width - 2),
          2 + Math.random() * (height - 4),
          z + (width / 2) + 0.1
        );
        building.add(windowMesh);
      }

      this.scene.add(building);
      this.buildings.push(building);
      this.collisionObjects.push(mesh);
    }
  }

  private createRubble(): void {
    for (let i = 0; i < this.config.rubbleCount; i++) {
      const rubble = new THREE.Group();

      const size = 0.5 + Math.random() * 2;
      const geometry = new THREE.BoxGeometry(size, size, size);
      const material = new THREE.MeshStandardMaterial({
        color: 0x4a4a4a,
        roughness: 0.9,
        metalness: 0.1,
      });
      const mesh = new THREE.Mesh(geometry, material);

      const x = (Math.random() - 0.5) * (this.config.size - 10);
      const z = (Math.random() - 0.5) * (this.config.size - 10);

      mesh.position.set(x, size / 2, z);
      mesh.rotation.set(
        Math.random() * Math.PI,
        Math.random() * Math.PI,
        Math.random() * Math.PI
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      rubble.add(mesh);

      this.scene.add(rubble);
      this.rubble.push(rubble);
      this.collisionObjects.push(mesh);
    }
  }

  private createDebris(): void {
    const debrisGeometry = new THREE.DodecahedronGeometry(0.3, 0);
    const debrisMaterial = new THREE.MeshStandardMaterial({
      color: 0x3a3a3a,
      roughness: 0.9,
    });

    for (let i = 0; i < 100; i++) {
      const debris = new THREE.Mesh(debrisGeometry, debrisMaterial);
      const x = (Math.random() - 0.5) * this.config.size;
      const z = (Math.random() - 0.5) * this.config.size;
      debris.position.set(x, 0.15, z);
      debris.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
      debris.castShadow = true;
      this.scene.add(debris);
    }
  }

  private createStreets(): void {
    const streetGeometry = new THREE.PlaneGeometry(this.config.streetWidth, this.config.size);
    const streetMaterial = new THREE.MeshStandardMaterial({
      color: 0x3a3a3a,
      roughness: 0.95,
      metalness: 0.05,
    });

    const street1 = new THREE.Mesh(streetGeometry, streetMaterial);
    street1.rotation.x = -Math.PI / 2;
    street1.position.set(0, .01, 0);
    street1.receiveShadow = true;
    this.scene.add(street1);

    const street2 = new THREE.Mesh(streetGeometry, streetMaterial);
    street2.rotation.x = -Math.PI / 2;
    street2.rotation.z = Math.PI / 2;
    street2.position.set(0, .01, 0);
    street2.receiveShadow = true;
    this.scene.add(street2);
  }

  private createAtmosphere(): void {
    const fogColor = new THREE.Color(0x7a7a7a);
    this.scene.fog = new THREE.Fog(fogColor, 20, 80);
    this.scene.background = new THREE.Color(0x5a5a5a);

    const ambientLight = new THREE.AmbientLight(0x404040, 0.4);
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(50, 100, 50);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 200;
    directionalLight.shadow.camera.left = -60;
    directionalLight.shadow.camera.right = 60;
    directionalLight.shadow.camera.top = 60;
    directionalLight.shadow.camera.bottom = -60;
    this.scene.add(directionalLight);

    for (let i = 0; i < 5; i++) {
      const pointLight = new THREE.PointLight(0xffaa00, 0.5, 20);
      pointLight.position.set(
        (Math.random() - 0.5) * this.config.size,
        3,
        (Math.random() - 0.5) * this.config.size
      );
      this.scene.add(pointLight);
    }
  }

  getCollisionObjects(): THREE.Object3D[] {
    return this.collisionObjects;
  }

  getSpawnPoints(): { x: number; y: number; z: number }[] {
    const spawnPoints: { x: number; y: number; z: number }[] = [];
    const radius = this.config.size / 2 - 10;

    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      spawnPoints.push({
        x: Math.cos(angle) * radius,
        y: 1.7,
        z: Math.sin(angle) * radius,
      });
    }

    return spawnPoints;
  }

  dispose(): void {
    this.buildings.forEach(building => {
      this.scene.remove(building);
    });
    this.rubble.forEach(rubble => {
      this.scene.remove(rubble);
    });
    if (this.ground) {
      this.scene.remove(this.ground);
    }
    this.buildings = [];
    this.rubble = [];
    this.collisionObjects = [];
  }
}
