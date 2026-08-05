import * as THREE from 'three';
import { loadGameSettings, resolveGameConfig, saveGameSettings, validateGameConfig } from '../config';
import { EventBus, FixedStepClock, GameState, GameStateMachine } from '../core';
import { gameplayRandom, useGameplaySeed, useSystemRandom } from '../core/Random';
import { PerformanceMonitor, PerformancePanel } from '../performance';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { PlayerController } from '../player/PlayerController';
import { InputManager } from '../input/InputManager';
import { NetworkGameClient } from '../network/NetworkGameClient';
import { ClientPrediction } from '../network/ClientPrediction';
import { TICK_RATE_HZ, CONQUEST_OBJECTIVE_DEFS } from '../../shared/protocol';
import type { ServerGameState } from '../../shared/protocol';
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
import { AIStats } from '../ai/AIStats';
import { VehicleSystem, VehicleType, type Vehicle, type VehicleShot } from '../vehicle/VehicleSystem';
import { NetworkVehicles } from '../vehicle/NetworkVehicles';
import { VEHICLE_SIM_CONFIGS, RESPAWN_DELAY_MS, ROUND_RESTART_DELAY_MS } from '../../shared/protocol';
import { AudioSystem, SoundType } from '../audio/AudioSystem';
import { AudioVoiceManager } from '../audio/AudioVoiceManager';
import { resolveAudibleLayers, computeLayerGain } from '../audio/GunshotLayers';
import { MapManager } from '../maps/MapManager';
import { EquipmentSystem, EquipmentType } from '../equipment/TacticalEquipment';
import { MineSystem } from '../equipment/MineSystem';
import { WeatherSystem, WeatherType } from '../environment/WeatherSystem';
import { VISUAL_PROFILES, resolveVisualProfileId, colorTemperatureToRGB } from '../environment/VisualProfile';
import { WeatherMaterialLink } from '../environment/WeatherMaterialLink';
import { VfxPool, VfxType } from '../effects/VfxPool';
import { ExplosionImpactSystem } from '../effects/ExplosionImpact';
import { DynamicResolution } from '../performance/DynamicResolution';
import { DestructibleSystem, DestructibleKind } from '../destruction/DestructibleSystem';
import type { GameEvents } from './GameEvents';
import { GameMode, GameModeType } from './GameMode';
import { ConquestPresenter } from './ConquestPresenter';
import { AchievementSystem, AchievementType } from './AchievementSystem';
import { ConquestMode, TeamId, objectiveOwnerToTeam } from './ConquestMode';
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
  EquipmentType.PANZERFAUST,
  EquipmentType.MINE,
];

/**
 * 联网权威回写收敛系数（0..1）：每帧把本地玩家渲染位置向服务端预测轨迹收敛的比例。
 * 0.2 = 每帧吸收 20% 水平偏差，兼顾手感平滑与服务端一致性（快照校正已平滑，这里只做渲染层回写）。
 */
const NETWORK_POSITION_CONVERGE = 0.2;

/** 反坦克火箭参数（阶段 7 反载具链） */
const PANZERFAUST_SPEED = 55;
const PANZERFAUST_RADIUS = 4.5;
const PANZERFAUST_DAMAGE = 300;
/** 火箭对载具伤害倍率（步兵反制坦克的核心） */
const PANZERFAUST_VEHICLE_MULT = 3.5;

interface Tracer { line: THREE.Line; life: number; maxLife: number; }
interface Impact { mesh: THREE.Mesh; life: number; maxLife: number; }

/** 场景据点视觉三件套：地面圆圈（归属色）+ 旗杆（归属色）+ 标签 Sprite */
interface ObjectiveVisual {
  ring: THREE.Mesh;
  flag: THREE.Mesh;
  label: THREE.Sprite;
  /** 标签画布（重定位后重绘 id 用） */
  labelCanvas: HTMLCanvasElement;
}

/** 载具炮弹实体：位置/速度/寿命，主炮带重力与爆炸 */
interface VehicleProjectile {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  kind: 'machinegun' | 'cannon' | 'rocket';
  owner: Vehicle | null;
  hit: boolean;
  /** 爆炸基准伤害（阶段 7：主炮/火箭各自携带，不再依赖全局常量） */
  damage: number;
  /** 对载具伤害倍率（反坦克火箭 > 1） */
  vehicleMultiplier: number;
}

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
  private networkGameClient: NetworkGameClient | null = null;
  /** 服务端权威游戏状态（收到 game_state 后非空；联网模式下驱动 HUD 兵力/据点显示） */
  private serverGameState: ServerGameState | null = null;
  /** 联网模式本人存活状态（服务端快照驱动；死亡表现/重生传送/输入门控用） */
  private networkAlive = true;
  /** 联网模式本人死亡时刻（客户端渲染时钟，重生倒计时基准） */
  private networkDeadSince = 0;
  /** 回合结束结算遮罩（联网模式：胜者 + 新回合倒计时） */
  private roundOverlay: HTMLElement | null = null;
  /** 新回合开始的客户端时间戳（结算倒计时基准；0 = 无进行中的结算） */
  private roundEndAt = 0;
  /**
   * 本地预测（联网模式）：输入发送时自动推进、快照按 ackSeq 校正；
   * 每帧把本地玩家渲染位置向预测轨迹平滑收敛（服务端权威移动，无碰撞模型的水平偏差由校正吸收）。
   */
  private clientPrediction: ClientPrediction | null = null;
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
  private readonly aiStats = new AIStats();

  // 音频
  private audioSystem!: AudioSystem;

  // 地图
  private mapManager!: MapManager;

  // 战术装备
  private equipmentSystem!: EquipmentSystem;
  /** 反坦克地雷（阶段 7 P1） */
  private mineSystem!: MineSystem;
  private currentEquipmentIndex = 0;

  // 载具
  private vehicleSystem!: VehicleSystem;
  private inVehicle = false;
  private currentVehicle: { vehicle: Vehicle; isDriver: boolean } | null = null;
  /** 联网模式载具视觉（服务端 vehicle_state 权威驱动；单机模式为 null） */
  private networkVehicles: NetworkVehicles | null = null;
  /** 联网模式驾驶状态（由服务端 driverId 驱动，非本地立即置位） */
  private inNetworkVehicle = false;
  /** 联网载具开火节流（客户端按武器冷却限制发送频率；伤害/冷却由服务端权威裁决） */
  private lastVehicleFireSent = Number.NEGATIVE_INFINITY;

  // 载具炮弹实体（阶段 6/7：弹道 + 爆炸闭环）
  private vehicleProjectiles: VehicleProjectile[] = [];
  private projectileRaycaster = new THREE.Raycaster();
  /** 补给站提示去重（阶段 7 P1） */
  private lastSupplyZoneMessage = false;

  // 天气
  private weatherSystem!: WeatherSystem;
  private ambientLight!: THREE.AmbientLight;
  private dirLight!: THREE.DirectionalLight;

  // 阶段 6：渲染/特效/音频接线
  private readonly weatherMaterialLink = new WeatherMaterialLink();
  private readonly dynamicResolution = new DynamicResolution();
  private readonly vfxPool = new VfxPool();
  private readonly explosionImpact = new ExplosionImpactSystem();
  private readonly audioVoiceManager = new AudioVoiceManager();
  private graphicsLevel: GameSettings['graphics'] = loadGameSettings().graphics;
  private basePixelRatio = Math.min(window.devicePixelRatio, 2);
  private appliedPixelRatio = -1;
  private lastFrameTime = 0;
  private dayNightEnabled = true;

  // 游戏模式 & 成就
  private gameMode!: GameMode;
  private achievementSystem!: AchievementSystem;
  private playerId: string;

  // 征服模式
  private conquestMode!: ConquestMode;
  private conquestPresenter!: ConquestPresenter;
  private roundFlow = new RoundFlow({ deploymentSeconds: 0, countdownSeconds: 5, resultsSeconds: 12 });
  /** 场景据点视觉（id → 圆圈/旗杆/标签三件套）。单机按本地 A/B/C 布局，联网切换到服务端权威布局 */
  private objectiveVisuals: Map<string, ObjectiveVisual> = new Map();
  /** 联网模式是否已把据点视觉重定位到服务端权威布局（避免每帧重复重建） */
  private serverObjectiveLayoutApplied = false;

  // 环境物体
  private environmentObjects: THREE.Object3D[] = [];

  // 局部破坏（阶段 7）
  private destructibleSystem!: DestructibleSystem;

  // 特效池
  private tracers: Tracer[] = [];
  /** 场景静态/半静态视觉对象（补给站标记等），dispose 时统一清理 */
  private visualObjects: THREE.Object3D[] = [];
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
  private networkUpdateInterval = 1000 / TICK_RATE_HZ;
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
    this.renderer.setPixelRatio(this.basePixelRatio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // 阶段 6：ACES 胶片色调映射 + sRGB 输出 + 曝光基线
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = VISUAL_PROFILES.day_clear.exposure;
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
    this.setupRoundOverlay();

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
    this.events.on('combat:kill', ({ label, headshot, victimTeam, victimId, time }) => {
      this.killCount++;
      this.events.emit('ui:message', { text: label, time });
      this.conquestMode?.onAIDeath(victimTeam);
      if (victimId) this.aiStats.recordDeath(victimId);
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

    // 局部破坏（阶段 7 P0）：预切片对象加入碰撞与 AI 视线，摧毁后移除
    this.destructibleSystem = new DestructibleSystem(this.scene);
    this.destructibleSystem.onDestroy = (obj) => {
      const idx = this.environmentObjects.indexOf(obj.mesh);
      if (idx >= 0) this.environmentObjects.splice(idx, 1);
    };
    this.spawnDestructibles();

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
    this.aiSystem.bots.forEach((_bot, index) => this.aiStats.register(`bot_${index}`, 30 + (index % 5) * 5));
    this.setupAIHealthBars();
    this.setupAIFireCallback();

    // 据点视觉
    this.setupControlPoints();

    // 音频
    this.audioSystem = new AudioSystem();

    // 战术装备
    this.equipmentSystem = new EquipmentSystem(this.scene);
    this.aiSystem.configureVisibility(
      this.environmentObjects,
      (currentTime) => this.equipmentSystem.getActiveSmokeVolumes(currentTime),
    );

    // 反坦克地雷：触发时复用爆炸管线（AoE + 四通道冲击 + 特效 + 破坏物联动）
    this.mineSystem = new MineSystem(this.scene);
    this.mineSystem.onTrigger = (mine, _target) => {
      this.applyExplosion(mine.position, mine.explosionRadius, mine.damage, mine.vehicleMultiplier, null);
      this.audioSystem.play(SoundType.EXPLOSION, mine.position);
      this.hud.addKillMessage('地雷爆炸', this.simulationTimeMs);
      this.mineSystem.remove(mine);
    };

    // 载具
    this.vehicleSystem = new VehicleSystem(this.scene, this.physicsWorld.world);
    this.spawnVehicles();
    // AI 反载具：登记载具引用（阶段 7 P1）
    this.aiSystem.configureVehicles(this.vehicleSystem.vehicles);
    this.spawnSupplyStations();

    // 天气
    this.weatherSystem = new WeatherSystem(this.scene, this.ambientLight, this.dirLight);
    this.weatherSystem.setWeather(this.config.benchmark.weather);
    this.weatherSystem.enableDayNightCycle(
      this.config.benchmark.enabled ? this.config.benchmark.dayNightCycle : true,
    );
    this.weatherSystem.enableAutoWeather(
      this.config.benchmark.enabled ? this.config.benchmark.autoWeather : true,
    );
    this.dayNightEnabled = this.config.benchmark.enabled ? this.config.benchmark.dayNightCycle : true;
    this.weatherSystem.onWeatherChange = (type) => this.applyWeatherLink(type);
    this.applyWeatherLink(this.weatherSystem.getCurrentWeather());
    this.applyVisualProfile();

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
    const vehicleTypes = [VehicleType.JEEP, VehicleType.TANK];

    for (let index = 0; index < vehicleCount; index++) {
      // 阵营分配：偶数索引 → 玩家方（苏军），奇数索引 → 德军（AI 反载具闭环需要分阵营）
      const team = index % 2 === 0
        ? this.conquestMode.playerTeam
        : (this.conquestMode.playerTeam === TeamId.AXIS ? TeamId.ALLIES : TeamId.AXIS);
      this.vehicleSystem.spawnVehicle(vehicleTypes[index % vehicleTypes.length], spawnPositions[index], team);
    }
  }

  /** 联网模式移除本地单机载具（权威载具改由服务端 vehicle_state 驱动） */
  private removeLocalVehicles(): void {
    for (const vehicle of this.vehicleSystem.vehicles) {
      this.scene.remove(vehicle.mesh);
    }
    this.vehicleSystem.vehicles.length = 0;
    this.aiSystem.configureVehicles([]);
  }

  /** 在双方营地部署载具补给站（阶段 7 P1）：同阵营载具进入半径快速维修 + 补弹 */
  private spawnSupplyStations(): void {
    const axisSpawn = this.conquestMode.teams.get(TeamId.AXIS)?.spawnPoint;
    const alliesSpawn = this.conquestMode.teams.get(TeamId.ALLIES)?.spawnPoint;
    if (axisSpawn) this.vehicleSystem.addSupplyStation(axisSpawn.clone().add(new THREE.Vector3(4, 0, 4)), 12, TeamId.AXIS);
    if (alliesSpawn) this.vehicleSystem.addSupplyStation(alliesSpawn.clone().add(new THREE.Vector3(-4, 0, -4)), 12, TeamId.ALLIES);

    // 视觉标记：半透明圆柱平台 + 阵营色立柱
    for (const station of this.vehicleSystem.getSupplyStations()) {
      const pad = new THREE.Mesh(
        new THREE.CylinderGeometry(6, 6, 0.15, 24),
        new THREE.MeshStandardMaterial({ color: 0x222222, transparent: true, opacity: 0.45, roughness: 0.9 }),
      );
      pad.position.set(station.position.x, 0.1, station.position.z);
      pad.receiveShadow = true;
      this.scene.add(pad);

      const poleColor = station.team === TeamId.AXIS ? 0x8a2a2a : 0x2a4a8a;
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.15, 0.15, 4, 8),
        new THREE.MeshStandardMaterial({ color: poleColor, emissive: poleColor, emissiveIntensity: 0.5 }),
      );
      pole.position.set(station.position.x, 2, station.position.z);
      this.scene.add(pole);

      this.visualObjects.push(pad, pole);
    }
  }

  /** 在地图散布可破坏对象（避开出生点/载具点），完整对象参与碰撞与 AI 视线 */
  private spawnDestructibles(): void {
    const placements: { kind: DestructibleKind; x: number; z: number; rotationY: number }[] = [
      { kind: DestructibleKind.SANDBAG, x: 8, z: -22, rotationY: 0.4 },
      { kind: DestructibleKind.SANDBAG, x: -9, z: 20, rotationY: -0.3 },
      { kind: DestructibleKind.COVER, x: 24, z: -6, rotationY: 0.8 },
      { kind: DestructibleKind.COVER, x: -25, z: 8, rotationY: -0.6 },
      { kind: DestructibleKind.FENCE, x: 30, z: 22, rotationY: 1.2 },
      { kind: DestructibleKind.FENCE, x: -30, z: -20, rotationY: -1.1 },
      { kind: DestructibleKind.DOOR, x: 6, z: 28, rotationY: 0 },
      { kind: DestructibleKind.DOOR, x: -6, z: -28, rotationY: 0 },
    ];
    for (const placement of placements) {
      const obj = this.destructibleSystem.create(
        placement.kind,
        new THREE.Vector3(placement.x, 0, placement.z),
        placement.rotationY,
      );
      this.environmentObjects.push(obj.mesh);
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

    this.inputManager.onSeatSwitch(() => {
      if (!this.inVehicle || !this.currentVehicle) return;
      const vehicle = this.currentVehicle.vehicle;
      if (vehicle.switchSeat(this.playerId)) {
        this.currentVehicle.isDriver = vehicle.getSeatIndexOf(this.playerId) === 0;
        this.hud.addKillMessage(`切换到${vehicle.getSeatLabel(this.playerId)}`, this.simulationTimeMs);
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
    // 画质档位：低画质关闭阴影并固定 1x；中/高开启阴影并启用动态分辨率
    this.graphicsLevel = savedSettings.graphics;
    this.basePixelRatio = savedSettings.graphics === 'low' ? 1 : Math.min(window.devicePixelRatio, 2);
    this.renderer.shadowMap.enabled = savedSettings.graphics !== 'low';
    this.dynamicResolution.reset();
    this.appliedPixelRatio = -1; // 下一帧强制应用新的像素比
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

  private setupRoundOverlay(): void {
    const overlay = document.createElement('div');
    overlay.id = 'round-overlay';
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0, 0, 0, 0.55); z-index: 210;
      display: none; align-items: center; justify-content: center;
      pointer-events: none; font-family: 'Arial', sans-serif;
    `;
    overlay.innerHTML = `
      <div style="text-align: center; color: white;">
        <div id="round-winner" style="font-size: 52px; font-weight: bold; text-shadow: 2px 2px 8px rgba(0,0,0,0.9);"></div>
        <div id="round-timer" style="font-size: 24px; margin-top: 18px; text-shadow: 2px 2px 4px rgba(0,0,0,0.8);"></div>
      </div>
    `;
    document.body.appendChild(overlay);
    this.roundOverlay = overlay;
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
    // 初始按本地征服布局（单机 AI 对局 A/B/C）建视觉；联网收到 game_state 后切换为服务端权威布局
    for (const point of this.conquestMode.controlPoints) {
      const vis = this.buildObjectiveVisual(point.id, point.position.x, point.position.z, point.radius);
      this.objectiveVisuals.set(point.id, vis);
    }
  }

  private buildObjectiveVisual(id: string, x: number, z: number, radius: number): ObjectiveVisual {
    // 据点圆圈
    const ringGeo = new THREE.RingGeometry(radius - 0.5, radius, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x888888, transparent: true, opacity: 0.5, side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.1, z);
    this.scene.add(ring);

    // 据点旗帜/标记（归属色与圆圈一致）
    const flagGeo = new THREE.CylinderGeometry(0.1, 0.1, 4, 8);
    const flagMat = new THREE.MeshStandardMaterial({ color: 0x888888 });
    const flag = new THREE.Mesh(flagGeo, flagMat);
    flag.position.set(x, 2, z);
    this.scene.add(flag);

    // 据点标签
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const label = this.buildLabelSprite(canvas, id, x, z);
    return { ring, flag, label, labelCanvas: canvas };
  }

  private buildLabelSprite(canvas: HTMLCanvasElement, id: string, x: number, z: number): THREE.Sprite {
    const ctx = canvas.getContext('2d')!;
    ctx.font = 'bold 48px Arial';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(id, 32, 32);
    const texture = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({ map: texture, depthTest: false });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(2, 2, 1);
    sprite.position.set(x, 5, z);
    this.scene.add(sprite);
    return sprite;
  }

  private static controlPointColor(owner: TeamId): number {
    return owner === TeamId.AXIS ? 0xff4444 : owner === TeamId.ALLIES ? 0x4488ff : 0x888888;
  }

  private updateControlPointVisuals(): void {
    const gs = this.serverGameState;
    if (gs && (gs.phase === 'started' || gs.phase === 'ended')) {
      // 联网模式：据点归属由服务端 game_state 权威驱动（本地 AI 模拟不再影响场景视觉）
      this.ensureServerObjectiveLayout();
      for (const obj of gs.objectives) {
        const vis = this.objectiveVisuals.get(obj.id);
        if (!vis) continue;
        const color = GameScene.controlPointColor(objectiveOwnerToTeam(obj.owner));
        (vis.ring.material as THREE.MeshBasicMaterial).color.setHex(color);
        (vis.flag.material as THREE.MeshStandardMaterial).color.setHex(color);
      }
      return;
    }
    // 单机模式：本地征服模拟驱动
    for (const point of this.conquestMode.controlPoints) {
      const vis = this.objectiveVisuals.get(point.id);
      if (!vis) continue;
      const color = GameScene.controlPointColor(point.owner);
      (vis.ring.material as THREE.MeshBasicMaterial).color.setHex(color);
      (vis.flag.material as THREE.MeshStandardMaterial).color.setHex(color);
    }
  }

  /** 联网模式：把据点视觉重定位到服务端权威布局（alpha/bravo/charlie）并重绘标签；仅首次执行 */
  private ensureServerObjectiveLayout(): void {
    if (this.serverObjectiveLayoutApplied) return;
    for (const vis of this.objectiveVisuals.values()) {
      this.scene.remove(vis.ring);
      this.scene.remove(vis.flag);
      this.scene.remove(vis.label);
    }
    this.objectiveVisuals.clear();
    const radius = this.conquestMode.config.captureRadius;
    for (const def of CONQUEST_OBJECTIVE_DEFS) {
      const vis = this.buildObjectiveVisual(def.id, def.x, def.z, radius);
      this.objectiveVisuals.set(def.id, vis);
    }
    this.serverObjectiveLayoutApplied = true;
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
    this.networkGameClient = new NetworkGameClient();
    this.networkGameClient.onPlayerLeave = (id) => this.removeRemotePlayer(id);
    this.networkGameClient.onKillFeed = (msg) => {
      // 击杀反馈：本人击杀/死亡计入 K/D（服务端权威），其余玩家消息进 HUD 击杀列表
      if (msg.victimId === playerId) this.deathCount += 1;
      if (msg.killerId === playerId) this.killCount += 1;
      this.hud?.addKillMessage(`${msg.killerName} 击杀了 ${msg.victimName}（${msg.weaponLabel}）`, this.simulationTimeMs);
    };
    this.networkGameClient.onGameState = (state) => {
      this.serverGameState = state;
      this.handleNetworkRoundState(state);
    };
    // 联网载具视觉：服务端权威 vehicle_state（15Hz）驱动创建/更新/移除
    this.networkVehicles = new NetworkVehicles(this.scene);
    this.networkGameClient.onVehicleState = (state) => {
      this.networkVehicles?.applyState(state);
    };
    // 联网模式不使用本地单机载具（权威载具由服务端模拟驱动，客户端只做视觉）
    this.removeLocalVehicles();
    this.networkGameClient.onError = (code, message) => {
      console.warn(`[网络] 服务器错误 ${code}: ${message}`);
    };
    // 本地预测初始状态：以当前玩家位置/朝向为起点（服务端首快照会立即校正）
    const pos = this.player?.getPosition() ?? { x: 0, y: 0, z: 0 };
    const rot = this.player?.getRotation() ?? { yaw: 0, pitch: 0 };
    this.clientPrediction = new ClientPrediction({
      x: pos.x, y: pos.y, z: pos.z, yaw: rot.yaw, pitch: rot.pitch, health: 100, alive: true,
    });
    await this.networkGameClient.connect(wsUrl, this.config.network.roomId, playerId, '玩家', {
      prediction: this.clientPrediction,
    });
  }

  /** 联网回合状态：胜者出现 → 结算遮罩 + 新回合倒计时；新回合开始 → 关闭遮罩 */
  private handleNetworkRoundState(state: ServerGameState): void {
    if (state.winner !== null && this.roundEndAt === 0) {
      this.roundEndAt = this.simulationTimeMs + ROUND_RESTART_DELAY_MS;
      const winnerName = state.winner === 0 ? '德军' : '苏军';
      this.showRoundOverlay(`${winnerName} 获胜！`);
    } else if (state.winner === null && state.phase === 'started') {
      this.roundEndAt = 0;
      if (this.roundOverlay) this.roundOverlay.style.display = 'none';
    }
  }

  /** 结算遮罩（胜者文本 + 新回合倒计时） */
  private showRoundOverlay(winnerText: string): void {
    if (!this.roundOverlay) return;
    const winnerEl = this.roundOverlay.querySelector('#round-winner');
    if (winnerEl) winnerEl.textContent = winnerText;
    this.roundOverlay.style.display = 'flex';
  }

  /**
   * 联网死亡/重生生命周期（服务端权威）：
   * 快照校正后的本人 alive 翻转 → 死亡遮罩/重生传送；死亡中刷新倒计时。
   */
  private updateNetworkLifecycle(time: number): void {
    const client = this.networkGameClient;
    const own = client?.getOwnState();
    if (!client || !own) return;

    if (!own.alive && this.networkAlive) {
      // 死亡翻转：复用单机死亡表现（遮罩/音效/事件），本地玩家停摆
      this.networkAlive = false;
      this.networkDeadSince = time;
      this.audioSystem.play(SoundType.DEATH, this.camera.position);
      this.events.emit('player:death', { team: this.conquestMode.playerTeam, time });
      if (this.deathOverlay) this.deathOverlay.style.display = 'flex';
    }
    if (own.alive && !this.networkAlive) {
      // 服务端复活：传送到权威出生点（快照已硬校正到该位置），关闭死亡遮罩
      this.networkAlive = true;
      if (this.player) {
        this.physicsWorld.setBodyPosition('player', { x: own.x, y: own.y, z: own.z });
        this.physicsWorld.setBodyLinearVelocity('player', { x: 0, y: 0, z: 0 });
        this.player.resetFallState();
      }
      if (this.deathOverlay) this.deathOverlay.style.display = 'none';
    }
    if (!own.alive && this.deathOverlay) {
      const remaining = Math.max(0, Math.ceil((RESPAWN_DELAY_MS - (time - this.networkDeadSince)) / 1000));
      const el = this.deathOverlay.querySelector('#respawn-timer');
      if (el) el.textContent = `${remaining} 秒后重生...`;
    }
  }

  /** 每帧将远端玩家快照插值姿势同步到 mesh（创建/更新/移除，替代旧版直接瞬移） */
  private syncRemotePlayers(): void {
    const client = this.networkGameClient;
    if (!client) return;
    const poses = client.remotePlayers.getPoses();
    for (const pose of poses.values()) {
      let mesh = this.remotePlayerMeshes.get(pose.id);
      if (!mesh) {
        mesh = this.createRemotePlayerMesh();
        this.remotePlayerMeshes.set(pose.id, mesh);
        this.scene.add(mesh);
      }
      mesh.position.set(pose.x, pose.y, pose.z);
      mesh.rotation.y = pose.yaw;
      mesh.visible = pose.alive;
    }
    // 已离开/不再出现在快照的玩家移除 mesh
    for (const [id, mesh] of [...this.remotePlayerMeshes]) {
      if (!poses.has(id)) {
        this.scene.remove(mesh);
        this.remotePlayerMeshes.delete(id);
      }
    }
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
    // 统一特效池预算门控：预算满时跳过本次表现，防止大规模爆炸拖垮帧率
    const handle = this.vfxPool.spawn(
      {
        type: VfxType.EXPLOSION,
        position: { x: position.x, y: position.y, z: position.z },
        importance: 'high',
        durationMs: 800,
      },
      this.simulationTimeMs,
    );
    if (!handle) return;

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
    // 烟雾受统一特效池门控（SMOKE 单类型预算 64）
    const handle = this.vfxPool.spawn(
      {
        type: VfxType.SMOKE,
        position: { x: position.x, y: position.y, z: position.z },
        importance: 'medium',
        durationMs: 5000,
      },
      this.simulationTimeMs,
    );
    if (!handle) return;

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

    // 反坦克火箭：直射弹道实体，不经过抛物线投掷管线（阶段 7 反载具链）
    if (type === EquipmentType.PANZERFAUST) {
      this.firePanzerfaust();
      return;
    }

    // 反坦克地雷：原地放置，敌方载具接近即爆（阶段 7 P1）
    if (type === EquipmentType.MINE) {
      this.placeMine();
      return;
    }

    const pos = this.camera.getWorldPosition(this.tmpVec1).clone();
    const dir = this.tmpVec2;
    this.camera.getWorldDirection(dir);

    const equipment = this.equipmentSystem.throwEquipment(type, pos, dir.clone(), this.simulationTimeMs);
    if (equipment) {
      this.audioSystem.play(SoundType.UI_CLICK);
      this.hud.addKillMessage(`投掷 ${equipment.config.name}`, this.simulationTimeMs);
    }
  }

  /** 放置反坦克地雷：上限由 MineSystem 按队伍控制 */
  private placeMine(): void {
    if (this.healthSystem.isDead) return;
    const pos = this.player?.getPosition();
    if (!pos) return;
    const mine = this.mineSystem.place(
      this.tmpVec1.set(pos.x, 0, pos.z).clone(),
      this.conquestMode.playerTeam,
    );
    if (mine) {
      this.audioSystem.play(SoundType.UI_CLICK);
      this.hud.addKillMessage('已放置反坦克地雷', this.simulationTimeMs);
    } else {
      this.audioSystem.play(SoundType.UI_CLICK);
      this.hud.addKillMessage('地雷已达上限', this.simulationTimeMs);
    }
  }

  /** 反坦克火箭：高速直射、命中即爆，对载具高倍率伤害（步兵反载具链） */
  private firePanzerfaust(): void {
    const pos = this.camera.getWorldPosition(this.tmpVec1).clone();
    const dir = this.tmpVec2;
    this.camera.getWorldDirection(dir);
    dir.normalize();

    this.vehicleProjectiles.push({
      position: pos,
      velocity: dir.clone().multiplyScalar(PANZERFAUST_SPEED),
      life: 0,
      maxLife: 2.5,
      kind: 'rocket',
      owner: null,
      hit: false,
      damage: PANZERFAUST_DAMAGE,
      vehicleMultiplier: PANZERFAUST_VEHICLE_MULT,
    });
    this.audioSystem.play(SoundType.GUNSHOT, pos);
    this.player?.addShake(0.1, 5);
    this.hud.addKillMessage('发射反坦克火箭', this.simulationTimeMs);
  }

  // ====== 载具 ======
  private toggleVehicle(): void {
    if (this.networkGameClient && this.networkVehicles) {
      this.toggleNetworkVehicle();
      return;
    }
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
        if (vehicle.destroyed) continue;
        const dist = vehicle.mesh.position.distanceTo(playerVec);
        if (dist < 4) {
          const seat = vehicle.enterVehicle(this.playerId);
          if (seat) {
            this.inVehicle = true;
            this.currentVehicle = { vehicle, isDriver: seat === 'driver' };
            this.hud.addKillMessage(`进入 ${vehicle.config.name}（${seat === 'driver' ? '驾驶' : '乘坐'}）`, this.simulationTimeMs);
            break;
          }
        }
      }
    }
  }

  private updateVehicleControl(dt: number): void {
    if (!this.inVehicle || !this.currentVehicle) return;
    const vehicle = this.currentVehicle.vehicle;

    // 被摧毁：强制逃生
    if (vehicle.destroyed) {
      this.currentVehicle = null;
      this.inVehicle = false;
      this.hud.addKillMessage('载具被摧毁，你已脱离', this.simulationTimeMs);
      if (!this.healthSystem.isDead) {
        this.healthSystem.takeDamage(40, this.simulationTimeMs);
        this.player?.addShake(0.25, 8);
      }
      return;
    }

    const input = this.inputManager.state;
    let forward = 0;
    let turn = 0;

    if (input.forward) forward = 1;
    if (input.backward) forward = -1;
    if (input.left) turn = 1;
    if (input.right) turn = -1;

    if (this.currentVehicle.isDriver) {
      vehicle.drive(forward, turn, dt);

      // 炮塔朝向准星方向（相机 yaw），主炮联动
      vehicle.setTurretTargetYaw(this.camera.rotation.y);

      // 载具武器射击 → 弹道实体
      if (input.fire) {
        const shot = vehicle.fireWeapon(this.simulationTimeMs);
        if (shot) this.spawnVehicleProjectile(shot);
      }
    }

    // 同步相机到载具
    const vpos = vehicle.mesh.position;
    this.camera.position.set(vpos.x, vpos.y + 3, vpos.z + 6);
    this.camera.lookAt(vpos.x, vpos.y, vpos.z);

    // 补给站提示（阶段 7 P1）：进入/离开同阵营补给区
    const inSupply = this.vehicleSystem.isVehicleInSupplyZone(vehicle);
    if (inSupply && !this.lastSupplyZoneMessage) {
      this.hud.addKillMessage('进入补给站：维修 + 弹药补充中', this.simulationTimeMs);
    }
    this.lastSupplyZoneMessage = inSupply;
  }

  // ====== 联网载具（服务端权威：vehicle_state 驱动视觉与驾驶状态） ======
  private toggleNetworkVehicle(): void {
    if (!this.networkGameClient || !this.networkVehicles || !this.player) return;
    if (this.inNetworkVehicle) {
      // 下车：通知服务端释放司机位；本地就近落地（服务端 exit 不动玩家位置）
      const driving = this.networkVehicles.getByDriver(this.playerId);
      this.networkGameClient.sendVehicleExit();
      this.inNetworkVehicle = false;
      if (driving) {
        this.player.teleportHorizontal(driving.mesh.position.x + 2, driving.mesh.position.z + 2);
      }
      this.hud.addKillMessage('离开载具', this.simulationTimeMs);
      return;
    }
    // 上车：查找附近未摧毁载具（交互半径 4m < 服务端校验半径 8m）
    const pos = this.player.getPosition();
    if (!pos) return;
    const id = this.networkVehicles.findNear(pos.x, pos.z, 4);
    if (id) this.networkGameClient.sendVehicleEnter(id);
  }

  /** 每帧：驾驶状态由服务端 driverId 驱动；在驾驶时路由输入 + 第三人称相机跟随 */
  private updateNetworkVehicleControl(dt: number): void {
    if (!this.networkGameClient || !this.networkVehicles || !this.player) return;
    const driving = this.networkVehicles.getByDriver(this.playerId);
    if (driving) {
      if (!this.inNetworkVehicle) {
        this.inNetworkVehicle = true;
        this.hud.addKillMessage('进入载具（驾驶）', this.simulationTimeMs);
      }
      // 载具血量条（服务端 vehicle_state 权威血量）
      this.hud.setVehicleHealth(driving.health, driving.maxHealth, VEHICLE_SIM_CONFIGS[driving.type].label);
      // 第三人称相机跟随载具
      const vpos = driving.mesh.position;
      this.camera.position.set(vpos.x, vpos.y + 3, vpos.z + 6);
      this.camera.lookAt(vpos.x, vpos.y, vpos.z);
      // 驾驶输入路由（服务端权威运动；forward/turn ∈ -1..1）
      const input = this.inputManager.state;
      let forward = 0;
      let turn = 0;
      if (input.forward) forward = 1;
      if (input.backward) forward = -1;
      if (input.left) turn = 1;
      if (input.right) turn = -1;
      this.networkGameClient.sendVehicleDrive(forward, turn);
      // 载具武器开火：客户端按武器冷却节流发送（服务端权威裁决伤害/冷却）；
      // 弹道方向 = 载具朝向（服务端坐标系前向），本地即时开火反馈（炮口闪光 + 音效）
      const weapon = VEHICLE_SIM_CONFIGS[driving.type].weapons[0];
      if (input.fire && weapon && this.simulationTimeMs - this.lastVehicleFireSent >= weapon.cooldownMs) {
        this.lastVehicleFireSent = this.simulationTimeMs;
        this.networkGameClient.sendVehicleFire(driving.id, driving.mesh.rotation.y, 0, 0);
        this.networkVehicles.flash(driving.id, this.simulationTimeMs);
        this.audioSystem.play(SoundType.GUNSHOT, vpos);
      }
    } else {
      if (this.inNetworkVehicle) {
        // 被挤下车 / 载具被摧毁（服务端清空 driverId）→ 被动退出驾驶
        this.inNetworkVehicle = false;
        this.hud.addKillMessage('已离开载具', this.simulationTimeMs);
      }
      this.hud.hideVehicleHealth();
    }
  }

  // ====== 载具武器弹道（阶段 6/7） ======
  private spawnVehicleProjectile(shot: VehicleShot): void {
    if (shot.kind === 'none') return;
    const speed = shot.kind === 'cannon' ? 60 : 140;
    this.vehicleProjectiles.push({
      position: shot.origin.clone(),
      velocity: shot.direction.clone().multiplyScalar(speed),
      life: 0,
      maxLife: shot.kind === 'cannon' ? 3 : 1.2,
      kind: shot.kind,
      owner: shot.owner,
      hit: false,
      damage: shot.kind === 'machinegun' ? 0 : shot.damage,
      vehicleMultiplier: shot.kind === 'cannon' ? 1 : 1,
    });
    this.audioSystem.play(SoundType.GUNSHOT, shot.origin);
  }

  private updateVehicleProjectiles(dt: number): void {
    if (this.vehicleProjectiles.length === 0) return;

    for (let i = this.vehicleProjectiles.length - 1; i >= 0; i--) {
      const p = this.vehicleProjectiles[i];
      p.life += dt;
      if (p.kind === 'cannon') p.velocity.y -= 9.8 * dt;

      const prev = p.position.clone();
      p.position.addScaledVector(p.velocity, dt);
      const travelled = p.position.distanceTo(prev);
      const dir = p.velocity.clone().normalize();

      // 环境命中
      this.projectileRaycaster.set(prev, dir);
      this.projectileRaycaster.far = travelled + 0.2;
      const envHits = this.projectileRaycaster.intersectObjects(this.environmentObjects, true);
      if (envHits.length > 0) {
        const hitPoint = envHits[0].point;
        if (p.kind === 'cannon') {
          this.applyExplosion(hitPoint, p.owner!.config.explosionRadius, p.damage, p.vehicleMultiplier, p.owner);
        } else if (p.kind === 'rocket') {
          this.applyExplosion(hitPoint, PANZERFAUST_RADIUS, p.damage, p.vehicleMultiplier);
        } else {
          this.spawnImpact(hitPoint, envHits[0].face?.normal || dir);
          this.hitTargetWithProjectile(p, hitPoint);
        }
        this.vehicleProjectiles.splice(i, 1);
        continue;
      }

      // 实体命中（球体距离检测）
      const entityHit = this.findProjectileEntityHit(p, prev, dir, travelled);
      if (entityHit) {
        if (p.kind === 'cannon') {
          this.applyExplosion(entityHit, p.owner!.config.explosionRadius, p.damage, p.vehicleMultiplier, p.owner);
        } else if (p.kind === 'rocket') {
          this.applyExplosion(entityHit, PANZERFAUST_RADIUS, p.damage, p.vehicleMultiplier);
        } else {
          this.spawnImpact(entityHit, dir);
          this.hitTargetWithProjectile(p, entityHit);
        }
        this.vehicleProjectiles.splice(i, 1);
        continue;
      }

      // 寿命耗尽：主炮未命中则在当前位置爆炸（触地）
      if (p.life >= p.maxLife) {
        if (p.kind === 'cannon') {
          this.applyExplosion(p.position, p.owner!.config.explosionRadius, p.damage, p.vehicleMultiplier, p.owner);
        } else if (p.kind === 'rocket') {
          this.applyExplosion(p.position, PANZERFAUST_RADIUS, p.damage, p.vehicleMultiplier);
        }
        this.vehicleProjectiles.splice(i, 1);
      }
    }
  }

  private findProjectileEntityHit(
    p: VehicleProjectile,
    start: THREE.Vector3,
    dir: THREE.Vector3,
    step: number
  ): THREE.Vector3 | null {
    if (step < 0.001) return null;

    for (const bot of this.aiSystem.bots) {
      if (bot.state === 'dead') continue;
      const toBot = bot.mesh.position.clone().sub(start);
      const t = toBot.dot(dir);
      if (t < 0 || t > step) continue;
      const closest = start.clone().addScaledVector(dir, t);
      if (closest.distanceTo(bot.mesh.position) < 0.7) return closest;
    }

    // 载具（简化为中心球体：取长宽最大半轴）
    for (const vehicle of this.vehicleSystem.vehicles) {
      if (vehicle.destroyed) continue;
      const half = Math.max(vehicle.config.dimensions.width, vehicle.config.dimensions.length) / 2 + 0.3;
      const toV = vehicle.mesh.position.clone().sub(start);
      const t = toV.dot(dir);
      if (t < 0 || t > step) continue;
      const closest = start.clone().addScaledVector(dir, t);
      if (closest.distanceTo(vehicle.mesh.position) < half) return closest;
    }

    const playerPos = this.player?.getPosition();
    if (playerPos && !this.healthSystem.isDead) {
      const toP = this.tmpVec1.set(playerPos.x, playerPos.y, playerPos.z).sub(start);
      const t = toP.dot(dir);
      if (t >= 0 && t <= step) {
        const closest = start.clone().addScaledVector(dir, t);
        if (closest.distanceTo(this.tmpVec1) < 0.6) return closest;
      }
    }
    return null;
  }

  /** 机枪命中：对 Bot 造成直接伤害 */
  private hitTargetWithProjectile(p: VehicleProjectile, hitPoint: THREE.Vector3): void {
    if (p.kind !== 'machinegun' || !p.owner) return;
    const damage = p.owner.config.weaponDamage;
    for (const bot of this.aiSystem.bots) {
      if (bot.state === 'dead') continue;
      if (bot.mesh.position.distanceTo(hitPoint) < 0.7) {
        bot.takeDamage(damage, hitPoint, this.simulationTimeMs);
        this.audioSystem.play(SoundType.HIT);
        this.spawnBloodEffect(hitPoint, 15);
        this.hitMarkerTime = this.simulationTimeMs;
        break;
      }
    }
  }

  /** 主炮/火箭爆炸：AoE 伤害（Bot/玩家/其他载具）+ 四通道冲击 + 特效 + 破坏物 */
  private applyExplosion(
    position: THREE.Vector3,
    radius: number,
    maxDamage: number,
    vehicleMultiplier = 1,
    excludeVehicle: Vehicle | null = null
  ): void {
    this.audioSystem.play(SoundType.EXPLOSION, position);
    this.spawnExplosionEffect(position.clone());
    this.spawnSmokeEffect(position.clone(), Math.max(3, radius * 0.8));

    // Bot AoE
    for (const bot of this.aiSystem.bots) {
      if (bot.state === 'dead') continue;
      const dist = bot.mesh.position.distanceTo(position);
      if (dist <= radius) {
        const damage = maxDamage * 0.5 * Math.max(0.15, 1 - dist / radius);
        bot.takeDamage(damage, position, this.simulationTimeMs);
      }
    }

    // 玩家 AoE
    const playerPos = this.player?.getPosition();
    if (playerPos && !this.healthSystem.isDead) {
      const dist = this.tmpVec1.set(playerPos.x, playerPos.y, playerPos.z).distanceTo(position);
      if (dist <= radius) {
        const damage = maxDamage * 0.5 * Math.max(0.15, 1 - dist / radius);
        if (this.healthSystem.takeDamage(damage, this.simulationTimeMs)) {
          this.handlePlayerDeath(this.simulationTimeMs);
        }
      }
    }

    // 其他载具 AoE（反坦克火箭对载具高倍率；排除发射者）
    for (const vehicle of this.vehicleSystem.vehicles) {
      if (vehicle === excludeVehicle || vehicle.destroyed) continue;
      const dist = vehicle.mesh.position.distanceTo(position);
      if (dist <= radius) {
        const result = vehicle.takeDamage(
          maxDamage * 0.4 * vehicleMultiplier * Math.max(0.15, 1 - dist / radius),
          position,
          this.simulationTimeMs,
        );
        if (result.killed) this.vehicleSystem.scheduleRespawn(vehicle);
      }
    }

    // 爆炸冲击四通道（预算限幅）
    if (playerPos) {
      const result = this.explosionImpact.trigger(
        { x: position.x, y: position.y, z: position.z },
        { x: playerPos.x, y: playerPos.y, z: playerPos.z },
        this.simulationTimeMs,
      );
      if (result.shakeAmplitude > 0) this.player?.addShake(result.shakeAmplitude * 0.2, 5);
      if (result.tinnitus) this.audioSystem.play(SoundType.TINNITUS, undefined, result.tinnitusIntensity * 0.5);
      if (result.impulse > 0) {
        for (const bot of this.aiSystem.bots) {
          if (bot.state === 'dead') continue;
          if (bot.mesh.position.distanceTo(position) <= radius) bot.takeDamage(0, position, this.simulationTimeMs);
        }
      }
      if (result.dust) this.spawnDustEffect(position.clone());
    }

    // 破坏物 AoE（阶段 7）
    for (const d of this.destructibleSystem.getAll()) {
      if (d.destroyed) continue;
      if (d.mesh.position.distanceTo(position) <= radius) {
        if (this.destructibleSystem.damage(d.id, maxDamage, position)) {
          this.hud.addKillMessage(`${d.config.name} 被炸毁`, this.simulationTimeMs);
        }
      }
    }
  }

  // ====== 射击 ======
  private handleShooting(currentTime: number): void {
    if (this.healthSystem.isDead) return;
    if (this.inVehicle || this.inNetworkVehicle) return; // 载具内用载具武器
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

    const targets = [
      ...this.aiSystem.getAllTargetableMeshes(),
      ...this.environmentObjects,
      ...this.vehicleSystem.vehicles.filter((v) => !v.destroyed).map((v) => v.mesh),
    ];
    const hitInfo = this.raycast.cast(direction, config.range, targets);

    const endPoint = this.tmpVec3.copy(origin).addScaledVector(direction, config.range);

    if (hitInfo.hit && hitInfo.point) {
      endPoint.copy(hitInfo.point);
      this.processHit(hitInfo, config, currentTime);
      this.spawnImpact(hitInfo.point, hitInfo.normal || direction);
    }

    this.spawnTracer(origin, endPoint);
    this.playGunshot(origin);
  }

  private processHit(
    hitInfo: { point?: THREE.Vector3; normal?: THREE.Vector3; distance?: number; target?: THREE.Object3D; isHeadshot?: boolean; bodyPart?: 'head' | 'torso' | 'limb' },
    config: {
      damage: number;
      minDamage: number;
      falloffStart: number;
      falloffEnd: number;
      headshotMultiplier: number;
      range: number;
    },
    currentTime: number,
    _direction?: THREE.Vector3
  ): void {
    // 载具命中（阶段 7）：模块化伤害 + 装甲修正，摧毁后登记重生
    let hitVehicle: Vehicle | null = null;
    if (hitInfo.target) {
      let obj: THREE.Object3D | null = hitInfo.target;
      while (obj) {
        for (const vehicle of this.vehicleSystem.vehicles) {
          if (obj === vehicle.mesh) {
            hitVehicle = vehicle;
            break;
          }
        }
        if (hitVehicle) break;
        obj = obj.parent;
      }
    }
    if (hitVehicle) {
      const result = hitVehicle.takeDamage(config.damage, hitInfo.point, currentTime);
      this.hitMarkerTime = currentTime;
      this.audioSystem.play(SoundType.HIT);
      if (hitInfo.point) this.spawnImpact(hitInfo.point, hitInfo.normal || _direction || new THREE.Vector3());
      if (result.killed) {
        this.vehicleSystem.scheduleRespawn(hitVehicle);
        this.hud.addKillMessage(`${hitVehicle.config.name} 被摧毁（${result.direction}部）`, currentTime);
        this.spawnExplosionEffect(hitVehicle.mesh.position.clone());
        this.spawnSmokeEffect(hitVehicle.mesh.position.clone(), 6);
        if (this.currentVehicle?.vehicle === hitVehicle) {
          this.currentVehicle = null;
          this.inVehicle = false;
        }
      }
      return;
    }

    // 可破坏物命中（阶段 7）：摧毁后移出碰撞与 AI 视线
    if (hitInfo.target) {
      let obj: THREE.Object3D | null = hitInfo.target;
      while (obj) {
        const destructibleId = (obj.userData as { destructibleId?: number } | undefined)?.destructibleId;
        if (typeof destructibleId === 'number') {
          const destroyed = this.destructibleSystem.damage(destructibleId, config.damage, hitInfo.point);
          if (hitInfo.point) this.spawnImpact(hitInfo.point, hitInfo.normal || _direction || new THREE.Vector3());
          if (destroyed) {
            const dObj = this.destructibleSystem.getById(destructibleId);
            this.hud.addKillMessage(`${dObj?.config.name ?? '掩体'} 被摧毁`, currentTime);
            this.audioSystem.play(SoundType.EXPLOSION, hitInfo.point);
          } else {
            this.audioSystem.play(SoundType.HIT);
          }
          return;
        }
        obj = obj.parent;
      }
    }

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
        victimId: `bot_${this.aiSystem.bots.indexOf(hitBot)}`,
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
              victimId: `bot_${this.aiSystem.bots.indexOf(bot)}`,
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

      // 爆炸音效 + 冲击反馈（四通道预算）+ 特效
      if (equip.config.type === EquipmentType.FRAG_GRENADE && elapsed < equip.config.fuseTime + 0.1) {
        this.audioSystem.play(SoundType.EXPLOSION, equip.position);
        this.spawnExplosionEffect(equip.position.clone());
        const playerPos = this.player?.getPosition();
        if (playerPos) {
          const result = this.explosionImpact.trigger(
            { x: equip.position.x, y: equip.position.y, z: equip.position.z },
            { x: playerPos.x, y: playerPos.y, z: playerPos.z },
            currentTime,
          );
          // 相机震动（受每秒预算限制）
          if (result.shakeAmplitude > 0) {
            this.player?.addShake(result.shakeAmplitude * 0.15, 4);
          }
          // 耳鸣：近距离爆炸高频鸣响
          if (result.tinnitus) {
            this.audioSystem.play(SoundType.TINNITUS, undefined, result.tinnitusIntensity * 0.5);
          }
          // 物理冲击：对近距离 Bot 施加击退/受击反馈（不扣血）
          if (result.impulse > 0) {
            for (const bot of this.aiSystem.bots) {
              if (bot.state === 'dead') continue;
              if (bot.mesh.position.distanceTo(equip.position) <= 12) {
                bot.takeDamage(0, equip.position, currentTime);
              }
            }
          }
          // 扬尘
          if (result.dust) {
            this.spawnDustEffect(equip.position.clone());
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
    AIBot.onFire((origin, direction, damage, bot, kind) => {
      const currentTime = this.simulationTimeMs;
      const isHostileToPlayer = bot.team !== this.conquestMode.playerTeam;

      // 反坦克火箭（阶段 7 AI 反载具）：直射弹道实体，命中即爆（对载具高倍率）
      if (kind === 'rocket') {
        this.spawnAIFireTracer(origin, direction, bot);
        this.playGunshot(origin);
        this.vehicleProjectiles.push({
          position: origin.clone(),
          velocity: direction.clone().multiplyScalar(PANZERFAUST_SPEED),
          life: 0,
          maxLife: 2.5,
          kind: 'rocket',
          owner: null,
          hit: false,
          damage,
          vehicleMultiplier: PANZERFAUST_VEHICLE_MULT,
        });
        return;
      }

      // AI 射击弹道轨迹（红色）
      this.spawnAIFireTracer(origin, direction, bot);

      // AI 枪声（分层 + voice 预算）
      this.playGunshot(origin);

      // 1) 载具命中（任意 AI 均可反制敌方载具；友军 AI 不打玩家但打敌方载具）
      for (const vehicle of this.vehicleSystem.vehicles) {
        if (vehicle.destroyed) continue;
        if (vehicle.team === TeamId.NEUTRAL || vehicle.team === bot.team) continue;
        const vPos = vehicle.mesh.position;
        const toV = new THREE.Vector3().subVectors(vPos, origin);
        const projection = toV.dot(direction);
        if (projection < 0 || projection > bot.attackRange) continue;
        const closest = new THREE.Vector3().copy(origin).addScaledVector(direction, projection);
        const half = Math.max(vehicle.config.dimensions.width, vehicle.config.dimensions.length) / 2 + 0.3;
        if (closest.distanceTo(vPos) < half) {
          // 命中概率受精度影响
          if (gameplayRandom() > bot.accuracy) return;
          const result = vehicle.takeDamage(damage, closest, currentTime);
          this.audioSystem.play(SoundType.HIT, closest);
          this.spawnImpact(closest, direction);
          if (result.killed) {
            this.vehicleSystem.scheduleRespawn(vehicle);
            this.hud.addKillMessage(`敌方 ${vehicle.config.name} 被摧毁`, currentTime);
            this.spawnExplosionEffect(vehicle.mesh.position.clone());
            this.spawnSmokeEffect(vehicle.mesh.position.clone(), 6);
            if (this.currentVehicle?.vehicle === vehicle) {
              this.currentVehicle = null;
              this.inVehicle = false;
            }
          }
          return;
        }
      }

      // 2) 玩家命中（只有敌方 AI）
      if (!isHostileToPlayer) return;

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
    if (this.healthSystem.isDead || this.inVehicle || this.inNetworkVehicle) return;
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
        assists: 0, score: playerStats.score, ping: 0, team: 'B',
      });
    }

    // AI bots
    for (let i = 0; i < this.aiSystem.bots.length; i++) {
      const bot = this.aiSystem.bots[i];
      const stats = this.aiStats.get(`bot_${i}`);
      players.push({
        id: `bot_${i}`,
        name: `AI Bot ${i + 1}`,
        kills: stats.kills,
        deaths: stats.deaths,
        assists: stats.assists,
        score: stats.score,
        ping: stats.ping,
        team: bot.team === TeamId.ALLIES ? 'B' : 'A',
      });
    }

    this.scoreboard.updatePlayers(players);
  }

  // ====== 阶段 6 接线：枪声分层 / 视觉基线 / 材质联动 / 特效池 / 冲击反馈 / 动态分辨率 ======
  private playGunshot(origin: THREE.Vector3): void {
    const listener = this.player?.getPosition();
    const distance = listener ? origin.distanceTo(this.tmpVec1.set(listener.x, listener.y, listener.z)) : 0;
    const now = this.simulationTimeMs;
    const listenerPos = listener ? { x: listener.x, y: listener.y, z: listener.z } : { x: 0, y: 0, z: 0 };
    const originPos = { x: origin.x, y: origin.y, z: origin.z };

    for (const layer of resolveAudibleLayers(distance)) {
      const gain = computeLayerGain(layer, distance);
      if (gain <= 0) continue;
      const id = `gun_${layer.name}_${now}_${Math.random().toString(36).slice(2, 8)}`;
      const voice = this.audioVoiceManager.request(
        {
          id,
          priority: layer.priority,
          maxDistance: layer.maxDistance,
          durationMs: 500,
          position: originPos,
        },
        listenerPos,
        now,
      );
      // 预算拒绝或虚拟播放时不创建真实音频节点
      if (!voice || voice.virtual) continue;
      this.audioSystem.play(SoundType.GUNSHOT, origin, gain);
    }
  }

  private applyVisualProfile(): void {
    const weather = this.weatherSystem?.getCurrentWeather() ?? WeatherType.CLEAR;
    const timeOfDay = this.weatherSystem?.getTimeOfDay() ?? 0.3;
    const profile = VISUAL_PROFILES[resolveVisualProfileId(weather, timeOfDay)];

    this.renderer.toneMappingExposure = profile.exposure;
    const sun = colorTemperatureToRGB(profile.directionalColorTemperatureK);
    this.dirLight.color.setRGB(sun.r, sun.g, sun.b);
    this.ambientLight.color.set(profile.ambientColor);
    this.dirLight.shadow.intensity = profile.shadowStrength;
    // 昼夜循环开启时太阳角度由 WeatherSystem 驱动；关闭时按基线固定
    if (!this.dayNightEnabled) {
      this.dirLight.position.set(
        profile.sunDirection.x * 100,
        profile.sunDirection.y * 100,
        profile.sunDirection.z * 100,
      );
    }
  }

  private applyWeatherLink(weather: WeatherType): void {
    const materials: THREE.Material[] = [];
    this.scene.traverse((obj) => {
      const material = (obj as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!material) return;
      if (Array.isArray(material)) materials.push(...material);
      else materials.push(material);
    });
    this.weatherMaterialLink.apply(weather, materials);
  }

  private updateAudioVoices(): void {
    const pos = this.player?.getPosition();
    if (!pos) return;
    this.audioVoiceManager.update(this.simulationTimeMs, { x: pos.x, y: pos.y, z: pos.z });
  }

  private updateVfxPool(): void {
    const pos = this.player?.getPosition();
    if (!pos) return;
    this.vfxPool.update(this.simulationTimeMs, { x: pos.x, y: pos.y, z: pos.z });
  }

  private spawnDustEffect(position: THREE.Vector3): void {
    const count = 12;
    const positions = new Float32Array(count * 3);
    const velocities: THREE.Vector3[] = [];
    for (let i = 0; i < count; i++) {
      positions[i * 3] = position.x;
      positions[i * 3 + 1] = position.y + 0.2;
      positions[i * 3 + 2] = position.z;
      const theta = gameplayRandom() * Math.PI * 2;
      const speed = 1.5 + gameplayRandom() * 3;
      velocities.push(new THREE.Vector3(Math.cos(theta) * speed, gameplayRandom() * 1.5, Math.sin(theta) * speed));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({ color: 0x9a8f80, size: 0.18, transparent: true, opacity: 0.7 });
    const points = new THREE.Points(geo, mat);
    points.userData = { velocities, life: 0, maxLife: 0.7 };
    this.scene.add(points);
    this.sparkEffects.push(points);
  }

  private updateDynamicResolution(time: number): void {
    if (this.graphicsLevel === 'low') return; // 低画质固定 1x
    const frameTime = this.lastFrameTime === 0 ? 16.7 : time - this.lastFrameTime;
    this.lastFrameTime = time;
    const scale = this.dynamicResolution.update(frameTime, time);
    const targetRatio = this.basePixelRatio * scale;
    if (Math.abs(targetRatio - this.appliedPixelRatio) > 0.001) {
      this.renderer.setPixelRatio(targetRatio);
      this.appliedPixelRatio = targetRatio;
    }
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
    this.updateDynamicResolution(time);
  };

  private simulateFixedStep(dt: number, time: number): void {
    this.roundFlow.update(dt);
    if (!this.roundFlow.canSimulateCombat()) return;

    // 玩家更新（联网驾驶时停用本地玩家控制；联网死亡时服务端权威停摆）
    if (this.player && !this.healthSystem.isDead && !this.inVehicle && !this.inNetworkVehicle && (!this.networkGameClient || this.networkAlive)) {
      this.player.update(this.inputManager.state, this.pendingMouseMovement, dt);
    }
    this.pendingMouseMovement.x = 0;
    this.pendingMouseMovement.y = 0;

    // 联网权威回写：本地渲染位置向服务端预测轨迹平滑收敛
    // （水平 x/z；垂直 y 与跳跃/碰撞保留本地物理，服务端移动模型暂无 y 轴与碰撞）
    if (this.player && this.clientPrediction && !this.healthSystem.isDead && !this.inVehicle && !this.inNetworkVehicle && (!this.networkGameClient || this.networkAlive)) {
      const rs = this.clientPrediction.renderState;
      const pos = this.player.getPosition();
      if (pos) {
        const nx = pos.x + (rs.x - pos.x) * NETWORK_POSITION_CONVERGE;
        const nz = pos.z + (rs.z - pos.z) * NETWORK_POSITION_CONVERGE;
        if (Math.abs(nx - pos.x) > 0.0001 || Math.abs(nz - pos.z) > 0.0001) {
          this.player.teleportHorizontal(nx, nz);
        }
      }
    }

    // 载具控制：联网模式走服务端权威视觉/驾驶，单机模式走本地物理模拟
    if (this.networkGameClient && this.networkVehicles) {
      this.networkVehicles.update(dt, this.simulationTimeMs);
      this.updateNetworkVehicleControl(dt);
    } else {
      this.updateVehicleControl(dt);
      this.vehicleSystem.update(dt, this.simulationTimeMs);
    }
    this.updateVehicleProjectiles(dt);

    // 局部破坏
    this.destructibleSystem.update(dt);

    // 武器
    this.weaponSystem.update(time);
    const weapon = this.weaponSystem.getCurrentWeapon();
    const isMoving = this.inputManager.state.forward || this.inputManager.state.backward ||
      this.inputManager.state.left || this.inputManager.state.right;

    // ADS 瞄准状态
    const isAiming = this.inputManager.state.aim && !this.inVehicle && !this.inNetworkVehicle;
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
    this.updateVfxPool();

    // 战术装备
    this.equipmentSystem.update(dt, time);
    // 地雷触发检测：以敌方载具为目标
    this.mineSystem.update(
      dt,
      this.vehicleSystem.vehicles
        .filter((v) => !v.destroyed)
        .map((v) => ({
          position: v.mesh.position,
          alive: !v.destroyed,
          team: v.team,
          vehicle: v,
        })),
    );
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
    // 视觉基线：按天气与时刻切换曝光/色温/阴影（每帧跟随天气与昼夜）
    this.applyVisualProfile();

    // 音频监听器
    if (this.player) {
      const pos = this.player.getPosition();
      if (pos) {
        const forward = this.tmpVec2;
        this.camera.getWorldDirection(forward);
        this.audioSystem.updateListener(pos, forward, this.tmpVec3.set(0, 1, 0));
      }
    }
    // 音频 voice 预算：真实/虚拟转换与过期清理
    this.updateAudioVoices();

    // 联网死亡/重生生命周期（服务端权威 alive 驱动死亡遮罩/重生传送/倒计时）
    this.updateNetworkLifecycle(time);

    // 结算遮罩倒计时（联网回合结束 → 新回合）
    if (this.roundOverlay && this.roundOverlay.style.display !== 'none') {
      const remaining = Math.max(0, Math.ceil((this.roundEndAt - time) / 1000));
      const el = this.roundOverlay.querySelector('#round-timer');
      if (el) el.textContent = `${remaining} 秒后开始新回合...`;
    }

    // 网络：输入序列发送（服务端权威移动裁决，对齐服务器 tick 频率）+ 远端快照插值渲染
    if (this.networkGameClient && this.player && !this.inNetworkVehicle && this.networkAlive && time - this.lastNetworkUpdate > this.networkUpdateInterval) {
      const input = this.inputManager.state;
      const rot = this.player.getRotation();
      this.networkGameClient.sendInput({
        moveForward: input.forward,
        moveBackward: input.backward,
        moveLeft: input.left,
        moveRight: input.right,
        sprint: input.sprint,
        fire: input.fire,
        aimYaw: rot.yaw,
        aimPitch: rot.pitch,
      });
      this.lastNetworkUpdate = time;
    }
    this.syncRemotePlayers();

    // HUD
    const currentEquip = EQUIPMENT_ORDER[this.currentEquipmentIndex];
    let equipCount = 1;
    let equipName = '手雷';
    if (currentEquip === EquipmentType.MINE) {
      equipCount = Math.max(0, 3 - this.mineSystem.getActiveCount(this.conquestMode.playerTeam));
      equipName = '反坦克地雷';
    } else {
      const equipConfig = this.equipmentSystem.getActiveEquipment().find(e => e.config.type === currentEquip);
      equipCount = equipConfig ? equipConfig.count : 1;
      equipName = equipConfig?.config.name || '手雷';
    }

    // 交互提示（联网模式：服务端权威载具；单机模式：本地 VehicleSystem）
    let interactionPrompt: string | null = null;
    if (this.networkGameClient && this.networkVehicles) {
      if (!this.inNetworkVehicle && !this.healthSystem.isDead) {
        const playerPos = this.player?.getPosition();
        if (playerPos && this.networkVehicles.findNear(playerPos.x, playerPos.z, 4)) {
          interactionPrompt = '按 E 进入载具';
        }
      } else if (this.inNetworkVehicle) {
        interactionPrompt = '按 E 离开载具';
      }
    } else if (!this.inVehicle && !this.healthSystem.isDead) {
      const playerPos = this.player?.getPosition();
      if (playerPos) {
        for (const vehicle of this.vehicleSystem.vehicles) {
          if (!vehicle.destroyed) {
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
    let tickets = conquestHud.tickets;
    let controlPoints = conquestHud.controlPoints.map(cp => ({ id: cp.id, owner: cp.owner, progress: cp.progress }));
    // 联网模式（收到服务端 game_state）：HUD 兵力/据点改用服务端权威数据驱动，
    // 本地 AI 对局的征服模拟不再影响显示（场景据点视觉仍由本地模拟维护，后续切片统一）
    const gs = this.serverGameState;
    if (gs && (gs.phase === 'started' || gs.phase === 'ended')) {
      tickets = { axis: gs.tickets[0], allies: gs.tickets[1] };
      controlPoints = gs.objectives.map(o => ({
        id: o.id,
        owner: objectiveOwnerToTeam(o.owner),
        progress: o.progress,
      }));
    }

    this.hud.update(
      {
        health: this.networkGameClient ? (this.networkGameClient.getOwnState()?.health ?? this.healthSystem.currentHealth) : this.healthSystem.currentHealth, maxHealth: this.healthSystem.maxHealth,
        ammo: weapon.currentAmmo, reserveAmmo: weapon.reserveAmmo, weaponName: weapon.config.name,
        killCount: this.killCount, deathCount: this.deathCount,
        isReloading: weapon.isReloading, reloadProgress: weapon.getReloadProgress(time),
        hitMarker: time - this.hitMarkerTime < 150, hitMarkerTime: this.hitMarkerTime,
        hitMarkerHeadshot: time - this.hitMarkerHeadshotTime < 250,
        damageIndicator: null, score: this.killCount,
        position: this.player?.getPosition() || { x: 0, y: 0, z: 0 },
        stamina: this.player?.getStaminaPercentage(),
        equipmentCount: equipCount,
        equipmentName: equipName,
        interactionPrompt,
        damageDirection: showDamageDir,
        spawnProtection: this.healthSystem.getSpawnProtectionRemaining(time),
        axisTickets: tickets.axis,
        alliesTickets: tickets.allies,
        playerTeam: this.conquestMode.playerTeam,
        controlPoints,
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
      const voiceStats = this.audioVoiceManager.getStats();
      this.performancePanel.update(snapshot, this.config.benchmark.enabled, {
        voicesReal: voiceStats.real,
        voicesVirtual: voiceStats.virtual,
        vfxActive: this.vfxPool.getActiveCount(),
      });
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
    this.networkGameClient?.disconnect();
    this.networkGameClient = null;
    this.serverGameState = null;
    this.serverObjectiveLayoutApplied = false;
    this.clientPrediction = null;
    this.networkVehicles?.clear();
    this.networkVehicles = null;
    this.inNetworkVehicle = false;
    for (const mesh of this.remotePlayerMeshes.values()) {
      this.scene.remove(mesh);
    }
    this.remotePlayerMeshes.clear();
    this.aiSystem?.dispose();
    this.hud?.dispose();
    this.mainMenu?.dispose();
    this.settingsMenu?.dispose();
    this.scoreboard?.dispose();
    this.deploymentMenu?.dispose();
    this.audioSystem?.dispose();
    this.weatherSystem?.dispose();
    this.vfxPool.dispose();
    this.audioVoiceManager.dispose();
    this.weatherMaterialLink.clear();
    this.vehicleProjectiles = [];
    this.vehicleSystem?.dispose();
    this.mineSystem?.dispose();
    for (const obj of this.visualObjects) {
      this.scene.remove(obj);
      obj.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          for (const m of mats) m.dispose();
        }
      });
    }
    this.visualObjects = [];
    this.destructibleSystem?.dispose();
    this.equipmentSystem?.dispose();
    this.mapManager?.dispose();
    this.performancePanel.dispose();
    this.events.clear();
    this.renderer.dispose();
  }
}
