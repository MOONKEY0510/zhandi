export enum GameState {
  BOOT = 'boot',
  MENU = 'menu',
  LOADING = 'loading',
  PLAYING = 'playing',
  PAUSED = 'paused',
  ROUND_END = 'round_end',
  DISPOSED = 'disposed',
}

const ALLOWED_TRANSITIONS: Readonly<Record<GameState, readonly GameState[]>> = {
  [GameState.BOOT]: [GameState.MENU, GameState.DISPOSED],
  [GameState.MENU]: [GameState.LOADING, GameState.DISPOSED],
  [GameState.LOADING]: [GameState.PLAYING, GameState.MENU, GameState.DISPOSED],
  [GameState.PLAYING]: [GameState.PAUSED, GameState.ROUND_END, GameState.DISPOSED],
  [GameState.PAUSED]: [GameState.PLAYING, GameState.MENU, GameState.DISPOSED],
  [GameState.ROUND_END]: [GameState.MENU, GameState.LOADING, GameState.DISPOSED],
  [GameState.DISPOSED]: [],
};

export type GameStateListener = (next: GameState, previous: GameState) => void;

export class GameStateMachine {
  private state = GameState.BOOT;
  private readonly listeners = new Set<GameStateListener>();

  getState(): GameState {
    return this.state;
  }

  is(...states: GameState[]): boolean {
    return states.includes(this.state);
  }

  canTransition(next: GameState): boolean {
    return ALLOWED_TRANSITIONS[this.state].includes(next);
  }

  transition(next: GameState): void {
    if (next === this.state) return;
    if (!this.canTransition(next)) {
      throw new Error(`Invalid game state transition: ${this.state} -> ${next}`);
    }

    const previous = this.state;
    this.state = next;
    for (const listener of this.listeners) listener(next, previous);
  }

  subscribe(listener: GameStateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
