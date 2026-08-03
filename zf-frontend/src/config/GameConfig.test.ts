import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GAME_CONFIG,
  GAME_CONFIG_VERSION,
  resolveGameConfig,
  validateGameConfig,
} from './GameConfig';

describe('GameConfig', () => {
  it('provides a valid versioned default config', () => {
    expect(DEFAULT_GAME_CONFIG.version).toBe(GAME_CONFIG_VERSION);
    expect(validateGameConfig(DEFAULT_GAME_CONFIG)).toEqual([]);
  });

  it('enables the deterministic benchmark through the query string', () => {
    const config = resolveGameConfig('?benchmark=1');

    expect(config.benchmark.enabled).toBe(true);
    expect(config.ai.axisCount).toBe(4);
    expect(config.ai.alliesCount).toBe(4);
    expect(config.benchmark.vehicleCount).toBe(2);
  });

  it('uses a 60 Hz bounded simulation by default', () => {
    expect(DEFAULT_GAME_CONFIG.simulation).toEqual({
      stepHz: 60,
      maxFrameSeconds: 0.1,
      maxSubSteps: 5,
    });
  });

  it('rejects invalid movement and network values', () => {
    const invalid = {
      ...DEFAULT_GAME_CONFIG,
      player: {
        ...DEFAULT_GAME_CONFIG.player,
        walkSpeed: 0,
      },
      network: {
        ...DEFAULT_GAME_CONFIG.network,
        updateIntervalMs: 0,
      },
    };

    expect(validateGameConfig(invalid)).toEqual([
      'player.walkSpeed must be greater than 0',
      'network.updateIntervalMs must be greater than 0',
    ]);
  });
});
