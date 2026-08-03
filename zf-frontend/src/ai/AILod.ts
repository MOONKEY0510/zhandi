export enum AILodLevel {
  NEAR = 'near',
  MID = 'mid',
  FAR = 'far',
}

export interface AILodBudget {
  level: AILodLevel;
  perceptionIntervalMs: number;
  decisionIntervalMs: number;
  animate: boolean;
  queryCollisions: boolean;
}

export function getAILodBudget(distance: number, visible: boolean): AILodBudget {
  if (distance <= 30) {
    return { level: AILodLevel.NEAR, perceptionIntervalMs: 100, decisionIntervalMs: 200, animate: true, queryCollisions: true };
  }
  if (distance <= 80 || visible) {
    return { level: AILodLevel.MID, perceptionIntervalMs: 300, decisionIntervalMs: 500, animate: visible, queryCollisions: true };
  }
  return { level: AILodLevel.FAR, perceptionIntervalMs: 1_000, decisionIntervalMs: 1_500, animate: false, queryCollisions: false };
}
