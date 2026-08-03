import { describe, expect, it } from 'vitest';
import { InputRecording } from './InputRecording';

interface TestInput {
  forward: boolean;
  fire: boolean;
}

describe('InputRecording', () => {
  it('serializes and replays immutable input frames', () => {
    const recording = new InputRecording<TestInput>();
    const input = { forward: true, fire: false };
    recording.record(0, input);
    input.forward = false;
    recording.record(1, input);

    const restored = InputRecording.deserialize<TestInput>(recording.serialize());
    const states: TestInput[] = [];
    restored.replay((frame) => states.push(frame.state));

    expect(states).toEqual([
      { forward: true, fire: false },
      { forward: false, fire: false },
    ]);
  });

  it('rejects duplicate or out-of-order ticks', () => {
    const recording = new InputRecording<TestInput>();
    recording.record(2, { forward: true, fire: false });

    expect(() => recording.record(2, { forward: false, fire: true })).toThrow(
      'ticks must be recorded in ascending order',
    );
  });
});
