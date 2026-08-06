import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ReportDialog } from './ReportDialog';
import type { ReportablePlayer } from './ReportDialog';

const PLAYERS: ReportablePlayer[] = [
  { id: 'local-player', name: '玩家', team: 'B' },
  { id: 'bot_0', name: 'AI Bot 1', team: 'A' },
  { id: 'bot_1', name: 'AI Bot 2', team: 'B' },
];

describe('ReportDialog（阶段 10 P1：举报玩家入口）', () => {
  let dialog: ReportDialog;
  beforeEach(() => {
    dialog = new ReportDialog();
  });
  afterEach(() => {
    dialog.dispose();
  });

  it('初始隐藏；show 后可见且填充玩家下拉', () => {
    expect(dialog.container.style.display).toBe('none');
    dialog.show(PLAYERS);
    expect(dialog.container.style.display).toBe('flex');
    const options = dialog.container.querySelectorAll('#report-player option');
    expect(options).toHaveLength(3);
    expect(options[1].textContent).toContain('AI Bot 1');
  });

  it('提交默认选中首个玩家 + 默认理由 cheat', () => {
    const onSubmitted = vi.fn();
    dialog.onSubmitted = onSubmitted;
    dialog.show(PLAYERS);
    const submit = dialog.container.querySelector('#report-submit') as HTMLButtonElement;
    submit.click();
    expect(onSubmitted).toHaveBeenCalledTimes(1);
    expect(onSubmitted.mock.calls[0][0]).toMatchObject({
      targetId: 'local-player',
      targetName: '玩家',
      reason: 'cheat',
    });
    // 提交后隐藏
    expect(dialog.container.style.display).toBe('none');
  });

  it('切换理由按钮后提交使用所选理由', () => {
    const onSubmitted = vi.fn();
    dialog.onSubmitted = onSubmitted;
    dialog.show(PLAYERS);
    const reasonBtn = dialog.container.querySelector('[data-reason="toxic"]') as HTMLButtonElement;
    reasonBtn.click();
    const submit = dialog.container.querySelector('#report-submit') as HTMLButtonElement;
    submit.click();
    expect(onSubmitted.mock.calls[0][0].reason).toBe('toxic');
  });

  it('备注内容随提交带出', () => {
    const onSubmitted = vi.fn();
    dialog.onSubmitted = onSubmitted;
    dialog.show(PLAYERS);
    const note = dialog.container.querySelector('#report-note') as HTMLTextAreaElement;
    note.value = '疑似自瞄，全程锁头';
    const submit = dialog.container.querySelector('#report-submit') as HTMLButtonElement;
    submit.click();
    expect(onSubmitted.mock.calls[0][0].note).toBe('疑似自瞄，全程锁头');
  });

  it('取消按钮触发 onClose 并隐藏', () => {
    const onClose = vi.fn();
    dialog.onClose = onClose;
    dialog.show(PLAYERS);
    const cancel = dialog.container.querySelector('#report-cancel') as HTMLButtonElement;
    cancel.click();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(dialog.container.style.display).toBe('none');
  });

  it('show 时重置备注与理由', () => {
    dialog.show(PLAYERS);
    const note = dialog.container.querySelector('#report-note') as HTMLTextAreaElement;
    note.value = '旧备注';
    const reasonBtn = dialog.container.querySelector('[data-reason="abusive"]') as HTMLButtonElement;
    reasonBtn.click();
    dialog.show(PLAYERS);
    expect(note.value).toBe('');
    const toxicBtn = dialog.container.querySelector('[data-reason="toxic"]') as HTMLButtonElement;
    expect(toxicBtn.style.borderColor).not.toContain('255, 204, 0');
    const cheatBtn = dialog.container.querySelector('[data-reason="cheat"]') as HTMLButtonElement;
    expect(cheatBtn.style.borderColor).toContain('255, 204, 0');
  });
});
