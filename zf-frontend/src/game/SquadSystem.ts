export interface SquadMember {
  id: string;
  name: string;
  alive: boolean;
  inCombatUntil: number;
}

export interface SquadOrder {
  type: 'attack' | 'defend';
  targetId: string;
  issuedAt: number;
  completed: boolean;
}

export class SquadSystem {
  readonly members = new Map<string, SquadMember>();
  leaderId: string | null = null;
  order: SquadOrder | null = null;
  commandPoints = 0;

  constructor(readonly maxMembers = 4) {}

  addMember(member: SquadMember): boolean {
    if (this.members.size >= this.maxMembers || this.members.has(member.id)) return false;
    this.members.set(member.id, member);
    this.leaderId ??= member.id;
    return true;
  }

  removeMember(id: string): void {
    this.members.delete(id);
    if (this.leaderId === id) this.leaderId = this.members.keys().next().value ?? null;
  }

  issueOrder(leaderId: string, order: Omit<SquadOrder, 'completed'>): boolean {
    if (leaderId !== this.leaderId) return false;
    this.order = { ...order, completed: false };
    return true;
  }

  completeOrder(targetId: string, points = 100): boolean {
    if (!this.order || this.order.targetId !== targetId || this.order.completed) return false;
    this.order.completed = true;
    this.commandPoints += points;
    return true;
  }

  canSpawnOn(memberId: string, time: number): boolean {
    const member = this.members.get(memberId);
    return Boolean(member?.alive && member.inCombatUntil <= time);
  }
}
