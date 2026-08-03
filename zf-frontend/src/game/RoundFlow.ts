export enum RoundPhase {
  DEPLOYMENT = 'deployment',
  COUNTDOWN = 'countdown',
  COMBAT = 'combat',
  RESULTS = 'results',
}

export interface RoundFlowConfig {
  deploymentSeconds: number;
  countdownSeconds: number;
  resultsSeconds: number;
}

const DEFAULT_CONFIG: RoundFlowConfig = {
  deploymentSeconds: 10,
  countdownSeconds: 5,
  resultsSeconds: 12,
};

export class RoundFlow {
  phase = RoundPhase.DEPLOYMENT;
  elapsedSeconds = 0;
  roundNumber = 1;
  onPhaseChange: ((phase: RoundPhase) => void) | null = null;
  onRestart: (() => void) | null = null;

  constructor(readonly config: RoundFlowConfig = DEFAULT_CONFIG) {}

  update(dt: number): void {
    this.elapsedSeconds += dt;
    if (this.phase === RoundPhase.DEPLOYMENT && this.elapsedSeconds >= this.config.deploymentSeconds) {
      this.transition(RoundPhase.COUNTDOWN);
    } else if (this.phase === RoundPhase.COUNTDOWN && this.elapsedSeconds >= this.config.countdownSeconds) {
      this.transition(RoundPhase.COMBAT);
    } else if (this.phase === RoundPhase.RESULTS && this.elapsedSeconds >= this.config.resultsSeconds) {
      this.roundNumber++;
      this.onRestart?.();
      this.transition(RoundPhase.DEPLOYMENT);
    }
  }

  finishRound(): void {
    if (this.phase === RoundPhase.COMBAT) this.transition(RoundPhase.RESULTS);
  }

  canSimulateCombat(): boolean {
    return this.phase === RoundPhase.COMBAT;
  }

  private transition(phase: RoundPhase): void {
    this.phase = phase;
    this.elapsedSeconds = 0;
    this.onPhaseChange?.(phase);
  }
}
