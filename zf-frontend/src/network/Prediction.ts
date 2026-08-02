import * as THREE from 'three';

export interface InputSnapshot {
  timestamp: number;
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  jump: boolean;
  sprint: boolean;
  crouch: boolean;
  mouseX: number;
  mouseY: number;
}

export interface PredictedState {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  rotation: THREE.Euler;
  timestamp: number;
}

export class ClientPrediction {
  private inputHistory: InputSnapshot[] = [];
  private stateHistory: PredictedState[] = [];
  private maxHistorySize: number = 60;
  private serverState: PredictedState | null = null;
  private reconciliationThreshold: number = 0.1;

  addInput(input: InputSnapshot): void {
    this.inputHistory.push(input);
    if (this.inputHistory.length > this.maxHistorySize) {
      this.inputHistory.shift();
    }
  }

  addState(state: PredictedState): void {
    this.stateHistory.push(state);
    if (this.stateHistory.length > this.maxHistorySize) {
      this.stateHistory.shift();
    }
  }

  predictMovement(currentState: PredictedState, input: InputSnapshot, deltaTime: number): PredictedState {
    const predicted = { ...currentState };
    const speed = input.sprint ? 8 : input.crouch ? 2.5 : 5;
    const direction = new THREE.Vector3();

    if (input.forward) direction.z -= 1;
    if (input.backward) direction.z += 1;
    if (input.left) direction.x -= 1;
    if (input.right) direction.x += 1;

    if (direction.length() > 0) {
      direction.normalize();
      predicted.velocity.x = direction.x * speed;
      predicted.velocity.z = direction.z * speed;
    } else {
      predicted.velocity.x *= 0.85;
      predicted.velocity.z *= 0.85;
    }

    if (input.jump) {
      predicted.velocity.y = 7;
    }

    predicted.position.x += predicted.velocity.x * deltaTime;
    predicted.position.y += predicted.velocity.y * deltaTime;
    predicted.position.z += predicted.velocity.z * deltaTime;

    predicted.rotation.y -= input.mouseX * 0.002;
    predicted.rotation.x -= input.mouseY * 0.002;
    predicted.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, predicted.rotation.x));

    return predicted;
  }

  reconcile(serverState: PredictedState): void {
    this.serverState = serverState;

    const lastPredicted = this.stateHistory[this.stateHistory.length - 1];
    if (!lastPredicted) return;

    const diff = new THREE.Vector3()
      .subVectors(serverState.position, lastPredicted.position)
      .length();

    if (diff > this.reconciliationThreshold) {
      this.stateHistory = [];
      this.stateHistory.push(serverState);
    }
  }

  getSmoothedState(): PredictedState | null {
    if (this.stateHistory.length === 0) return null;
    return this.stateHistory[this.stateHistory.length - 1];
  }
}

export class ServerReconciliation {
  private serverStates: Map<string, PredictedState> = new Map();
  private clientInputs: Map<string, InputSnapshot[]> = new Map();

  processInput(playerId: string, input: InputSnapshot): PredictedState {
    const currentState = this.serverStates.get(playerId);
    if (!currentState) {
      const newState: PredictedState = {
        position: new THREE.Vector3(0, 1.7, 0),
        velocity: new THREE.Vector3(0, 0, 0),
        rotation: new THREE.Euler(0, 0, 0),
        timestamp: Date.now(),
      };
      this.serverStates.set(playerId, newState);
      return newState;
    }

    const inputs = this.clientInputs.get(playerId) || [];
    inputs.push(input);
    this.clientInputs.set(playerId, inputs);

    return currentState;
  }

  validateState(playerId: string, clientState: PredictedState): boolean {
    const serverState = this.serverStates.get(playerId);
    if (!serverState) return true;

    const diff = new THREE.Vector3()
      .subVectors(clientState.position, serverState.position)
      .length();

    return diff < 5.0;
  }

  getState(playerId: string): PredictedState | undefined {
    return this.serverStates.get(playerId);
  }
}
