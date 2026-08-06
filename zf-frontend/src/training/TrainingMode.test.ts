import { describe, it, expect, beforeEach } from 'vitest';
import { TrainingMode, TRAINING_STEPS, TARGET_HITS_REQUIRED, type TrainingStepId } from './TrainingMode';

describe('TrainingMode（阶段 10 P1：新手训练场教程步骤管理）', () => {
  let mode: TrainingMode;

  beforeEach(() => {
    mode = new TrainingMode();
  });

  it('初始状态：当前为第一步，未完成，进度 0/8', () => {
    expect(mode.current?.id).toBe('move');
    expect(mode.isCompleted).toBe(false);
    expect(mode.progress).toEqual({ done: 0, total: TRAINING_STEPS.length });
    expect(mode.steps.length).toBe(8);
  });

  it('顺序完成当前步骤后推进到下一步', () => {
    expect(mode.completeStep('move')).toBe(true);
    expect(mode.current?.id).toBe('mobility');
    expect(mode.completedIdsList).toContain('move');
    expect(mode.progress.done).toBe(1);
  });

  it('乱序完成被忽略（只能完成当前步骤）', () => {
    expect(mode.completeStep('shoot')).toBe(false);
    expect(mode.current?.id).toBe('move');
    expect(mode.progress.done).toBe(0);
  });

  it('重复完成同一步骤被忽略', () => {
    mode.completeStep('move');
    expect(mode.completeStep('move')).toBe(false);
    expect(mode.current?.id).toBe('mobility');
  });

  it('按顺序走完所有步骤后 isCompleted 为 true', () => {
    const ids = TRAINING_STEPS.map((s) => s.id as TrainingStepId);
    for (const id of ids) {
      expect(mode.completeStep(id)).toBe(true);
    }
    expect(mode.isCompleted).toBe(true);
    expect(mode.current).toBeNull();
    expect(mode.progress.done).toBe(8);
  });

  it('registerTargetHit 只在射击步骤计数，达到阈值完成射击', () => {
    mode.completeStep('move');
    mode.completeStep('mobility');
    expect(mode.current?.id).toBe('shoot');
    for (let i = 0; i < TARGET_HITS_REQUIRED - 1; i++) {
      expect(mode.registerTargetHit()).toBe(false);
    }
    expect(mode.targetHitsCount).toBe(TARGET_HITS_REQUIRED - 1);
    expect(mode.registerTargetHit()).toBe(true);
    expect(mode.current?.id).toBe('reload');
  });

  it('registerWeaponSwitch：首次记录基线，切到不同武器才完成（同武器不误判）', () => {
    mode.completeStep('move');
    mode.completeStep('mobility');
    mode.completeStep('shoot');
    mode.completeStep('reload');
    expect(mode.current?.id).toBe('weapon');
    // 首次按 1（当前武器，未切换）：只记录基线
    expect(mode.registerWeaponSwitch('assault_rifle')).toBe(false);
    expect(mode.current?.id).toBe('weapon');
    // 再按 2（切换到不同武器）：完成
    expect(mode.registerWeaponSwitch('smg')).toBe(true);
    expect(mode.current?.id).toBe('grenade');
  });

  it('非装备步骤 registerWeaponSwitch 不生效', () => {
    expect(mode.registerWeaponSwitch('smg')).toBe(false);
    expect(mode.current?.id).toBe('move');
  });

  it('非射击步骤命中靶子不计数', () => {
    expect(mode.registerTargetHit()).toBe(false);
    expect(mode.targetHitsCount).toBe(0);
  });

  it('reset 复位全部状态', () => {
    mode.completeStep('move');
    mode.registerTargetHit(); // 非 shoot 步骤，无效果
    mode.completeStep('mobility');
    mode.completeStep('shoot');
    expect(mode.progress.done).toBe(3);
    mode.reset();
    expect(mode.current?.id).toBe('move');
    expect(mode.progress.done).toBe(0);
    expect(mode.targetHitsCount).toBe(0);
    expect(mode.isCompleted).toBe(false);
  });
});
