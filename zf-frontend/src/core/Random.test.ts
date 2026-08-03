import { afterEach, describe, expect, it } from 'vitest';
import { gameplayRandom, useGameplaySeed, useSystemRandom } from './Random';

describe('gameplay random source', () => {
  afterEach(() => useSystemRandom());

  it('replays the same sequence for the same seed', () => {
    useGameplaySeed(42);
    const first = [gameplayRandom(), gameplayRandom(), gameplayRandom()];

    useGameplaySeed(42);
    const second = [gameplayRandom(), gameplayRandom(), gameplayRandom()];

    expect(second).toEqual(first);
  });

  it('produces values within the unit interval', () => {
    useGameplaySeed(7);

    for (let index = 0; index < 100; index++) {
      expect(gameplayRandom()).toBeGreaterThanOrEqual(0);
      expect(gameplayRandom()).toBeLessThan(1);
    }
  });
});
