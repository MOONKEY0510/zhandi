export type RandomSource = () => number;

function mulberry32(seed: number): RandomSource {
  let state = seed >>> 0;

  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

let gameplayRandomSource: RandomSource = Math.random;

export function useGameplaySeed(seed: number): void {
  gameplayRandomSource = mulberry32(seed);
}

export function useSystemRandom(): void {
  gameplayRandomSource = Math.random;
}

export function gameplayRandom(): number {
  return gameplayRandomSource();
}

export function randomRange(min: number, max: number): number {
  return min + gameplayRandom() * (max - min);
}

export function randomInt(minInclusive: number, maxExclusive: number): number {
  return Math.floor(randomRange(minInclusive, maxExclusive));
}
