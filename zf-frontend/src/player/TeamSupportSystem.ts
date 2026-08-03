export interface SupportPlayerState {
  id: string;
  health: number;
  maxHealth: number;
  reserveAmmo: number;
  maxReserveAmmo: number;
  downedAt: number | null;
  spottedUntil: number;
}

export class TeamSupportSystem {
  constructor(
    readonly reviveWindowMs = 15_000,
    readonly reviveHealth = 50,
  ) {}

  down(player: SupportPlayerState, time: number): void {
    player.health = 0;
    player.downedAt = time;
  }

  canRevive(player: SupportPlayerState, time: number): boolean {
    return player.downedAt !== null && time - player.downedAt <= this.reviveWindowMs;
  }

  revive(player: SupportPlayerState, time: number): boolean {
    if (!this.canRevive(player, time)) return false;
    player.health = Math.min(player.maxHealth, this.reviveHealth);
    player.downedAt = null;
    return true;
  }

  heal(player: SupportPlayerState, amount: number): number {
    if (player.downedAt !== null || amount <= 0) return 0;
    const before = player.health;
    player.health = Math.min(player.maxHealth, player.health + amount);
    return player.health - before;
  }

  resupply(player: SupportPlayerState, amount: number): number {
    if (amount <= 0) return 0;
    const before = player.reserveAmmo;
    player.reserveAmmo = Math.min(player.maxReserveAmmo, player.reserveAmmo + amount);
    return player.reserveAmmo - before;
  }

  spot(player: SupportPlayerState, time: number, durationMs: number): void {
    player.spottedUntil = Math.max(player.spottedUntil, time + durationMs);
  }

  isSpotted(player: SupportPlayerState, time: number): boolean {
    return player.spottedUntil > time;
  }
}
