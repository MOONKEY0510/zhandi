export enum CharacterAnimationState {
  IDLE = 'idle',
  MOVE = 'move',
  SPRINT = 'sprint',
  CROUCH = 'crouch',
  JUMP = 'jump',
  LAND = 'land',
  RELOAD = 'reload',
  FIRE = 'fire',
  HIT = 'hit',
  DOWNED = 'downed',
  REVIVE = 'revive',
}

export type AnimationMarker = 'footstep_left' | 'footstep_right' | 'magazine_out' | 'magazine_in' | 'bolt' | 'muzzle' | 'revive_complete';

export interface AnimationTransitionContext {
  moving: boolean;
  sprinting: boolean;
  crouching: boolean;
  grounded: boolean;
  justLanded: boolean;
  reloading: boolean;
  firing: boolean;
  hit: boolean;
  downed: boolean;
  reviving: boolean;
}

export class CharacterAnimationStateMachine {
  state = CharacterAnimationState.IDLE;
  onStateChange: ((state: CharacterAnimationState) => void) | null = null;
  onMarker: ((marker: AnimationMarker) => void) | null = null;

  update(context: AnimationTransitionContext): CharacterAnimationState {
    const next = this.resolve(context);
    if (next !== this.state) {
      this.state = next;
      this.onStateChange?.(next);
    }
    return this.state;
  }

  emitMarker(marker: AnimationMarker): void {
    this.onMarker?.(marker);
  }

  private resolve(context: AnimationTransitionContext): CharacterAnimationState {
    if (context.downed) return CharacterAnimationState.DOWNED;
    if (context.reviving) return CharacterAnimationState.REVIVE;
    if (context.hit) return CharacterAnimationState.HIT;
    if (context.reloading) return CharacterAnimationState.RELOAD;
    if (context.firing) return CharacterAnimationState.FIRE;
    if (context.justLanded) return CharacterAnimationState.LAND;
    if (!context.grounded) return CharacterAnimationState.JUMP;
    if (context.crouching) return CharacterAnimationState.CROUCH;
    if (context.sprinting && context.moving) return CharacterAnimationState.SPRINT;
    if (context.moving) return CharacterAnimationState.MOVE;
    return CharacterAnimationState.IDLE;
  }
}
