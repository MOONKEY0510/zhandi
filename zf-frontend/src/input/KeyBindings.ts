/**
 * 键位绑定（阶段 10 P0：键位重绑定 + 持久化）。
 * 绑定用 KeyboardEvent.code（物理键位，不受键盘布局影响），与 InputManager 现有约定一致。
 */
export type KeyActionId =
  | 'move_forward'
  | 'move_backward'
  | 'move_left'
  | 'move_right'
  | 'jump'
  | 'sprint'
  | 'crouch'
  | 'reload'
  | 'weapon_1'
  | 'weapon_2'
  | 'weapon_3'
  | 'weapon_4'
  | 'weapon_5'
  | 'equipment'
  | 'prone'
  | 'grenade'
  | 'melee'
  | 'vehicle'
  | 'seat'
  | 'weather'
  | 'scoreboard'
  | 'escape';

export type KeyBindings = Record<KeyActionId, string>;

export const DEFAULT_KEY_BINDINGS: Readonly<KeyBindings> = {
  move_forward: 'KeyW',
  move_backward: 'KeyS',
  move_left: 'KeyA',
  move_right: 'KeyD',
  jump: 'Space',
  sprint: 'ShiftLeft',
  crouch: 'ControlLeft',
  reload: 'KeyR',
  weapon_1: 'Digit1',
  weapon_2: 'Digit2',
  weapon_3: 'Digit3',
  weapon_4: 'Digit4',
  weapon_5: 'Digit5',
  equipment: 'KeyQ',
  prone: 'KeyZ',
  grenade: 'KeyG',
  melee: 'KeyV',
  vehicle: 'KeyE',
  seat: 'KeyF',
  weather: 'KeyT',
  scoreboard: 'Tab',
  escape: 'Escape',
};

/** 动作显示名（设置界面用） */
export const KEY_ACTION_LABELS: Readonly<Record<KeyActionId, string>> = {
  move_forward: '前进',
  move_backward: '后退',
  move_left: '左移',
  move_right: '右移',
  jump: '跳跃',
  sprint: '冲刺',
  crouch: '蹲伏',
  reload: '换弹',
  weapon_1: '武器 1',
  weapon_2: '武器 2',
  weapon_3: '武器 3',
  weapon_4: '武器 4',
  weapon_5: '副武器',
  equipment: '战术装备',
  prone: '匍匐',
  grenade: '投掷物',
  melee: '近战',
  vehicle: '进入/离开载具',
  seat: '切换座位',
  weather: '切换天气',
  scoreboard: '计分板',
  escape: '设置菜单',
};

const STORAGE_KEY = 'zhandi.key-bindings.v1';

/** 合法动作集合（sanitize 用） */
const ACTION_IDS = Object.keys(DEFAULT_KEY_BINDINGS) as KeyActionId[];

export function loadKeyBindings(storage: Pick<Storage, 'getItem'> = localStorage): KeyBindings {
  try {
    const value = storage.getItem(STORAGE_KEY);
    if (!value) return { ...DEFAULT_KEY_BINDINGS };
    return sanitizeKeyBindings(JSON.parse(value) as Partial<KeyBindings>);
  } catch {
    return { ...DEFAULT_KEY_BINDINGS };
  }
}

export function saveKeyBindings(
  bindings: KeyBindings,
  storage: Pick<Storage, 'setItem'> = localStorage,
): KeyBindings {
  const sanitized = sanitizeKeyBindings(bindings);
  storage.setItem(STORAGE_KEY, JSON.stringify(sanitized));
  return sanitized;
}

/** 缺省动作补默认键；非法值（空串/非字符串）回退默认 */
export function sanitizeKeyBindings(bindings: Partial<KeyBindings>): KeyBindings {
  const out = { ...DEFAULT_KEY_BINDINGS } as KeyBindings;
  for (const action of ACTION_IDS) {
    const code = bindings[action];
    if (typeof code === 'string' && code.length > 0) out[action] = code;
  }
  return out;
}

/** 冲突检测：返回被重复使用的键 → 动作列表（同一键绑多个动作时，靠后的动作不会触发） */
export function findKeyConflicts(bindings: KeyBindings): Map<string, KeyActionId[]> {
  const byCode = new Map<string, KeyActionId[]>();
  for (const action of ACTION_IDS) {
    const code = bindings[action];
    const list = byCode.get(code) ?? [];
    list.push(action);
    byCode.set(code, list);
  }
  const conflicts = new Map<string, KeyActionId[]>();
  for (const [code, actions] of byCode) {
    if (actions.length > 1) conflicts.set(code, actions);
  }
  return conflicts;
}

/** 反向映射：code → 绑定的动作列表（InputManager 查询用） */
export function buildCodeToActions(bindings: KeyBindings): Map<string, KeyActionId[]> {
  const map = new Map<string, KeyActionId[]>();
  for (const action of ACTION_IDS) {
    const code = bindings[action];
    const list = map.get(code) ?? [];
    list.push(action);
    map.set(code, list);
  }
  return map;
}
