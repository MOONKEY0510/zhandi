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

export class InputManager {
  private keys: Set<string> = new Set();
  private mouseMovement = { x: 0, y: 0 };
  private pointerLocked = false;

  public state: InputState = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    jump: false,
    sprint: false,
    crouch: false,
    fire: false,
    aim: false,
    reload: false,
  };

  private onKeyDown = (e: KeyboardEvent) => {
    this.keys.add(e.code);
    this.updateState();
  };

  private onKeyUp = (e: KeyboardEvent) => {
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
    if (e.button === 0) this.state.fire = true;
    if (e.button === 2) this.state.aim = true;
  };

  private onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) this.state.fire = false;
    if (e.button === 2) this.state.aim = false;
  };

  private onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
  };

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
