export interface FixedStepAdvanceResult {
  steps: number;
  alpha: number;
  droppedTimeSeconds: number;
}

export interface FixedStepClockOptions {
  stepSeconds: number;
  maxFrameSeconds: number;
  maxSubSteps: number;
}

const DEFAULT_OPTIONS: FixedStepClockOptions = {
  stepSeconds: 1 / 60,
  maxFrameSeconds: 0.1,
  maxSubSteps: 5,
};

export class FixedStepClock {
  private accumulatorSeconds = 0;
  private lastTimeMs: number | null = null;
  private droppedTimeSeconds = 0;
  private readonly options: FixedStepClockOptions;

  constructor(options: Partial<FixedStepClockOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };

    if (this.options.stepSeconds <= 0) throw new Error('stepSeconds must be greater than 0');
    if (this.options.maxFrameSeconds <= 0) throw new Error('maxFrameSeconds must be greater than 0');
    if (this.options.maxSubSteps < 1) throw new Error('maxSubSteps must be at least 1');
  }

  advance(currentTimeMs: number, simulate: (stepSeconds: number) => void): FixedStepAdvanceResult {
    if (this.lastTimeMs === null) {
      this.lastTimeMs = currentTimeMs;
      return this.getResult(0);
    }

    const elapsedSeconds = Math.max(0, (currentTimeMs - this.lastTimeMs) / 1_000);
    this.lastTimeMs = currentTimeMs;

    const clampedElapsed = Math.min(elapsedSeconds, this.options.maxFrameSeconds);
    this.droppedTimeSeconds += elapsedSeconds - clampedElapsed;
    this.accumulatorSeconds += clampedElapsed;

    const stepEpsilon = this.options.stepSeconds * 1e-9;
    let steps = 0;
    while (
      this.accumulatorSeconds + stepEpsilon >= this.options.stepSeconds &&
      steps < this.options.maxSubSteps
    ) {
      simulate(this.options.stepSeconds);
      this.accumulatorSeconds = Math.max(0, this.accumulatorSeconds - this.options.stepSeconds);
      steps++;
    }

    if (this.accumulatorSeconds >= this.options.stepSeconds) {
      const retained = this.accumulatorSeconds % this.options.stepSeconds;
      this.droppedTimeSeconds += this.accumulatorSeconds - retained;
      this.accumulatorSeconds = retained;
    }

    return this.getResult(steps);
  }

  reset(currentTimeMs: number | null = null): void {
    this.accumulatorSeconds = 0;
    this.lastTimeMs = currentTimeMs;
  }

  getStepSeconds(): number {
    return this.options.stepSeconds;
  }

  private getResult(steps: number): FixedStepAdvanceResult {
    return {
      steps,
      alpha: this.accumulatorSeconds / this.options.stepSeconds,
      droppedTimeSeconds: this.droppedTimeSeconds,
    };
  }
}
