export interface RecordedInput<State> {
  tick: number;
  state: State;
}

export class InputRecording<State> {
  private readonly frames: RecordedInput<State>[] = [];

  record(tick: number, state: State): void {
    if (!Number.isInteger(tick) || tick < 0) throw new Error('tick must be a non-negative integer');
    const previous = this.frames.at(-1);
    if (previous && tick <= previous.tick) throw new Error('ticks must be recorded in ascending order');
    this.frames.push({ tick, state: structuredClone(state) });
  }

  getFrame(tick: number): RecordedInput<State> | null {
    return this.frames.find((frame) => frame.tick === tick) ?? null;
  }

  replay(visitor: (frame: RecordedInput<State>) => void): void {
    for (const frame of this.frames) visitor({ tick: frame.tick, state: structuredClone(frame.state) });
  }

  serialize(): string {
    return JSON.stringify(this.frames);
  }

  static deserialize<State>(serialized: string): InputRecording<State> {
    const recording = new InputRecording<State>();
    const frames = JSON.parse(serialized) as RecordedInput<State>[];
    for (const frame of frames) recording.record(frame.tick, frame.state);
    return recording;
  }
}
