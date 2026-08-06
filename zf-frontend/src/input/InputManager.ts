import { DEFAULT_KEY_BINDINGS, buildCodeToActions, sanitizeKeyBindings, type KeyActionId, type KeyBindings } from './KeyBindings';

export interface InputState {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  jump: boolean;
  sprint: boolean;
  crouch: boolean;
  prone: boolean;
  leanLeft: boolean;
  leanRight: boolean;
  fire: boolean;
  aim: boolean;
  reload: boolean;
}

export type WeaponSwitchCallback = (slot: number) => void;
export type ReloadCallback = () => void;
export type GrenadeCallback = () => void;
export type EquipmentSwitchCallback = (slot: number) => void;
export type VehicleToggleCallback = () => void;
export type SeatSwitchCallback = () => void;
export type ScoreboardCallback = (visible: boolean) => void;
export type EscapeCallback = () => void;
export type WeatherToggleCallback = () => void;
export type MeleeCallback = () => void;
export type ScopeCallback = () => void;

export class InputManager {
  private keys: Set<string> = new Set();
  private mouseMovement = { x: 0, y: 0 };
  private pointerLocked = false;
  private initialized = false;

  private weaponSwitchCallbacks: WeaponSwitchCallback[] = [];
  private reloadPressedCallbacks: ReloadCallback[] = [];
  private grenadeCallbacks: GrenadeCallback[] = [];
  private equipmentSwitchCallbacks: EquipmentSwitchCallback[] = [];
  private vehicleToggleCallbacks: VehicleToggleCallback[] = [];
  private seatSwitchCallbacks: SeatSwitchCallback[] = [];
  private scoreboardCallbacks: ScoreboardCallback[] = [];
  private escapeCallbacks: EscapeCallback[] = [];
  private weatherToggleCallbacks: WeatherToggleCallback[] = [];
  private meleeCallbacks: MeleeCallback[] = [];
  private scopeCallbacks: ScopeCallback[] = [];

  public state: InputState = {
    forward: false, backward: false, left: false, right: false,
    jump: false, sprint: false, crouch: false, prone: false,
    leanLeft: false, leanRight: false,
    fire: false, aim: false, reload: false,
  };

  private fireConsumed = false;

  /** 阶段 10：键位绑定（默认 DEFAULT_KEY_BINDINGS，可重绑定 + 持久化） */
  private bindings: KeyBindings = { ...DEFAULT_KEY_BINDINGS };
  private codeToActions: Map<string, KeyActionId[]> = buildCodeToActions(this.bindings);

  /** 阶段 10：应用新键位（sanitize 后重建反向映射；返回应用后的绑定） */
  applyBindings(bindings: Partial<KeyBindings>): KeyBindings {
    this.bindings = sanitizeKeyBindings(bindings);
    this.codeToActions = buildCodeToActions(this.bindings);
    return this.bindings;
  }

  getBindings(): KeyBindings {
    return { ...this.bindings };
  }

  /** 命中绑定动作（含重复键的全部动作） */
  private actionsForCode(code: string): KeyActionId[] {
    return this.codeToActions.get(code) ?? [];
  }

  private onKeyDown = (e: KeyboardEvent) => {
    const actions = this.actionsForCode(e.code);

    // 跳跃键防页面滚动 / 计分板键防焦点移动
    if (actions.includes('jump')) e.preventDefault();
    if (actions.includes('scoreboard')) e.preventDefault();

    // 武器切换 1-4（冲突时按动作顺序取首个武器动作）
    const weaponAction = actions.find((a) => a.startsWith('weapon_'));
    if (weaponAction) {
      const slot = Number(weaponAction.split('_')[1]) - 1;
      this.notifyWeaponSwitch(slot);
      return;
    }

    // 装备切换 Q
    if (actions.includes('equipment') && !this.keys.has(e.code)) {
      this.equipmentSwitchCallbacks.forEach(cb => cb(0));
    }
    // 投掷装备 G
    if (actions.includes('grenade') && !this.keys.has(e.code)) {
      this.grenadeCallbacks.forEach(cb => cb());
    }
    // 载具 E
    if (actions.includes('vehicle') && !this.keys.has(e.code)) {
      this.vehicleToggleCallbacks.forEach(cb => cb());
    }
    // 载具座位切换 F
    if (actions.includes('seat') && !this.keys.has(e.code)) {
      this.seatSwitchCallbacks.forEach(cb => cb());
    }
    // 天气切换 T
    if (actions.includes('weather') && !this.keys.has(e.code)) {
      this.weatherToggleCallbacks.forEach(cb => cb());
    }
    // 近战 V
    if (actions.includes('melee') && !this.keys.has(e.code)) {
      this.meleeCallbacks.forEach(cb => cb());
    }
    // 切换瞄具 B
    if (actions.includes('scope') && !this.keys.has(e.code)) {
      this.scopeCallbacks.forEach(cb => cb());
    }
    // Esc 设置
    if (actions.includes('escape')) {
      this.escapeCallbacks.forEach(cb => cb());
    }
    // Tab 计分板
    if (actions.includes('scoreboard')) {
      this.scoreboardCallbacks.forEach(cb => cb(true));
    }
    // 换弹
    if (actions.includes('reload') && !this.keys.has(e.code)) {
      this.reloadPressedCallbacks.forEach(cb => cb());
    }

    this.keys.add(e.code);
    this.updateState();
  };

  private onKeyUp = (e: KeyboardEvent) => {
    if (this.actionsForCode(e.code).includes('scoreboard')) {
      this.scoreboardCallbacks.forEach(cb => cb(false));
    }
    this.keys.delete(e.code);
    this.updateState();
  };

  private onMouseMove = (e: MouseEvent) => {
    if (this.pointerLocked) {
      this.mouseMovement.x += e.movementX;
      this.mouseMovement.y += e.movementY;
    }
  };

  private onPointerLockChange = () => {
    this.pointerLocked = document.pointerLockElement !== null;
  };

  private onMouseDown = (e: MouseEvent) => {
    if (e.button === 0) { this.state.fire = true; this.fireConsumed = false; }
    if (e.button === 2) this.state.aim = true;
  };

  private onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) { this.state.fire = false; this.fireConsumed = false; }
    if (e.button === 2) this.state.aim = false;
  };

  private onContextMenu = (e: MouseEvent) => { e.preventDefault(); };

  init(): void {
    if (this.initialized) return;
    this.initialized = true;

    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('keyup', this.onKeyUp);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    document.addEventListener('mousedown', this.onMouseDown);
    document.addEventListener('mouseup', this.onMouseUp);
    document.addEventListener('contextmenu', this.onContextMenu);
  }

  private updateState(): void {
    const b = this.bindings;
    this.state.forward = this.keys.has(b.move_forward);
    this.state.backward = this.keys.has(b.move_backward);
    this.state.left = this.keys.has(b.move_left);
    this.state.right = this.keys.has(b.move_right);
    this.state.jump = this.keys.has(b.jump);
    this.state.sprint = this.keys.has(b.sprint) || this.keys.has('ShiftRight');
    this.state.crouch = this.keys.has(b.crouch) || this.keys.has('ControlRight');
    this.state.prone = this.keys.has(b.prone);
    this.state.leanLeft = this.keys.has(b.lean_left);
    this.state.leanRight = this.keys.has(b.lean_right);
    this.state.reload = this.keys.has(b.reload);
  }

  getMouseMovement(): { x: number; y: number } {
    const movement = { ...this.mouseMovement };
    this.mouseMovement.x = 0;
    this.mouseMovement.y = 0;
    return movement;
  }

  requestPointerLock(): void {
    document.body.requestPointerLock();
  }

  isPointerLocked(): boolean {
    return this.pointerLocked;
  }

  consumeFire(): boolean {
    if (!this.fireConsumed) { this.fireConsumed = true; return true; }
    return false;
  }

  // 回调注册
  onWeaponSwitch(cb: WeaponSwitchCallback): void { this.weaponSwitchCallbacks.push(cb); }
  onReloadPressed(cb: ReloadCallback): void { this.reloadPressedCallbacks.push(cb); }
  onGrenade(cb: GrenadeCallback): void { this.grenadeCallbacks.push(cb); }
  onEquipmentSwitch(cb: EquipmentSwitchCallback): void { this.equipmentSwitchCallbacks.push(cb); }
  onVehicleToggle(cb: VehicleToggleCallback): void { this.vehicleToggleCallbacks.push(cb); }
  onSeatSwitch(cb: SeatSwitchCallback): void { this.seatSwitchCallbacks.push(cb); }
  onScoreboard(cb: ScoreboardCallback): void { this.scoreboardCallbacks.push(cb); }
  onEscape(cb: EscapeCallback): void { this.escapeCallbacks.push(cb); }
  onWeatherToggle(cb: WeatherToggleCallback): void { this.weatherToggleCallbacks.push(cb); }

  onMelee(cb: MeleeCallback): void { this.meleeCallbacks.push(cb); }

  onScope(cb: ScopeCallback): void { this.scopeCallbacks.push(cb); }

  private notifyWeaponSwitch(slot: number): void {
    this.weaponSwitchCallbacks.forEach(cb => cb(slot));
  }

  dispose(): void {
    if (!this.initialized) return;
    this.initialized = false;

    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('keyup', this.onKeyUp);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    document.removeEventListener('mousedown', this.onMouseDown);
    document.removeEventListener('mouseup', this.onMouseUp);
    document.removeEventListener('contextmenu', this.onContextMenu);
  }
}
