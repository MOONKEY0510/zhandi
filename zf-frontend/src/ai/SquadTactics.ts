export type AITacticalAction = 'follow' | 'focus_fire' | 'suppress' | 'advance' | 'retreat' | 'revive';

export interface AITacticalContext {
  distanceToLeader: number;
  visibleEnemies: number;
  healthRatio: number;
  ammoRatio: number;
  downedAllyDistance: number | null;
  objectiveDistance: number;
  role: 'leader' | 'assault' | 'support' | 'medic';
}

export interface AITacticalDecision {
  action: AITacticalAction;
  reason: string;
}

export function decideTacticalAction(context: AITacticalContext): AITacticalDecision {
  if (context.role === 'medic' && context.downedAllyDistance !== null && context.downedAllyDistance < 20) {
    return { action: 'revive', reason: '附近有可救援队友' };
  }
  if (context.healthRatio < 0.3 || context.ammoRatio < 0.1) {
    return { action: 'retreat', reason: '生命或弹药低于安全阈值' };
  }
  if (context.visibleEnemies >= 2 && context.role === 'support') {
    return { action: 'suppress', reason: '支援兵对多个可见敌人实施压制' };
  }
  if (context.visibleEnemies > 0) {
    return { action: 'focus_fire', reason: '发现可见威胁并与小队集火' };
  }
  if (context.distanceToLeader > 15 && context.role !== 'leader') {
    return { action: 'follow', reason: '与队长距离过远' };
  }
  return { action: 'advance', reason: `向${context.objectiveDistance.toFixed(0)}米外目标推进` };
}
