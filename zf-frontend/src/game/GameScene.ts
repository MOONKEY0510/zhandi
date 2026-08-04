import * as THREE from 'three';
import { loadGameSettings, resolveGameConfig, saveGameSettings, validateGameConfig } from '../config';
import { EventBus, FixedStepClock, GameState, GameStateMachine } from '../core';
import { gameplayRandom, useGameplaySeed, useSystemRandom } from '../core/Random';
import { PerformanceMonitor, PerformancePanel } from '../performance';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { PlayerController } from '../player/PlayerController';
import { InputManager } from '../input/InputManager';
import { NetworkManager } from '../network/NetworkManager';
import type { NetworkMessage, PlayerUpdate } from '../network/WebSocketClient';
import { WeaponSystem, WeaponType, FireMode } from '../weapons/WeaponSystem';
import { WeaponView } from '../weapons/WeaponView';
import { MuzzleFlash } from '../weapons/MuzzleFlash';
import { Raycast, calculateDamage } from '../weapons/Bullet';
import { HUD } from '../ui/HUD';
import { MainMenu } from '../ui/MainMenu';
import { SettingsMenu, type GameSettings } from '../ui/SettingsMenu';
import { Scoreboard } from '../ui/Scoreboard';
import { DeploymentMenu } from '../ui/DeploymentMenu';
import { HealthSystem } from '../player/HealthSystem';
import { RespawnSystem } from '../player/RespawnSystem';
import type { SoldierClassDefinition } from '../player/SoldierClass';
import { AISystem, AIBot } from '../ai/AIBot';
import { AudioSystem, SoundType } from '../audio/AudioSystem';
import { MapManager } from '../maps/MapManager';
import { EquipmentSystem, EquipmentType } from '../equipment/TacticalEquipment';
import { VehicleSystem, VehicleType } from '../vehicle/VehicleSystem';
import { WeatherSystem, WeatherType } from '../environment/WeatherSystem';
import type { GameEvents } from './GameEvents';
import { GameMode, GameModeType } from './GameMode';
import { ConquestPresenter } from './ConquestPresenter';
import { AchievementSystem, AchievementType } from './AchievementSystem';
import { ConquestMode, TeamId } from './ConquestMode';
import { RoundFlow, RoundPhase } from './RoundFlow';

const WEAPON_ORDER: WeaponType[] = [
  WeaponType.ASSAULT_RIFLE,
  WeaponType.SMG,
  WeaponType.LMG,
  WeaponType.BOLT_RIFLE,
];

const EQUIPMENT_ORDER: EquipmentType[] = [
  EquipmentType.FRAG_GRENADE,
  EquipmentType.SMOKE_GRENADE,
  EquipmentType.FLASHBANG,
];

interface Tracer { line: THREE.Line; life: number; maxLife: number; }
interface Impact { mesh: THREE.Mesh; life: number; maxLife: number; }

export class GameScene {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private container: HTMLElement;
  private readonly config = resolveGameConfig();
  private readonly stateMachine = new GameStateMachine();
  private readonly events = new EventBus<GameEvents>();
  private readonly simulationClock: FixedStepClock;
  private readonly performanceMonitor: PerformanceMonitor;
  private readonly performancePanel: PerformancePanel;
  private lastPerformanceCapture = 0;
  private physicsWorld!: PhysicsWorld;
  private player: PlayerController | null = null;
  private inputManager: InputManager;
  private networkManager: NetworkManager | null = null;
  private remotePlayerMeshes: Map<string, THREE.Group> = new Map();

  // 武器
  private weaponSystem!: WeaponSystem;
  private weaponView!: WeaponView;
  private muzzleFlash!: MuzzleFlash;
  private raycast!: Raycast;

  // UI
  private hud!: HUD;
  private mainMenu!: MainMenu;
  private settingsMenu!: SettingsMenu;
  private scoreboard!: Scoreboard;
  private deploymentMenu!: DeploymentMenu;
  private selectedClass: SoldierClassDefinition | null = null;

  // 生命与重生
  private healthSystem!: HealthSystem;
  private respawnSystem!: RespawnSystem;

  // AI
  private aiSystem!: AISystem;

  // 音频
  private audioSystem!: AudioSystem;

  // 地图
  private mapManager!: MapManager;

  // 战术装备
  private equipmentSystem!: EquipmentSystem;
  private currentEquipmentIndex = 0;

  // 载具
  private vehicleSystem!: VehicleSystem;
  private inVehicle = false;
  private currentVehicle: { vehicle: import('../vehicle/VehicleSystem').Vehicle; isDriver: boolean } | null = null;

  // 天气
  private weatherSystem!: WeatherSystem;
  private ambientLight!: THREE.AmbientLight;
  private dirLight!: THREE.DirectionalLight;

  // 游戏模式 & 成就
  private gameMode!: GameMode;
  private achievementSystem!: AchievementSystem;
  private playerId: string;

  // 征服模式
  private conquestMode!: ConquestMode;
  private conquestPresenter!: ConquestPresenter;
  private roundFlow = new RoundFlow({ deploymentSeconds: 0, countdownSeconds: 5, resultsSeconds: 12 });
  private controlPointMeshes: THREE.Mesh[] = [];

  // 环境物体
  private environmentObjects: THREE.Object3D[] = [];

  // 特效池
  private tracers: Tracer[] = [];
  private tracerMaterial = new THREE.LineBasicMaterial({
    color: 0xffdd44, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending,
  });
  private impacts: Impact[] = [];
  private impactGeometry = new THREE.CircleGeometry(0.15, 8);
  private impactMaterial = new THREE.MeshBasicMaterial({
    color: 0x000000, transparent: true, opacity: 0.8, side: THREE.DoubleSide,
  });

  // 火花特效池
  private sparkEffects: THREE.Points[] = [];

  // 血液特效池
  private bloodParticles: THREE.Points[] = [];
  private lastDamageDirection: number | null = null;
  private lastDamageDirectionTime = 0;
  private lastScoreboardUpdate = 0;

  // 爆炸/烟雾特效池
  private explosionEffects: (THREE.Mesh | THREE.Points)[] = [];

  // 伤害数字
  private damageNumbers: THREE.Sprite[] = [];

  // AI 血条
  private aiHealthBars: Map<AIBot, THREE.Sprite> = new Map();

  // 状态
  private animationId = 0;
  private simulationTimeMs = 0;
  private pendingMouseMovement = { x: 0, y: 0 };
  private lastNetworkUpdate = 0;
  private networkUpdateInterval = this.config.network.updateIntervalMs;
  private killCount = 0;
  private deathCount = 0;
  private hitMarkerTime = 0;
  private hitMarkerHeadshotTime = 0;
  private lastFootstepTime = 0;
  private footstepInterval = 350;

  // 复用向量
  private tmpVec1 = new THREE.Vector3();
  private tmpVec2 = new THREE.Vector3();
  private tmpVec3 = new THREE.Vector3();

  private deathOverlay: HTMLElement | null = null;

  constructor(container: HTMLElement) {
    this.container = container;

    const configErrors = validateGameConfig(this.config);
    if (configErrors.length > 0) {
      throw new Error(`Invalid game config: ${configErrors.join(', ')}`);
    }

    if (this.config.benchmark.enabled) useGameplaySeed(this.config.benchmark.seed);
    else useSystemRandom();
    this.playerId = 'player_' + gameplayRandom().toString(36).substring(2, 8);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87CEEB);
    this.scene.fog = new THREE.Fog(0x87CEEB, 20, 120);

    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.simulationClock = new FixedStepClock({
      stepSeconds: 1 / this.config.simulation.stepHz,
      maxFrameSeconds: this.config.simulation.maxFrameSeconds,
      maxSubSteps: this.config.simulation.maxSubSteps,
    });
    this.performanceMonitor = new PerformanceMonitor(this.config.performance.sampleWindowSize);
    this.performancePanel = new PerformancePanel(this.performanceMonitor);
    this.performancePanel.setVisible(this.config.benchmark.enabled);
    this.setupGameEvents();
    this.setupRoundFlow();

    this.scene.add(this.camera);
    this.inputManager = new InputManager();

    this.setupLights();
    this.setupDeathOverlay();

    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  private setupRoundFlow(): void {
    this.roundFlow.onPhaseChange = (phase) => {
      const labels: Record<RoundPhase, string> = {
        [RoundPhase.DEPLOYMENT]: '部署阶段',
        [RoundPhase.COUNTDOWN]: '战斗即将开始',
        [RoundPhase.COMBAT]: '战斗开始',
        [RoundPhase.RESULTS]: '回合结算',
      };
      this.events.emit('ui:message', { text: labels[phase], time: this.simulationTimeMs });
    };
    this.roundFlow.onRestart = () => {
      this.conquestMode?.reset();
      this.selectedClass = null;
      this.deploymentMenu?.show();
      if (this.stateMachine.is(GameState.ROUND_END)) this.stateMachine.transition(GameState.PAUSED);
    };
  }

  private setupGameEvents(): void {
    this.events.on('ui:message', ({ text, time }) => {
      this.hud?.addKillMessage(text, time);
    });
    this.events.on('combat:kill', ({ label, headshot, victimTeam, time }) => {
      this.killCount++;
      this.events.emit('ui:message', { text: label, time });
      this.conquestMode?.onAIDeath(victimTeam);
      this.gameMode?.addKill(this.playerId, 'bot');
      this.achievementSystem?.updateProgress(this.playerId, AchievementType.KILLS, 1);
      if (headshot) this.achievementSystem?.updateProgress(this.playerId, AchievementType.HEADSHOTS, 1);
    });
    this.events.on('player:death', ({ team }) => {
      this.deathCount++;
      this.conquestMode?.onPlayerDeath(team);
    });
    this.events.on('round:end', ({ winnerName, time }) => {
      this.events.emit('ui:message', { text: `游戏结束！${winnerName} 获胜！`, time });
      this.roundFlow.finishRound();
      if (this.stateMachine.is(GameState.PLAYING)) this.stateMachine.transition(GameState.ROUND_END);
    });
  }

  async init(): Promise<void> {
    // 主菜单
    this.mainMenu = new MainMenu();
    this.settingsMenu = new SettingsMenu();
    this.scoreboard = new Scoreboard();
    this.deploymentMenu = new DeploymentMenu();
    this.deploymentMenu.onDeploy = (definition) => this.deployAs(definition);

    this.mainMenu.onPlay = () => {
      this.mainMenu.hide();
      this.startGame();
    };
    this.mainMenu.onSettings = () => {
      this.settingsMenu.show();
    };
    this.mainMenu.onQuit = () => {
      window.close();
    };

    this.settingsMenu.onApply = (settings: GameSettings) => {
      this.applySettings(settings);
      this.resumeFromSettings();
    };
    this.settingsMenu.onCancel = () => {
      this.resumeFromSettings();
    };

    this.stateMachine.transition(GameState.MENU);
    this.animate(performance.now());
  }

  private async startGame(): Promise<void> {
    if (!this.stateMachine.is(GameState.MENU)) return;
    this.stateMachine.transition(GameState.LOADING);

    try {
      await this.initializeGameWorld();
    } catch (error) {
      console.error('Failed to initialize game world', error);
      this.stateMachine.transition(GameState.MENU);
      this.mainMenu.show();
    }
  }

  private async initializeGameWorld(): Promise<void> {
    // 物理
    this.physicsWorld = await PhysicsWorld.init();
    this.physicsWorld.createGround(120);

    // 地图 - 柏林废墟
    this.mapManager = new MapManager(this.scene);
    this.mapManager.loadMap('berlin_ruins');
    this.environmentObjects = this.mapManager.getCollisionObjects();

    // 玩家
    this.player = new PlayerController(this.physicsWorld, this.camera);
    this.player.applySettings(loadGameSettings());
    this.player.onFallDamage = (damage: number) => {
      const time = this.simulationTimeMs;
      this.player?.addShake(0.1, 5);
      if (this.healthSystem.takeDamage(damage, time)) {
        this.handlePlayerDeath(time);
      }
      this.hud.showDamageIndicator();
    };

    // 武器
    this.weaponSystem = new WeaponSystem();
    this.weaponView = new WeaponView(this.scene, this.camera);
    this.muzzleFlash = new MuzzleFlash(this.scene, this.camera);
    this.raycast = new Raycast(this.camera);
    this.weaponView.equipWeapon(this.weaponSystem.getCurrentWeapon());

    // 相机后坐力回调
    this.weaponView.onCameraRecoil = (pitch, yaw) => {
      this.player?.addCameraRecoil(pitch, yaw);
    };

    // 天空盒
    this.setupSkybox();

    // HUD
    this.hud = new HUD();

    // 生命与重生
    this.healthSystem = new HealthSystem();
    this.respawnSystem = new RespawnSystem();

    // 征服模式（必须在 setupSpawnPoints 之前初始化）
    this.conquestMode = new ConquestMode();
    this.conquestMode.setPlayerTeam(TeamId.ALLIES); // 玩家默认苏军（蓝方）
    AIBot.playerTeam = TeamId.ALLIES; // 设置 AI 的玩家阵营

    this.setupSpawnPoints();

    // AI - 分阵营生成
    const axisSpawn = this.conquestMode.teams.get(TeamId.AXIS)!.spawnPoint;
    const alliesSpawn = this.conquestMode.teams.get(TeamId.ALLIES)!.spawnPoint;
    this.aiSystem = AISystem.createTeamBots(
      this.scene,
      this.config.ai.axisCount,
      this.config.ai.alliesCount,
      axisSpawn,
      alliesSpawn,
      this.conquestMode.playerTeam,
    );
    this.conquestPresenter = new ConquestPresenter(
      this.conquestMode,
      this.healthSystem,
      this.aiSystem.bots,
    );
    this.setupAIHealthBars();
    this.setupAIFireCallback();

    // 据点视觉
    this.setupControlPoints();

    // 音频
    this.audioSystem = new AudioSystem();

    // 战术装备
    this.equipmentSystem = new EquipmentSystem(this.scene);

    // 载具
    this.vehicleSystem = new VehicleSystem(this.scene, this.physicsWorld.world);
    this.spawnVehicles();

    // 天气
    this.weatherSystem = new WeatherSystem(this.scene, this.ambientLight, this.dirLight);
    this.weatherSystem.setWeather(this.config.benchmark.weather);
    this.weatherSystem.enableDayNightCycle(
      this.config.benchmark.enabled ? this.config.benchmark.dayNightCycle : true,
    );
    this.weatherSystem.enableAutoWeather(
      this.config.benchmark.enabled ? this.config.benchmark.autoWeather : true,
    );

    // 游戏模式 (TDM - 用于击杀统计)
    this.gameMode = new GameMode(GameModeType.TDM);
    this.gameMode.teams.set('A', { id: 'A', name: '德军', color: '#ff4444', score: 0, players: [] });
    this.gameMode.teams.set('B', { id: 'B', name: '苏军', color: '#4488ff', score: 0, players: [] });
    this.gameMode.addPlayer(this.playerId, '玩家', 'B');
    this.gameMode.start();

    // 成就
    this.achievementSystem = new AchievementSystem();
    this.achievementSystem.addPlayer(this.playerId);

    // 输入
    this.inputManager.init();
    this.setupInputCallbacks();

    this.simulationTimeMs = performance.now();
    this.simulationClock.reset(this.simulationTimeMs);
    this.stateMachine.transition(GameState.PAUSED);
    this.deploymentMenu.show();

    // 尝试连接服务器
    try {
      await this.connectToServer(this.config.network.serverUrl, this.playerId);
    } catch (error) {
      console.warn('Running in offline mode', error);
    }
  }

  private deployAs(definition: SoldierClassDefinition): void {
    this.selectedClass = definition;
    this.weaponSystem.switchWeapon(definition.primaryWeapon);
    this.weaponView.equipWeapon(this.weaponSystem.getCurrentWeapon());
    this.currentEquipmentIndex = 0;
    this.deploymentMenu.hide();
    if (this.stateMachine.is(GameState.PAUSED)) this.stateMachine.transition(GameState.PLAYING);
    this.roundFlow.update(0);
    this.simulationClock.reset(performance.now());
    this.inputManager.requestPointerLock();
    this.events.emit('ui:message', {
      text: `已部署为${definition.name}：${definition.role}`,
      time: this.simulationTimeMs,
    });
  }

  private spawnVehicles(): void {
    const spawnPositions = [
      new THREE.Vector3(15, 1, 15),
      new THREE.Vector3(-15, 1, -15),
    ];
    const vehicleCount = Math.min(this.config.benchmark.vehicleCount, spawnPositions.length);

    for (let index = 0; index < vehicleCount; index++) {
      this.vehicleSystem.spawnVehicle(VehicleType.JEEP, spawnPositions[index]);
    }
  }

  private setupInputCallbacks(): void {
    this.inputManager.onWeaponSwitch((slot) => {
      const allowedWeapons = this.selectedClass ? [this.selectedClass.primaryWeapon] : WEAPON_ORDER;
      if (slot < allowedWeapons.length) {
        this.weaponSystem.switchWeapon(allowedWeapons[slot]);
        this.weaponView.equipWeapon(this.weaponSystem.getCurrentWeapon());
        this.audioSystem.play(SoundType.UI_CLICK);
      }
    });

    this.inputManager.onReloadPressed(() => {
      const time = this.simulationTimeMs;
      if (this.weaponSystem.reload(time)) {
        this.audioSystem.play(SoundType.RELOAD);
      }
    });

    this.inputManager.onGrenade(() => {
      this.throwEquipment();
    });

    this.inputManager.onEquipmentSwitch((slot) => {
      if (slot < EQUIPMENT_ORDER.length) {
        this.currentEquipmentIndex = slot;
        this.audioSystem.play(SoundType.UI_CLICK);
      }
    });

    this.inputManager.onVehicleToggle(() => {
      this.toggleVehicle();
    });

    this.inputManager.onScoreboard((visible) => {
      if (visible) this.scoreboard.show();
      else this.scoreboard.hide();
    });

    this.inputManager.onEscape(() => {
      if (this.stateMachine.is(GameState.PAUSED)) {
        this.settingsMenu.hide();
        this.stateMachine.transition(GameState.PLAYING);
        this.simulationClock.reset(performance.now());
        this.inputManager.requestPointerLock();
      } else if (this.stateMachine.is(GameState.PLAYING)) {
        this.settingsMenu.show();
        this.stateMachine.transition(GameState.PAUSED);
        document.exitPointerLock();
      }
    });

    this.inputManager.onWeatherToggle(() => {
      const weathers = Object.values(WeatherType);
      const current = this.weatherSystem.getCurrentWeather();
      const idx = weathers.indexOf(current);
      this.weatherSystem.setWeather(weathers[(idx + 1) % weathers.length]);
    });
  }

  private resumeFromSettings(): void {
    this.settingsMenu.hide();
    if (this.stateMachine.is(GameState.PAUSED)) {
      this.stateMachine.transition(GameState.PLAYING);
      this.simulationClock.reset(performance.now());
      this.inputManager.requestPointerLock();
    }
  }

  private applySettings(settings: GameSettings): void {
    const savedSettings = saveGameSettings(settings);
    this.audioSystem?.setVolume(savedSettings.volume / 100);
    this.player?.applySettings(savedSettings);
    // 灵敏度和画质可以在此应用
    if (savedSettings.graphics === 'low') {
      this.renderer.setPixelRatio(1);
      this.renderer.shadowMap.enabled = false;
    } else if (savedSettings.graphics === 'high') {
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      this.renderer.shadowMap.enabled = true;
    }
  }

  private setupDeathOverlay(): void {
    const overlay = document.createElement('div');
    overlay.id = 'death-overlay';
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(150, 0, 0, 0.4); z-index: 200;
      display: none; align-items: center; justify-content: center;
      pointer-events: none; font-family: 'Arial', sans-serif;
    `;
    overlay.innerHTML = `
      <div style="text-align: center; color: white;">
        <div style="font-size: 48px; font-weight: bold; text-shadow: 2px 2px 8px rgba(0,0,0,0.8);">你已阵亡</div>
        <div id="respawn-timer" style="font-size: 24px; margin-top: 15px; text-shadow: 2px 2px 4px rgba(0,0,0,0.8);">3 秒后重生...</div>
      </div>
    `;
    document.body.appendChild(overlay);
    this.deathOverlay = overlay;
  }

  private setupSpawnPoints(): void {
    // 使用阵营出生点
    const spawnPoint = this.conquestMode.getPlayerSpawnPoint();
    const points = [
      { position: spawnPoint.clone() },
      { position: spawnPoint.clone().add(new THREE.Vector3(3, 0, 3)) },
      { position: spawnPoint.clone().add(new THREE.Vector3(-3, 0, -3)) },
    ];
    this.respawnSystem.setSpawnPoints(points);
  }

  private setupControlPoints(): void {
    for (const point of this.conquestMode.controlPoints) {
      // 据点圆圈
      const ringGeo = new THREE.RingGeometry(point.radius - 0.5, point.radius, 32);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0x888888, transparent: true, opacity: 0.5, side: THREE.DoubleSide,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.copy(point.position);
      ring.position.y = 0.1;
      this.scene.add(ring);
      this.controlPointMeshes.push(ring);

      // 据点旗帜/标记
      const flagGeo = new THREE.CylinderGeometry(0.1, 0.1, 4, 8);
      const flagMat = new THREE.MeshStandardMaterial({ color: 0x888888 });
      const flag = new THREE.Mesh(flagGeo, flagMat);
      flag.position.copy(point.position);
      flag.position.y = 2;
      this.scene.add(flag);

      // 据点标签
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext('2d')!;
      ctx.font = 'bold 48px Arial';
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(point.id, 32, 32);
      const texture = new THREE.CanvasTexture(canvas);
      const spriteMat = new THREE.SpriteMaterial({ map: texture, depthTest: false });
      const sprite = new THREE.Sprite(spriteMat);
      sprite.scale.set(2, 2, 1);
      sprite.position.copy(point.position);
      sprite.position.y = 5;
      this.scene.add(sprite);
    }
  }

  private updateControlPointVisuals(): void {
    const points = this.conquestMode.controlPoints;
    for (let i = 0; i < points.length && i < this.controlPointMeshes.length; i++) {
      const point = points[i];
      const mesh = this.controlPointMeshes[i];
      const mat = mesh.material as THREE.MeshBasicMaterial;

      if (point.owner === TeamId.AXIS) {
        mat.color.setHex(0xff4444);
      } else if (point.owner === TeamId.ALLIES) {
        mat.color.setHex(0x4488ff);
      } else {
        mat.color.setHex(0x888888);
      }
    }
  }

  private updateConquestMode(dt: number, currentTime: number): void {
    if (this.conquestMode.isGameOver) return;

    this.conquestPresenter.update(dt, this.player?.getPosition() ?? null);

    // 检查游戏结束
    if (this.conquestMode.isGameOver && this.conquestMode.winner) {
      const winnerName = this.conquestMode.winner === TeamId.AXIS ? '德军' : '苏军';
      this.events.emit('round:end', {
        winner: this.conquestMode.winner,
        winnerName,
        time: currentTime,
      });
    }
  }

  private setupAIHealthBars(): void {
    for (const bot of this.aiSystem.bots) {
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 8;
      const texture = new THREE.CanvasTexture(canvas);
      const material = new THREE.SpriteMaterial({ map: texture, depthTest: false });
      const sprite = new THREE.Sprite(material);
      sprite.scale.set(1.2, 0.15, 1);
      sprite.position.y = 2.2;
      sprite.visible = false;
      bot.mesh.add(sprite);
      this.aiHealthBars.set(bot, sprite);
    }
  }

  private updateAIHealthBars(currentTime: number): void {
    for (const bot of this.aiSystem.bots) {
      const sprite = this.aiHealthBars.get(bot);
      if (!sprite) continue;
      if (bot.state === 'dead') { sprite.visible = false; continue; }

      const sinceDamage = currentTime - bot.lastDamageTime;
      if (sinceDamage < 3000) {
        sprite.visible = true;
        const canvas = (sprite.material.map as THREE.CanvasTexture).image as HTMLCanvasElement;
        const ctx = canvas.getContext('2d')!;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const pct = bot.health / bot.maxHealth;
        ctx.fillStyle = pct > 0.5 ? '#33ff33' : pct > 0.25 ? '#ffcc00' : '#ff3333';
        ctx.fillRect(1, 1, (canvas.width - 2) * pct, canvas.height - 2);
        (sprite.material.map as THREE.CanvasTexture).needsUpdate = true;
        const fadeAlpha = sinceDamage > 2000 ? 1 - (sinceDamage - 2000) / 1000 : 1;
        (sprite.material as THREE.SpriteMaterial).opacity = fadeAlpha;
      } else {
        sprite.visible = false;
      }
    }
  }

  async connectToServer(wsUrl: string, playerId: string): Promise<void> {
    this.networkManager = new NetworkManager(wsUrl, playerId);
    this.networkManager.onMessage((msg: NetworkMessage) => {
      switch (msg.type) {
        case 'update': {
          const update = msg.data as PlayerUpdate;
          if (update.id !== playerId) this.updateRemotePlayer(update);
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
    if (mesh) { this.scene.remove(mesh); this.remotePlayerMeshes.delete(id); }
  }

  private createRemotePlayerMesh(): THREE.Group {
    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.4, 1.0, 4, 8),
      new THREE.MeshStandardMaterial({ color: 0xff0000 })
    );
    body.position.y = 0.85; body.castShadow = true;
    group.add(body);
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.25, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0xff0000 })
    );
    head.position.y = 1.6; head.castShadow = true;
    group.add(head);
    return group;
  }

  private setupLights(): void {
    this.ambientLight = new THREE.AmbientLight(0x404040, 0.6);
    this.scene.add(this.ambientLight);

    this.dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
    this.dirLight.position.set(50, 100, 50);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.width = 2048;
    this.dirLight.shadow.mapSize.height = 2048;
    this.dirLight.shadow.camera.near = 0.5;
    this.dirLight.shadow.camera.far = 200;
    this.dirLight.shadow.camera.left = -60;
    this.dirLight.shadow.camera.right = 60;
    this.dirLight.shadow.camera.top = 60;
    this.dirLight.shadow.camera.bottom = -60;
    this.scene.add(this.dirLight);
  }

  private setupSkybox(): void {
    // 渐变天空球
    const skyGeo = new THREE.SphereGeometry(400, 32, 32);
    const skyMat = new THREE.ShaderMaterial({
      uniforms: {
        topColor: { value: new THREE.Color(0x0077ff) },
        bottomColor: { value: new THREE.Color(0xffffff) },
        offset: { value: 20 },
        exponent: { value: 0.6 },
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 bottomColor;
        uniform float offset;
        uniform float exponent;
        varying vec3 vWorldPosition;
        void main() {
          float h = normalize(vWorldPosition + vec3(0.0, offset, 0.0)).y;
          gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h, 0.0), exponent), 0.0)), 1.0);
        }
      `,
      side: THREE.BackSide,
    });
    const sky = new THREE.Mesh(skyGeo, skyMat);
    this.scene.add(sky);
  }

  // ====== 爆炸特效 ======
  private spawnExplosionEffect(position: THREE.Vector3): void {
    // 火球
    const fireGeo = new THREE.SphereGeometry(0.5, 8, 8);
    const fireMat = new THREE.MeshBasicMaterial({
      color: 0xff6600, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending,
    });
    const fire = new THREE.Mesh(fireGeo, fireMat);
    fire.position.copy(position);
    fire.userData.life = 0;
    fire.userData.maxLife = 0.3;
    fire.userData.type = 'explosion';
    this.scene.add(fire);
    this.explosionEffects.push(fire);

    // 碎片粒子
    const count = 30;
    const positions = new Float32Array(count * 3);
    const velocities: THREE.Vector3[] = [];
    for (let i = 0; i < count; i++) {
      positions[i * 3] = position.x;
      positions[i * 3 + 1] = position.y;
      positions[i * 3 + 2] = position.z;
      velocities.push(new THREE.Vector3(
        (gameplayRandom() - 0.5) * 15,
        gameplayRandom() * 10,
        (gameplayRandom() - 0.5) * 15
      ));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xffaa00, size: 0.15, transparent: true, opacity: 1, blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geo, mat);
    points.userData.velocities = velocities;
    points.userData.life = 0;
    points.userData.maxLife = 0.8;
    points.userData.type = 'explosion';
    this.scene.add(points);
    this.explosionEffects.push(points);
  }

  private updateExplosionEffects(dt: number): void {
    for (let i = this.explosionEffects.length - 1; i >= 0; i--) {
      const obj = this.explosionEffects[i];
      const life = obj.userData.life as number;
      const maxLife = obj.userData.maxLife as number;
      obj.userData.life = life + dt;
      const progress = (life + dt) / maxLife;

      if (obj.userData.type === 'explosion' && obj instanceof THREE.Mesh) {
        // 火球膨胀
        const scale = 1 + progress * 8;
        obj.scale.set(scale, scale, scale);
        (obj.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - progress);
      } else if (obj instanceof THREE.Points) {
        // 碎片粒子
        const velocities = obj.userData.velocities as THREE.Vector3[];
        const positions = obj.geometry.attributes.position.array as Float32Array;
        for (let j = 0; j < velocities.length; j++) {
          velocities[j].y -= 9.8 * dt;
          positions[j * 3] += velocities[j].x * dt;
          positions[j * 3 + 1] += velocities[j].y * dt;
          positions[j * 3 + 2] += velocities[j].z * dt;
        }
        obj.geometry.attributes.position.needsUpdate = true;
        (obj.material as THREE.PointsMaterial).opacity = 1 - progress;
      }

      if (progress >= 1) {
        this.scene.remove(obj);
        if (obj instanceof THREE.Mesh || obj instanceof THREE.Points) {
          obj.geometry.dispose();
          (obj.material as THREE.Material).dispose();
        }
        this.explosionEffects.splice(i, 1);
      }
    }
  }

  // ====== 烟雾效果 ======
  private spawnSmokeEffect(position: THREE.Vector3, radius: number): void {
    const count = 40;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const angle = gameplayRandom() * Math.PI * 2;
      const r = gameplayRandom() * radius;
      positions[i * 3] = position.x + Math.cos(angle) * r;
      positions[i * 3 + 1] = position.y + gameplayRandom() * 2;
      positions[i * 3 + 2] = position.z + Math.sin(angle) * r;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0x888888, size: 0.8, transparent: true, opacity: 0.6,
    });
    const points = new THREE.Points(geo, mat);
    points.userData.life = 0;
    points.userData.maxLife = 5;
    points.userData.type = 'smoke';
    this.scene.add(points);
    this.explosionEffects.push(points);
  }

  // ====== 伤害数字 ======
  private spawnDamageNumber(position: THREE.Vector3, damage: number, isHeadshot: boolean): void {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 32;
    const ctx = canvas.getContext('2d')!;
    ctx.font = isHeadshot ? 'bold 24px Arial' : 'bold 18px Arial';
    ctx.fillStyle = isHeadshot ? '#ff4444' : '#ffcc00';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.textAlign = 'center';
    ctx.strokeText(Math.round(damage).toString(), 32, 24);
    ctx.fillText(Math.round(damage).toString(), 32, 24);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture, depthTest: false });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(1, 0.5, 1);
    sprite.position.copy(position);
    sprite.position.y += 0.5;
    sprite.userData.life = 0;
    sprite.userData.maxLife = 0.8;
    sprite.userData.velocity = new THREE.Vector3((gameplayRandom() - 0.5) * 0.5, 2, (gameplayRandom() - 0.5) * 0.5);
    this.scene.add(sprite);
    this.damageNumbers.push(sprite);
  }

  private updateDamageNumbers(dt: number): void {
    for (let i = this.damageNumbers.length - 1; i >= 0; i--) {
      const sprite = this.damageNumbers[i];
      const life = sprite.userData.life as number;
      const maxLife = sprite.userData.maxLife as number;
      const velocity = sprite.userData.velocity as THREE.Vector3;
      sprite.userData.life = life + dt;
      const progress = (life + dt) / maxLife;

      sprite.position.add(velocity.clone().multiplyScalar(dt));
      (sprite.material as THREE.SpriteMaterial).opacity = 1 - progress;

      if (progress >= 1) {
        this.scene.remove(sprite);
        (sprite.material as THREE.SpriteMaterial).map?.dispose();
        sprite.material.dispose();
        this.damageNumbers.splice(i, 1);
      }
    }
  }

  // ====== 战术装备 ======
  private throwEquipment(): void {
    if (this.healthSystem.isDead) return;
    const type = EQUIPMENT_ORDER[this.currentEquipmentIndex];
    const pos = this.camera.getWorldPosition(this.tmpVec1).clone();
    const dir = this.tmpVec2;
    this.camera.getWorldDirection(dir);

    const equipment = this.equipmentSystem.throwEquipment(type, pos, dir.clone(), this.simulationTimeMs);
    if (equipment) {
      this.audioSystem.play(SoundType.UI_CLICK);
      this.hud.addKillMessage(`投掷 ${equipment.config.name}`, this.simulationTimeMs);
    }
  }

  // ====== 载具 ======
  private toggleVehicle(): void {
    if (this.inVehicle && this.currentVehicle) {
      // 下车
      this.currentVehicle.vehicle.exitVehicle(this.playerId);
      this.inVehicle = false;
      this.currentVehicle = null;
      this.hud.addKillMessage('离开载具', this.simulationTimeMs);
    } else {
      // 上车 - 查找附近载具
      const playerPos = this.player?.getPosition();
      if (!playerPos) return;
      const playerVec = this.tmpVec1.set(playerPos.x, playerPos.y, playerPos.z);

      for (const vehicle of this.vehicleSystem.vehicles) {
        if (vehicle.health <= 0) continue;
        const dist = vehicle.mesh.position.distanceTo(playerVec);
        if (dist < 4) {
          const isDriver = !vehicle.isOccupied;
          if (vehicle.enterVehicle(this.playerId, isDriver)) {
            this.inVehicle = true;
            this.currentVehicle = { vehicle, isDriver };
            this.hud.addKillMessage(`进入 ${vehicle.config.name}`, this.simulationTimeMs);
            break;
          }
        }
      }
    }
  }

  private updateVehicleControl(_dt: number): void {
    if (!this.inVehicle || !this.currentVehicle) return;
    const vehicle = this.currentVehicle.vehicle;
    if (!this.currentVehicle.isDriver) return;

    const input = this.inputManager.state;
    let forward = 0;
    let turn = 0;

    if (input.forward) forward = 1;
    if (input.backward) forward = -1;
    if (input.left) turn = 1;
    if (input.right) turn = -1;

    vehicle.drive(forward, turn);

    // 载具武器射击
    if (input.fire) {
      vehicle.fireWeapon();
    }

    // 同步相机到载具
    const vpos = vehicle.mesh.position;
    this.camera.position.set(vpos.x, vpos.y + 3, vpos.z + 6);
    this.camera.lookAt(vpos.x, vpos.y, vpos.z);
  }

  // ====== 射击 ======
  private handleShooting(currentTime: number): void {
    if (this.healthSystem.isDead) return;
    if (this.inVehicle) return; // 载具内用载具武器
    if (!this.inputManager.state.fire) return;

    const weapon = this.weaponSystem.getCurrentWeapon();
    const config = weapon.config;

    if (config.fireMode === FireMode.SINGLE) {
      if (!this.inputManager.consumeFire()) return;
    }

    if (weapon.currentAmmo <= 0) {
      if (currentTime - weapon.lastFireTime > 500) {
        this.audioSystem.play(SoundType.UI_CLICK);
        weapon.lastFireTime = currentTime;
      }
      return;
    }

    if (!this.weaponSystem.fire(currentTime)) return;

    this.muzzleFlash.trigger(currentTime);
    this.weaponView.applyRecoil(config.recoil * weapon.getRecoilMultiplier(currentTime));

    const origin = this.camera.getWorldPosition(this.tmpVec1);
    const direction = this.tmpVec2;
    this.camera.getWorldDirection(direction);

    const moving = this.inputManager.state.forward || this.inputManager.state.backward ||
      this.inputManager.state.left || this.inputManager.state.right;
    const spread = (1 - config.accuracy) * weapon.getSpreadMultiplier(
      moving,
      this.player?.isCrouchActive() ?? false,
    );
    direction.x += (gameplayRandom() - 0.5) * spread * 0.05;
    direction.y += (gameplayRandom() - 0.5) * spread * 0.05;
    direction.normalize();

    const targets = [...this.aiSystem.getAllTargetableMeshes(), ...this.environmentObjects];
    const hitInfo = this.raycast.cast(direction, config.range, targets);

    const endPoint = this.tmpVec3.copy(origin).addScaledVector(direction, config.range);

    if (hitInfo.hit && hitInfo.point) {
      endPoint.copy(hitInfo.point);
      this.processHit(hitInfo, config, currentTime);
      this.spawnImpact(hitInfo.point, hitInfo.normal || direction);
    }

    this.spawnTracer(origin, endPoint);
    this.audioSystem.play(SoundType.GUNSHOT, origin);
  }

  private processHit(
    hitInfo: { point?: THREE.Vector3; distance?: number; target?: THREE.Object3D; isHeadshot?: boolean; bodyPart?: 'head' | 'torso' | 'limb' },
    config: {
      damage: number;
      minDamage: number;
      falloffStart: number;
      falloffEnd: number;
      headshotMultiplier: number;
      range: number;
    },
    currentTime: number
  ): void {
    let hitBot: AIBot | null = null;
    if (hitInfo.target) {
      let obj: THREE.Object3D | null = hitInfo.target;
      while (obj) {
        for (const bot of this.aiSystem.bots) {
          if (obj === bot.mesh) { hitBot = bot; break; }
        }
        if (hitBot) break;
        obj = obj.parent;
      }
    }
    if (!hitBot) return;

    // 阵营检查：只能伤害敌方 AI，不能伤害友军
    if (hitBot.team === this.conquestMode.playerTeam) {
      return; // 友军，不造成伤害
    }

    const distance = hitInfo.distance || 0;
    const damage = calculateDamage(
      {
        baseDamage: config.damage,
        minDamage: config.minDamage,
        falloffStart: config.falloffStart,
        falloffEnd: config.falloffEnd,
        headshotMultiplier: config.headshotMultiplier,
        limbMultiplier: 0.7,
        range: config.range,
      },
      hitInfo.bodyPart || 'torso', distance
    );

    const hitPoint = hitInfo.point || hitBot.mesh.position;
    const killed = hitBot.takeDamage(damage, hitPoint, currentTime);

    this.hitMarkerTime = currentTime;
    if (hitInfo.isHeadshot) {
      this.hitMarkerHeadshotTime = currentTime;
    }
    this.audioSystem.play(SoundType.HIT);

    // 命中反馈：屏幕震动（爆头震动更强）
    this.player?.addShake(hitInfo.isHeadshot ? 0.06 : 0.035, 6);

    // 血液特效（爆头更多血花）
    if (hitPoint) {
      this.spawnBloodEffect(hitPoint, hitInfo.isHeadshot ? 35 : 20);
      this.spawnDamageNumber(hitPoint, damage, hitInfo.isHeadshot || false);
    }

    this.events.emit('combat:hit', {
      damage,
      headshot: hitInfo.isHeadshot || false,
      point: hitPoint.clone(),
      time: currentTime,
    });

    if (killed) {
      const weaponName = this.weaponSystem.getCurrentWeapon().config.name;
      const partLabel = hitInfo.isHeadshot ? '爆头' : '击杀';
      this.events.emit('combat:kill', {
        source: 'weapon',
        label: `${weaponName} ${partLabel} AI Bot`,
        headshot: hitInfo.isHeadshot || false,
        victimTeam: hitBot.team,
        time: currentTime,
      });
      this.audioSystem.play(SoundType.DEATH, hitBot.mesh.position);

      // 检查成就解锁
      const unlocked = this.achievementSystem.getPlayerAchievements(this.playerId).filter(a => a.unlocked);
      for (const ach of unlocked) {
        if (currentTime - (ach.unlockedAt || 0) < 1000) {
          this.hud.addKillMessage(`成就解锁: ${ach.name}`, currentTime);
        }
      }
    }
  }

  // ====== 装备伤害 ======
  private handleEquipmentDamage(currentTime: number): void {
    for (const equip of this.equipmentSystem.getActiveEquipment()) {
      if (equip.config.damage <= 0) continue;
      if (!equip.isActive) continue;

      const elapsed = (currentTime - equip.activationTime) / 1000;
      if (elapsed < equip.config.fuseTime) continue; // 还没爆炸
      if (elapsed > equip.config.fuseTime + 0.5) continue; // 爆炸已处理过

      // 对 AI 造成伤害
      for (const bot of this.aiSystem.bots) {
        if (bot.state === 'dead') continue;
        if (equip.isInEffectArea(bot.mesh.position)) {
          const dist = equip.position.distanceTo(bot.mesh.position);
          const damage = equip.config.damage * Math.max(0.2, 1 - dist / equip.config.radius);
          const killed = bot.takeDamage(damage, bot.mesh.position, currentTime);
          if (killed) {
            this.events.emit('combat:kill', {
              source: 'equipment',
              label: `${equip.config.name} 击杀 AI Bot`,
              headshot: false,
              victimTeam: bot.team,
              time: currentTime,
            });
          }
        }
      }

      // 对玩家造成伤害
      const playerPos = this.player?.getPosition();
      if (playerPos && equip.isInEffectArea(this.tmpVec1.set(playerPos.x, playerPos.y, playerPos.z))) {
        const dist = equip.position.distanceTo(this.tmpVec1);
        const damage = equip.config.damage * 0.5 * Math.max(0.2, 1 - dist / equip.config.radius);
        if (this.healthSystem.takeDamage(damage, currentTime)) {
          this.handlePlayerDeath(currentTime);
        }
      }

      // 爆炸音效 + 屏幕震动 + 特效
      if (equip.config.type === EquipmentType.FRAG_GRENADE && elapsed < equip.config.fuseTime + 0.1) {
        this.audioSystem.play(SoundType.EXPLOSION, equip.position);
        this.spawnExplosionEffect(equip.position.clone());
        // 爆炸屏幕震动
        const playerPos = this.player?.getPosition();
        if (playerPos) {
          const dist = equip.position.distanceTo(this.tmpVec1.set(playerPos.x, playerPos.y, playerPos.z));
          if (dist < 15) {
            this.player?.addShake(0.15 * (1 - dist / 15), 4);
          }
        }
      }

      // 烟雾弹烟雾效果
      if (equip.config.type === EquipmentType.SMOKE_GRENADE && elapsed < equip.config.fuseTime + 0.1) {
        this.spawnSmokeEffect(equip.position.clone(), equip.config.radius);
      }
    }
  }

  // ====== 弹道轨迹 ======
  private spawnTracer(start: THREE.Vector3, end: THREE.Vector3): void {
    const geometry = new THREE.BufferGeometry().setFromPoints([start.clone(), end.clone()]);
    const material = this.tracerMaterial.clone();
    const line = new THREE.Line(geometry, material);
    this.scene.add(line);
    this.tracers.push({ line, life: 0, maxLife: 0.08 });
  }

  private updateTracers(dt: number): void {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life += dt;
      const p = t.life / t.maxLife;
      if (p >= 1) {
        this.scene.remove(t.line);
        t.line.geometry.dispose();
        (t.line.material as THREE.Material).dispose();
        this.tracers.splice(i, 1);
      } else {
        (t.line.material as THREE.LineBasicMaterial).opacity = 0.8 * (1 - p);
      }
    }
  }

  // ====== 弹孔 ======
  private spawnImpact(point: THREE.Vector3, normal: THREE.Vector3): void {
    // 弹孔贴花
    const mesh = new THREE.Mesh(this.impactGeometry, this.impactMaterial.clone());
    mesh.position.copy(point);
    mesh.lookAt(this.tmpVec1.copy(point).add(normal));
    this.scene.add(mesh);
    this.impacts.push({ mesh, life: 0, maxLife: 3 });
    if (this.impacts.length > 30) {
      const old = this.impacts.shift();
      if (old) { this.scene.remove(old.mesh); (old.mesh.material as THREE.Material).dispose(); }
    }

    // 碰撞火花粒子
    this.spawnImpactSpark(point, normal);
  }

  // ====== 碰撞火花 ======
  private sparkGeometry = new THREE.BufferGeometry();
  private sparkMaterial = new THREE.PointsMaterial({
    color: 0xffdd44, size: 0.04, transparent: true, opacity: 1,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });

  private spawnImpactSpark(point: THREE.Vector3, normal: THREE.Vector3): void {
    const count = 8 + Math.floor(gameplayRandom() * 6);
    const positions = new Float32Array(count * 3);
    const velocities: THREE.Vector3[] = [];

    for (let i = 0; i < count; i++) {
      positions[i * 3] = point.x;
      positions[i * 3 + 1] = point.y;
      positions[i * 3 + 2] = point.z;

      // 沿法线方向散射，速度随机
      const theta = gameplayRandom() * Math.PI * 2;
      const phi = gameplayRandom() * Math.PI * 0.4;
      const speed = 2 + gameplayRandom() * 4;
      velocities.push(new THREE.Vector3(
        Math.cos(theta) * Math.sin(phi) * speed + normal.x * 1.5,
        Math.abs(Math.sin(theta) * Math.sin(phi)) * speed + 0.5,
        Math.sin(theta) * Math.sin(phi) * speed + normal.z * 1.5,
      ));
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = this.sparkMaterial.clone();
    const points = new THREE.Points(geo, mat);
    points.userData = { velocities, life: 0, maxLife: 0.4 };
    this.scene.add(points);
    this.sparkEffects.push(points);
  }

  private updateSparks(dt: number): void {
    for (let i = this.sparkEffects.length - 1; i >= 0; i--) {
      const spark = this.sparkEffects[i];
      const life = spark.userData.life as number;
      const maxLife = spark.userData.maxLife as number;
      const velocities = spark.userData.velocities as THREE.Vector3[];
      const positions = spark.geometry.attributes.position.array as Float32Array;

      for (let j = 0; j < velocities.length; j++) {
        velocities[j].y -= 9.8 * dt;
        positions[j * 3] += velocities[j].x * dt;
        positions[j * 3 + 1] += velocities[j].y * dt;
        positions[j * 3 + 2] += velocities[j].z * dt;
      }
      spark.geometry.attributes.position.needsUpdate = true;
      spark.userData.life = life + dt;

      const progress = (life + dt) / maxLife;
      if (progress >= 1) {
        this.scene.remove(spark);
        spark.geometry.dispose();
        (spark.material as THREE.Material).dispose();
        this.sparkEffects.splice(i, 1);
      } else {
        (spark.material as THREE.PointsMaterial).opacity = 1 - progress;
      }
    }
  }

  private updateImpacts(dt: number): void {
    for (let i = this.impacts.length - 1; i >= 0; i--) {
      const imp = this.impacts[i];
      imp.life += dt;
      const p = imp.life / imp.maxLife;
      if (p >= 1) {
        this.scene.remove(imp.mesh);
        (imp.mesh.material as THREE.Material).dispose();
        this.impacts.splice(i, 1);
      } else {
        (imp.mesh.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - p);
      }
    }
  }

  // ====== 血液特效 ======
  private spawnBloodEffect(position: THREE.Vector3, count: number = 20): void {
    const positions = new Float32Array(count * 3);
    const velocities: THREE.Vector3[] = [];

    for (let i = 0; i < count; i++) {
      positions[i * 3] = position.x;
      positions[i * 3 + 1] = position.y;
      positions[i * 3 + 2] = position.z;
      // 向随机方向喷射，速度更快更猛
      const theta = gameplayRandom() * Math.PI * 2;
      const speed = 3 + gameplayRandom() * 6;
      velocities.push(new THREE.Vector3(
        Math.cos(theta) * speed * 0.7,
        Math.abs(Math.sin(theta)) * 2.5 + gameplayRandom() * 3,
        Math.sin(theta) * speed * 0.7
      ));
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: 0xcc0000, size: 0.08, transparent: true, opacity: 0.9,
    });
    const points = new THREE.Points(geometry, material);
    points.userData.velocities = velocities;
    points.userData.life = 0;
    points.userData.maxLife = 0.5;
    this.scene.add(points);
    this.bloodParticles.push(points);
  }

  private updateBloodEffects(dt: number): void {
    for (let i = this.bloodParticles.length - 1; i >= 0; i--) {
      const blood = this.bloodParticles[i];
      const life = blood.userData.life as number;
      const maxLife = blood.userData.maxLife as number;
      const velocities = blood.userData.velocities as THREE.Vector3[];
      const positions = blood.geometry.attributes.position.array as Float32Array;

      for (let j = 0; j < velocities.length; j++) {
        velocities[j].y -= 9.8 * dt;
        positions[j * 3] += velocities[j].x * dt;
        positions[j * 3 + 1] += velocities[j].y * dt;
        positions[j * 3 + 2] += velocities[j].z * dt;
      }

      blood.geometry.attributes.position.needsUpdate = true;
      blood.userData.life = life + dt;

      const progress = (life + dt) / maxLife;
      if (progress >= 1) {
        this.scene.remove(blood);
        blood.geometry.dispose();
        (blood.material as THREE.Material).dispose();
        this.bloodParticles.splice(i, 1);
      } else {
        (blood.material as THREE.PointsMaterial).opacity = 0.9 * (1 - progress);
      }
    }
  }

  // ====== AI 射击回调 ======
  private setupAIFireCallback(): void {
    AIBot.onFire((origin, direction, damage, bot) => {
      const currentTime = this.simulationTimeMs;

      // 阵营检查：只有敌方 AI 才能攻击玩家
      if (bot.team === this.conquestMode.playerTeam) {
        return; // 友军 AI，不攻击玩家
      }

      // AI 射击弹道轨迹（红色）
      this.spawnAIFireTracer(origin, direction, bot);

      // AI 枪声
      this.audioSystem.play(SoundType.GUNSHOT, origin);

      // 射线检测：是否命中玩家
      const playerPos = this.player?.getPosition();
      if (!playerPos || this.healthSystem.isDead) return;

      const playerVec = this.tmpVec1.set(playerPos.x, playerPos.y, playerPos.z);

      // 射线到玩家中心的距离
      const toPlayer = playerVec.clone().sub(origin);
      const projection = toPlayer.dot(direction);
      if (projection < 0 || projection > bot.attackRange) return;

      const closestPoint = origin.clone().add(direction.clone().multiplyScalar(projection));
      const distToRay = closestPoint.distanceTo(playerVec);

      // 命中判定：射线距离玩家中心 < 0.6 米视为命中
      if (distToRay < 0.6) {
        // 命中概率受精度影响
        if (gameplayRandom() > bot.accuracy) return;

        const killed = this.healthSystem.takeDamage(damage, currentTime);
        this.hud.showDamageIndicator();
        this.audioSystem.play(SoundType.HIT);

        // 方向伤害指示器：计算 AI 相对玩家的角度
        const playerPos2 = this.player?.getPosition();
        if (playerPos2) {
          const dx = bot.mesh.position.x - playerPos2.x;
          const dz = bot.mesh.position.z - playerPos2.z;
          const angleToDamage = Math.atan2(dx, dz);
          const playerYaw = this.player!.getRotation().yaw;
          this.lastDamageDirection = angleToDamage - playerYaw + Math.PI;
          this.lastDamageDirectionTime = currentTime;
        }

        // 屏幕震动
        this.player?.addShake(0.05, 3);

        if (killed) {
          this.handlePlayerDeath(currentTime);
        }
      }
    });
  }

  private spawnAIFireTracer(origin: THREE.Vector3, direction: THREE.Vector3, bot: AIBot): void {
    const range = bot.attackRange;
    const endPoint = origin.clone().add(direction.clone().multiplyScalar(range));

    // 检测是否击中环境
    const raycaster = new THREE.Raycaster(origin, direction, 0, range);
    const hits = raycaster.intersectObjects(this.environmentObjects, false);
    if (hits.length > 0) {
      endPoint.copy(hits[0].point);
      this.spawnImpact(hits[0].point, hits[0].face?.normal || direction);
    }

    const geometry = new THREE.BufferGeometry().setFromPoints([origin.clone(), endPoint]);
    const material = new THREE.LineBasicMaterial({
      color: 0xff4422, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending,
    });
    const line = new THREE.Line(geometry, material);
    this.scene.add(line);
    this.tracers.push({ line, life: 0, maxLife: 0.06 });
  }

  // ====== AI 攻击（旧逻辑已由 setupAIFireCallback 替代）=====

  private handlePlayerDeath(currentTime: number): void {
    this.respawnSystem.recordDeath(currentTime);
    this.audioSystem.play(SoundType.DEATH, this.camera.position);
    this.events.emit('ui:message', { text: '你被击杀了', time: currentTime });
    this.events.emit('player:death', { team: this.conquestMode.playerTeam, time: currentTime });
    if (this.deathOverlay) this.deathOverlay.style.display = 'flex';
  }

  private handleRespawn(currentTime: number): void {
    if (!this.healthSystem.isDead) return;
    if (!this.respawnSystem.canRespawn(currentTime)) {
      if (this.deathOverlay) {
        const remaining = Math.ceil((this.respawnSystem.respawnDelay - (currentTime - this.respawnSystem.lastDeathTime)) / 1000);
        const el = this.deathOverlay.querySelector('#respawn-timer');
        if (el) el.textContent = `${Math.max(0, remaining)} 秒后重生...`;
      }
      return;
    }
    if (!this.player) return;

    this.healthSystem.respawn();
    const spawn = this.respawnSystem.getSpawnPoint(currentTime);
    this.physicsWorld.setBodyPosition('player', { x: spawn.position.x, y: spawn.position.y, z: spawn.position.z });
    this.physicsWorld.setBodyLinearVelocity('player', { x: 0, y: 0, z: 0 });
    this.player.resetFallState();
    if (this.deathOverlay) this.deathOverlay.style.display = 'none';
  }

  private handleFootsteps(currentTime: number): void {
    if (this.healthSystem.isDead || this.inVehicle) return;
    if (!this.player) return;
    const input = this.inputManager.state;
    const isMoving = input.forward || input.backward || input.left || input.right;
    if (!isMoving) return;
    const interval = input.sprint ? this.footstepInterval * 0.6 : this.footstepInterval;
    if (currentTime - this.lastFootstepTime >= interval) {
      this.lastFootstepTime = currentTime;
      const pos = this.player.getPosition();
      if (pos) this.audioSystem.play(SoundType.FOOTSTEP, pos);
    }
  }

  // ====== 计分板更新 ======
  private updateScoreboard(): void {
    const players: import('../ui/Scoreboard').PlayerScore[] = [];

    // 玩家
    const playerStats = this.gameMode.players.get(this.playerId);
    if (playerStats) {
      players.push({
        id: this.playerId, name: '玩家', kills: this.killCount, deaths: this.deathCount,
        assists: 0, score: playerStats.score, ping: 0, team: 'A',
      });
    }

    // AI bots
    for (let i = 0; i < this.aiSystem.bots.length; i++) {
      const bot = this.aiSystem.bots[i];
      players.push({
        id: `bot_${i}`, name: `AI Bot ${i + 1}`, kills: 0, deaths: bot.state === 'dead' ? 1 : 0,
        assists: 0, score: 0, ping: 30 + Math.floor(gameplayRandom() * 50), team: 'B',
      });
    }

    this.scoreboard.updatePlayers(players);
  }

  // ====== 主循环 ======
  private animate = (time: number): void => {
    if (this.stateMachine.is(GameState.DISPOSED)) return;
    this.animationId = requestAnimationFrame(this.animate);

    if (this.stateMachine.is(GameState.PLAYING)) {
      const mouseMovement = this.inputManager.getMouseMovement();
      this.pendingMouseMovement.x += mouseMovement.x;
      this.pendingMouseMovement.y += mouseMovement.y;

      this.simulationClock.advance(time, (dt) => {
        this.simulationTimeMs += dt * 1_000;
        this.simulateFixedStep(dt, this.simulationTimeMs);
      });
    } else {
      this.simulationClock.reset(time);
    }

    this.renderer.render(this.scene, this.camera);
    if (this.stateMachine.is(GameState.PLAYING, GameState.PAUSED, GameState.ROUND_END)) {
      this.updatePerformanceMetrics(time);
    }
  };

  private simulateFixedStep(dt: number, time: number): void {
    this.roundFlow.update(dt);
    if (!this.roundFlow.canSimulateCombat()) return;

    // 玩家更新
    if (this.player && !this.healthSystem.isDead && !this.inVehicle) {
      this.player.update(this.inputManager.state, this.pendingMouseMovement, dt);
    }
    this.pendingMouseMovement.x = 0;
    this.pendingMouseMovement.y = 0;

    // 载具控制
    this.updateVehicleControl(dt);
    this.vehicleSystem.update(dt);

    // 武器
    this.weaponSystem.update(time);
    const weapon = this.weaponSystem.getCurrentWeapon();
    const isMoving = this.inputManager.state.forward || this.inputManager.state.backward ||
      this.inputManager.state.left || this.inputManager.state.right;

    // ADS 瞄准状态
    const isAiming = this.inputManager.state.aim && !this.inVehicle;
    this.weaponView.setAiming(isAiming);
    this.player?.setAiming(isAiming);

    this.weaponView.update(dt, isMoving, this.inputManager.state.fire, dt);
    this.muzzleFlash.update(time);

    // 射击
    this.handleShooting(time);

    // 特效
    this.updateTracers(dt);
    this.updateImpacts(dt);
    this.updateBloodEffects(dt);
    this.updateExplosionEffects(dt);
    this.updateDamageNumbers(dt);
    this.updateSparks(dt);

    // 战术装备
    this.equipmentSystem.update(dt, time);
    this.handleEquipmentDamage(time);

    // AI
    if (this.player) {
      const playerPos = this.player.getPosition();
      if (playerPos) {
        const playerVec = this.tmpVec1.set(playerPos.x, playerPos.y, playerPos.z);
        this.aiSystem.update(dt, time, playerVec);
        for (const bot of this.aiSystem.bots) {
          // 只有敌方 AI 才能以玩家为目标，友军不索敌
          if (bot.state !== 'dead' && bot.team !== this.conquestMode.playerTeam && !bot.target) {
            if (bot.mesh.position.distanceTo(playerVec) < bot.detectionRange) {
              bot.setTarget(this.camera);
            }
          }
        }
      }
    }

    this.updateAIHealthBars(time);

    // 生命
    this.healthSystem.update(time);
    this.handleRespawn(time);
    this.handleFootsteps(time);

    // 天气
    if (this.player) {
      const pos = this.player.getPosition();
      if (pos) {
        this.weatherSystem.update(dt, time, this.tmpVec1.set(pos.x, pos.y, pos.z));
      }
    }

    // 音频监听器
    if (this.player) {
      const pos = this.player.getPosition();
      if (pos) {
        const forward = this.tmpVec2;
        this.camera.getWorldDirection(forward);
        this.audioSystem.updateListener(pos, forward, this.tmpVec3.set(0, 1, 0));
      }
    }

    // 网络
    if (this.networkManager && this.player && time - this.lastNetworkUpdate > this.networkUpdateInterval) {
      const pos = this.player.getPosition();
      const rot = this.player.getRotation();
      if (pos) {
        this.networkManager.sendPosition(pos.x, pos.y, pos.z, rot.yaw, rot.pitch);
        this.lastNetworkUpdate = time;
      }
    }

    // HUD
    const currentEquip = EQUIPMENT_ORDER[this.currentEquipmentIndex];
    const equipConfig = this.equipmentSystem.getActiveEquipment().find(e => e.config.type === currentEquip);
    const equipCount = equipConfig ? equipConfig.count : 1;

    // 交互提示
    let interactionPrompt: string | null = null;
    if (!this.inVehicle && !this.healthSystem.isDead) {
      const playerPos = this.player?.getPosition();
      if (playerPos) {
        for (const vehicle of this.vehicleSystem.vehicles) {
          if (vehicle.health > 0) {
            const dist = vehicle.mesh.position.distanceTo(this.tmpVec1.set(playerPos.x, playerPos.y, playerPos.z));
            if (dist < 4) {
              interactionPrompt = `按 E 进入 ${vehicle.config.name}`;
              break;
            }
          }
        }
      }
    } else if (this.inVehicle) {
      interactionPrompt = '按 E 离开载具';
    }

    // 方向伤害指示器（3秒后消失）
    const showDamageDir = time - this.lastDamageDirectionTime < 3000 ? this.lastDamageDirection : null;

    // 征服模式更新
    this.updateConquestMode(dt, time);
    this.updateControlPointVisuals();

    const conquestHud = this.conquestPresenter.getHudState();
    const tickets = conquestHud.tickets;
    const cpStatus = conquestHud.controlPoints;

    this.hud.update(
      {
        health: this.healthSystem.currentHealth, maxHealth: this.healthSystem.maxHealth,
        ammo: weapon.currentAmmo, reserveAmmo: weapon.reserveAmmo, weaponName: weapon.config.name,
        killCount: this.killCount, deathCount: this.deathCount,
        isReloading: weapon.isReloading, reloadProgress: weapon.getReloadProgress(time),
        hitMarker: time - this.hitMarkerTime < 150, hitMarkerTime: this.hitMarkerTime,
        hitMarkerHeadshot: time - this.hitMarkerHeadshotTime < 250,
        damageIndicator: null, score: this.killCount,
        position: this.player?.getPosition() || { x: 0, y: 0, z: 0 },
        stamina: this.player?.getStaminaPercentage(),
        equipmentCount: equipCount,
        equipmentName: equipConfig?.config.name || '手雷',
        interactionPrompt,
        damageDirection: showDamageDir,
        spawnProtection: this.healthSystem.getSpawnProtectionRemaining(time),
        axisTickets: tickets.axis,
        alliesTickets: tickets.allies,
        playerTeam: this.conquestMode.playerTeam,
        controlPoints: cpStatus.map(cp => ({ id: cp.id, owner: cp.owner, progress: cp.progress })),
      },
      time
    );

    this.hud.updateMinimapEnemies(
      this.aiSystem.bots.filter(b => b.state !== 'dead').map(b => ({
        x: b.mesh.position.x,
        z: b.mesh.position.z,
        isFriendly: b.team === this.conquestMode.playerTeam,
      }))
    );

    // 计分板（降频：每 500ms 更新一次）
    if (time - this.lastScoreboardUpdate > 500) {
      this.updateScoreboard();
      this.lastScoreboardUpdate = time;
    }

    // 固定时间步物理
    this.physicsWorld.step(dt);
  }

  private updatePerformanceMetrics(time: number): void {
    this.performanceMonitor.update(time);
    this.performanceMonitor.setRendererStats({
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      textures: this.renderer.info.memory.textures,
      geometries: this.renderer.info.memory.geometries,
    });
    this.performanceMonitor.setEntityCount(
      1 + this.aiSystem.bots.length + this.vehicleSystem.vehicles.length + this.remotePlayerMeshes.size,
    );

    if (time - this.lastPerformanceCapture >= this.config.performance.panelRefreshIntervalMs) {
      const snapshot = this.performanceMonitor.capture(time);
      this.performancePanel.update(snapshot, this.config.benchmark.enabled);
      this.lastPerformanceCapture = time;
    }
  }

  private onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  private onVisibilityChange = (): void => {
    if (document.hidden && this.stateMachine.is(GameState.PLAYING)) {
      this.stateMachine.transition(GameState.PAUSED);
      this.settingsMenu?.show();
      document.exitPointerLock();
    }
    this.simulationClock.reset(performance.now());
  };

  dispose(): void {
    if (!this.stateMachine.is(GameState.DISPOSED)) {
      this.stateMachine.transition(GameState.DISPOSED);
    }
    cancelAnimationFrame(this.animationId);
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.inputManager.dispose();
    this.networkManager?.disconnect();
    this.aiSystem?.dispose();
    this.hud?.dispose();
    this.mainMenu?.dispose();
    this.settingsMenu?.dispose();
    this.scoreboard?.dispose();
    this.deploymentMenu?.dispose();
    this.audioSystem?.dispose();
    this.weatherSystem?.dispose();
    this.vehicleSystem?.dispose();
    this.equipmentSystem?.dispose();
    this.mapManager?.dispose();
    this.performancePanel.dispose();
    this.events.clear();
    this.renderer.dispose();
  }
}
