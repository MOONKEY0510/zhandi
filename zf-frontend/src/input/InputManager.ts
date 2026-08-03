export interface InputState {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  jump: boolean;
  sprint: boolean;
  crouch: boolean;
  fire: boolean;
  aim: boolean;
  reload: boolean;
}

export type WeaponSwitchCallback = (slot: number) => void;
export type ReloadCallback = () => void;
export type GrenadeCallback = () => void;
export type EquipmentSwitchCallback = (slot: number) => void;
export type VehicleToggleCallback = () => void;
export type ScoreboardCallback = (visible: boolean) => void;
export type EscapeCallback = () => void;
export type WeatherToggleCallback = () => void;

export class InputManager {
  private keys: Set<string> = new Set();
  private mouseMovement = { x: 0, y: 0 };
  private pointerLocked = false;

  private weaponSwitchCallbacks: WeaponSwitchCallback[] = [];
  private reloadPressedCallbacks: ReloadCallback[] = [];
  private grenadeCallbacks: GrenadeCallback[] = [];
  private equipmentSwitchCallbacks: EquipmentSwitchCallback[] = [];
  private vehicleToggleCallbacks: VehicleToggleCallback[] = [];
  private scoreboardCallbacks: ScoreboardCallback[] = [];
  private escapeCallbacks: EscapeCallback[] = [];
  private weatherToggleCallbacks: WeatherToggleCallback[] = [];

  public state: InputState = {
    forward: false, backward: false, left: false, right: false,
    jump: false, sprint: false, crouch: false,
    fire: false, aim: false, reload: false,
  };

  private fireConsumed = false;

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.code === 'Space') e.preventDefault();

    // 武器切换 1-4
    if (e.code === 'Digit1') { this.notifyWeaponSwitch(0); return; }
    if (e.code === 'Digit2') { this.notifyWeaponSwitch(1); return; }
    if (e.code === 'Digit3') { this.notifyWeaponSwitch(2); return; }
    if (e.code === 'Digit4') { this.notifyWeaponSwitch(3); return; }

    // 装备切换 Q
    if (e.code === 'KeyQ' && !this.keys.has('KeyQ')) {
      this.equipmentSwitchCallbacks.forEach(cb => cb(0));
    }
    // 投掷装备 G
    if (e.code === 'KeyG' && !this.keys.has('KeyG')) {
      this.grenadeCallbacks.forEach(cb => cb());
    }
    // 载具 E
    if (e.code === 'KeyE' && !this.keys.has('KeyE')) {
      this.vehicleToggleCallbacks.forEach(cb => cb());
    }
    // 天气切换 T
    if (e.code === 'KeyT' && !this.keys.has('KeyT')) {
      this.weatherToggleCallbacks.forEach(cb => cb());
    }
    // Esc 设置
    if (e.code === 'Escape') {
      this.escapeCallbacks.forEach(cb => cb());
    }
    // Tab 计分板
    if (e.code === 'Tab') {
      e.preventDefault();
      this.scoreboardCallbacks.forEach(cb => cb(true));
    }
    // R 换弹
    if (e.code === 'KeyR' && !this.keys.has('KeyR')) {
      this.reloadPressedCallbacks.forEach(cb => cb());
    }

    this.keys.add(e.code);
    this.updateState();
  };

  private onKeyUp = (e: KeyboardEvent) => {
    if (e.code === 'Tab') {
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
    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('keyup', this.onKeyUp);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    document.addEventListener('mousedown', this.onMouseDown);
    document.addEventListener('mouseup', this.onMouseUp);
    document.addEventListener('contextmenu', this.onContextMenu);
  }

  private updateState(): void {
    this.state.forward = this.keys.has('KeyW');
    this.state.backward = this.keys.has('KeyS');
    this.state.left = this.keys.has('KeyA');
    this.state.right = this.keys.has('KeyD');
    this.state.jump = this.keys.has('Space');
    this.state.sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    this.state.crouch = this.keys.has('ControlLeft') || this.keys.has('ControlRight');
    this.state.reload = this.keys.has('KeyR');
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
  onScoreboard(cb: ScoreboardCallback): void { this.scoreboardCallbacks.push(cb); }
  onEscape(cb: EscapeCallback): void { this.escapeCallbacks.push(cb); }
  onWeatherToggle(cb: WeatherToggleCallback): void { this.weatherToggleCallbacks.push(cb); }

  private notifyWeaponSwitch(slot: number): void {
    this.weaponSwitchCallbacks.forEach(cb => cb(slot));
  }

  dispose(): void {
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('keyup', this.onKeyUp);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    document.removeEventListener('mousedown', this.onMouseDown);
    document.removeEventListener('mouseup', this.onMouseUp);
    document.removeEventListener('contextmenu', this.onContextMenu);
  }
}
