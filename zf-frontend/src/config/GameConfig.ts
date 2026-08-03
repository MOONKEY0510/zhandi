import { WeatherType } from '../environment/WeatherSystem';

export const GAME_CONFIG_VERSION = 1 as const;

export interface GameConfig {
  version: typeof GAME_CONFIG_VERSION;
  player: {
    height: number;
    crouchHeight: number;
    radius: number;
    walkSpeed: number;
    sprintSpeed: number;
    crouchSpeed: number;
    jumpForce: number;
    airControl: number;
    mouseSensitivity: number;
    acceleration: number;
    maxStamina: number;
    staminaDrainRate: number;
    staminaRegenRate: number;
    staminaMinToSprint: number;
    fallDamageThreshold: number;
    fallDamageMultiplier: number;
    baseFov: number;
    sprintFov: number;
    adsFov: number;
    fovLerpSpeed: number;
  };
  combat: {
    startingReserveAmmo: number;
  };
  ai: {
    axisCount: number;
    alliesCount: number;
  };
  network: {
    serverUrl: string;
    updateIntervalMs: number;
  };
  simulation: {
    stepHz: number;
    maxFrameSeconds: number;
    maxSubSteps: number;
  };
  performance: {
    targetFps: number;
    maxDrawCalls: number;
    maxTriangles: number;
    maxTextureMemoryMB: number;
    maxFrameTimeMs: number;
    sampleWindowSize: number;
    panelRefreshIntervalMs: number;
  };
  benchmark: {
    enabled: boolean;
    seed: number;
    weather: WeatherType;
    vehicleCount: number;
    autoWeather: boolean;
    dayNightCycle: boolean;
  };
}

export const DEFAULT_GAME_CONFIG: Readonly<GameConfig> = Object.freeze({
  version: GAME_CONFIG_VERSION,
  player: Object.freeze({
    height: 1.7,
    crouchHeight: 1,
    radius: 0.4,
    walkSpeed: 5,
    sprintSpeed: 8,
    crouchSpeed: 2.5,
    jumpForce: 7,
    airControl: 0.3,
    mouseSensitivity: 0.002,
    acceleration: 12,
    maxStamina: 100,
    staminaDrainRate: 25,
    staminaRegenRate: 15,
    staminaMinToSprint: 20,
    fallDamageThreshold: 8,
    fallDamageMultiplier: 5,
    baseFov: 75,
    sprintFov: 85,
    adsFov: 55,
    fovLerpSpeed: 8,
  }),
  combat: Object.freeze({
    startingReserveAmmo: 120,
  }),
  ai: Object.freeze({
    axisCount: 4,
    alliesCount: 4,
  }),
  network: Object.freeze({
    serverUrl: 'ws://localhost:8080',
    updateIntervalMs: 50,
  }),
  simulation: Object.freeze({
    stepHz: 60,
    maxFrameSeconds: 0.1,
    maxSubSteps: 5,
  }),
  performance: Object.freeze({
    targetFps: 60,
    maxDrawCalls: 350,
    maxTriangles: 750_000,
    maxTextureMemoryMB: 256,
    maxFrameTimeMs: 16.67,
    sampleWindowSize: 600,
    panelRefreshIntervalMs: 500,
  }),
  benchmark: Object.freeze({
    enabled: false,
    seed: 0x5a48414e,
    weather: WeatherType.CLEAR,
    vehicleCount: 2,
    autoWeather: false,
    dayNightCycle: false,
  }),
});

function readBenchmarkFlag(search = window.location.search): boolean {
  return new URLSearchParams(search).get('benchmark') === '1';
}

export function resolveGameConfig(search = window.location.search): Readonly<GameConfig> {
  const benchmarkEnabled = readBenchmarkFlag(search);

  return {
    ...DEFAULT_GAME_CONFIG,
    benchmark: {
      ...DEFAULT_GAME_CONFIG.benchmark,
      enabled: benchmarkEnabled,
    },
  };
}

export function validateGameConfig(config: GameConfig): string[] {
  const errors: string[] = [];

  if (config.version !== GAME_CONFIG_VERSION) errors.push('Unsupported game config version');
  if (config.player.walkSpeed <= 0) errors.push('player.walkSpeed must be greater than 0');
  if (config.player.sprintSpeed < config.player.walkSpeed) {
    errors.push('player.sprintSpeed must be greater than or equal to player.walkSpeed');
  }
  if (config.network.updateIntervalMs <= 0) errors.push('network.updateIntervalMs must be greater than 0');
  if (config.simulation.stepHz <= 0) errors.push('simulation.stepHz must be greater than 0');
  if (config.simulation.maxSubSteps < 1) errors.push('simulation.maxSubSteps must be at least 1');
  if (config.ai.axisCount < 0 || config.ai.alliesCount < 0) errors.push('AI counts cannot be negative');
  if (config.performance.sampleWindowSize < 10) {
    errors.push('performance.sampleWindowSize must be at least 10');
  }

  return errors;
}
