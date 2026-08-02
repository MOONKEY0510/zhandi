export enum HealthState {
  HEALTHY = 'healthy',
  WOUNDED = 'wounded',
  CRITICAL = 'critical',
  DEAD = 'dead',
}

export class HealthSystem {
  maxHealth: number = 100;
  currentHealth: number = 100;
  healthSegments: number = 4;
  segmentHealth: number = 25;
  regenDelay: number = 5000;
  regenRate: number = 5;
  lastDamageTime: number = 0;
  isDead: boolean = false;
  reviveTime: number = 8000;
  deathTime: number = 0;
  canRevive: boolean = true;

  takeDamage(amount: number, currentTime: number): boolean {
    if (this.isDead) return false;

    this.currentHealth = Math.max(0, this.currentHealth - amount);
    this.lastDamageTime = currentTime;

    if (this.currentHealth <= 0) {
      this.die(currentTime);
      return true;
    }
    return false;
  }

  heal(amount: number): void {
    if (this.isDead) return;
    this.currentHealth = Math.min(this.maxHealth, this.currentHealth + amount);
  }

  update(currentTime: number): void {
    if (this.isDead) {
      if (this.canRevive && currentTime - this.deathTime >= this.reviveTime) {
        this.respawn();
      }
      return;
    }

    const timeSinceDamage = currentTime - this.lastDamageTime;
    if (timeSinceDamage >= this.regenDelay && this.currentHealth < this.maxHealth) {
      const regenAmount = this.regenRate * (timeSinceDamage / 1000);
      this.heal(regenAmount);
    }
  }

  private die(currentTime: number): void {
    this.isDead = true;
    this.deathTime = currentTime;
  }

  respawn(): void {
    this.isDead = false;
    this.currentHealth = this.maxHealth;
    this.lastDamageTime = 0;
  }

  getHealthState(): HealthState {
    if (this.isDead) return HealthState.DEAD;
    if (this.currentHealth <= 25) return HealthState.CRITICAL;
    if (this.currentHealth <= 50) return HealthState.WOUNDED;
    return HealthState.HEALTHY;
  }

  getHealthPercentage(): number {
    return (this.currentHealth / this.maxHealth) * 100;
  }

  getSegmentCount(): number {
    return Math.ceil(this.currentHealth / this.segmentHealth);
  }
}

export class AmmoSystem {
  totalAmmo: number = 0;
  maxAmmo: number = 0;
  scavengeAmount: number = 30;

  constructor(startingAmmo: number = 60, maxAmmo: number = 240) {
    this.totalAmmo = startingAmmo;
    this.maxAmmo = maxAmmo;
  }

  useAmmo(amount: number): boolean {
    if (this.totalAmmo < amount) return false;
    this.totalAmmo -= amount;
    return true;
  }

  addAmmo(amount: number): void {
    this.totalAmmo = Math.min(this.maxAmmo, this.totalAmmo + amount);
  }

  scavenge(): number {
    const scavenged = Math.min(this.scavengeAmount, this.maxAmmo - this.totalAmmo);
    this.totalAmmo += scavenged;
    return scavenged;
  }

  getAmmoPercentage(): number {
    return (this.totalAmmo / this.maxAmmo) * 100;
  }
}

export class HealthPack {
  amount: number;
  respawnTime: number;
  position: { x: number; y: number; z: number };
  isAvailable: boolean = true;
  lastUsedTime: number = 0;

  constructor(position: { x: number; y: number; z: number }, amount: number = 50, respawnTime: number = 15000) {
    this.position = position;
    this.amount = amount;
    this.respawnTime = respawnTime;
  }

  use(currentTime: number): number | null {
    if (!this.isAvailable) return null;
    this.isAvailable = false;
    this.lastUsedTime = currentTime;
    return this.amount;
  }

  update(currentTime: number): void {
    if (!this.isAvailable && currentTime - this.lastUsedTime >= this.respawnTime) {
      this.isAvailable = true;
    }
  }
}
