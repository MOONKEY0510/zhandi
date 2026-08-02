import * as THREE from 'three';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { PlayerController } from '../player/PlayerController';
import { InputManager } from '../input/InputManager';
import { NetworkManager } from '../network/NetworkManager';
import type { NetworkMessage, PlayerUpdate } from '../network/WebSocketClient';

export class GameScene {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private physicsWorld: PhysicsWorld;
  private player: PlayerController | null = null;
  private inputManager: InputManager;
  private networkManager: NetworkManager | null = null;
  private remotePlayerMeshes: Map<string, THREE.Group> = new Map();
  private lastTime = 0;
  private animationId = 0;
  private lastNetworkUpdate = 0;
  private networkUpdateInterval = 50;

  constructor(container: HTMLElement) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87CEEB);
    this.scene.fog = new THREE.Fog(0x87CEEB, 10, 100);

    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.inputManager = new InputManager();
    this.physicsWorld = new PhysicsWorld();

    this.setupLights();
    this.setupEnvironment();

    window.addEventListener('resize', this.onResize);
  }

  async init(): Promise<void> {
    this.physicsWorld = await PhysicsWorld.init();
    this.physicsWorld.createGround(100);

    this.player = new PlayerController(this.physicsWorld, this.camera);

    this.inputManager.init();
    this.inputManager.requestPointerLock();

    this.lastTime = performance.now();
    this.animate(this.lastTime);
  }

  async connectToServer(wsUrl: string, playerId: string): Promise<void> {
    this.networkManager = new NetworkManager(wsUrl, playerId);

    this.networkManager.onMessage((msg: NetworkMessage) => {
      switch (msg.type) {
        case 'update': {
          const update = msg.data as PlayerUpdate;
          if (update.id !== playerId) {
            this.updateRemotePlayer(update);
          }
          break;
        }
        case 'leave': {
          const leaveData = msg.data as { id: string };
          this.removeRemotePlayer(leaveData.id);
          break;
        }
      }
    });

    await this.networkManager.connect();
    console.log('Connected to server');
  }

  private updateRemotePlayer(update: PlayerUpdate): void {
    let mesh = this.remotePlayerMeshes.get(update.id);
    if (!mesh) {
      mesh = this.createRemotePlayerMesh();
      this.remotePlayerMeshes.set(update.id, mesh);
      this.scene.add(mesh);
    }

    mesh.position.set(update.x, update.y, update.z);
    mesh.rotation.y = update.yaw;
  }

  private removeRemotePlayer(id: string): void {
    const mesh = this.remotePlayerMeshes.get(id);
    if (mesh) {
      this.scene.remove(mesh);
      this.remotePlayerMeshes.delete(id);
    }
  }

  private createRemotePlayerMesh(): THREE.Group {
    const group = new THREE.Group();

    const bodyGeometry = new THREE.CapsuleGeometry(0.4, 1.0, 4, 8);
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xff0000 });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.position.y = 0.85;
    body.castShadow = true;
    group.add(body);

    const headGeometry = new THREE.SphereGeometry(0.25, 8, 8);
    const headMaterial = new THREE.MeshStandardMaterial({ color: 0xff0000 });
    const head = new THREE.Mesh(headGeometry, headMaterial);
    head.position.y = 1.6;
    head.castShadow = true;
    group.add(head);

    return group;
  }

  private setupLights(): void {
    const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
    this.scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
    dirLight.position.set(50, 100, 50);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 200;
    dirLight.shadow.camera.left = -50;
    dirLight.shadow.camera.right = 50;
    dirLight.shadow.camera.top = 50;
    dirLight.shadow.camera.bottom = -50;
    this.scene.add(dirLight);
  }

  private setupEnvironment(): void {
    const groundGeometry = new THREE.PlaneGeometry(100, 100);
    const groundMaterial = new THREE.MeshStandardMaterial({
      color: 0x4a6741,
      roughness: 0.8,
      metalness: 0.1,
    });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const boxGeometry = new THREE.BoxGeometry(2, 2, 2);
    const boxMaterial = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
    for (let i = 0; i < 10; i++) {
      const box = new THREE.Mesh(boxGeometry, boxMaterial);
      box.position.set(
        (Math.random() - 0.5) * 40,
        1,
        (Math.random() - 0.5) * 40
      );
      box.castShadow = true;
      box.receiveShadow = true;
      this.scene.add(box);
    }

    const treeGeometry = new THREE.ConeGeometry(1, 4, 8);
    const treeMaterial = new THREE.MeshStandardMaterial({ color: 0x228B22 });
    for (let i = 0; i < 20; i++) {
      const tree = new THREE.Mesh(treeGeometry, treeMaterial);
      tree.position.set(
        (Math.random() - 0.5) * 80,
        2,
        (Math.random() - 0.5) * 80
      );
      tree.castShadow = true;
      this.scene.add(tree);
    }
  }

  private animate = (time: number): void => {
    this.animationId = requestAnimationFrame(this.animate);

    const dt = Math.min((time - this.lastTime) / 1000, 0.1);
    this.lastTime = time;

    if (this.player) {
      const mouseMovement = this.inputManager.getMouseMovement();
      this.player.update(this.inputManager.state, mouseMovement, dt);

      if (this.networkManager && time - this.lastNetworkUpdate > this.networkUpdateInterval) {
        const pos = this.player.getPosition();
        const rot = this.player.getRotation();
        if (pos) {
          this.networkManager.sendPosition(pos.x, pos.y, pos.z, rot.yaw, rot.pitch);
          this.lastNetworkUpdate = time;
        }
      }
    }

    this.physicsWorld.step(dt);
    this.renderer.render(this.scene, this.camera);
  };

  private onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  dispose(): void {
    cancelAnimationFrame(this.animationId);
    window.removeEventListener('resize', this.onResize);
    this.inputManager.dispose();
    this.networkManager?.disconnect();
    this.renderer.dispose();
  }
}
