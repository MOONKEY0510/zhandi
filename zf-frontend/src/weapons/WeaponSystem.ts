import { DEFAULT_GAME_CONFIG } from '../config';

export enum WeaponType {
  ASSAULT_RIFLE = 'assault_rifle',
  SMG = 'smg',
  LMG = 'lmg',
  BOLT_RIFLE = 'bolt_rifle',
  PISTOL = 'pistol',
}

export enum FireMode {
  SINGLE = 'single',
  AUTO = 'auto',
  BURST = 'burst',
}

export type WeaponAction =
  | 'fire'
  | 'dry_fire'
  | 'reload_start'
  | 'reload_complete'
  | 'bolt_cycle_start'
  | 'bolt_ready';

export interface WeaponActionEvent {
  action: WeaponAction;
  weaponType: WeaponType;
  time: number;
}

export interface WeaponConfig {
  name: string;
  type: WeaponType;
  fireMode: FireMode;
  damage: number;
  fireRate: number;
  magazineSize: number;
  reloadTime: number;
  accuracy: number;
  recoil: number;
  range: number;
  headshotMultiplier: number;
  bulletSpeed: number;
  minDamage: number;
  falloffStart: number;
  falloffEnd: number;
  firstShotRecoilMultiplier: number;
  movingSpreadMultiplier: number;
  crouchSpreadMultiplier: number;
  boltActionTime?: number;
  /** 瞄具目标 FOV（有值 = 支持光学瞄具，B 键切换；越小放大越强） */
  sightFov?: number;
}

export const WEAPON_CONFIGS: Record<WeaponType, WeaponConfig> = {
  [WeaponType.ASSAULT_RIFLE]: {
    name: 'STG44',
    type: WeaponType.ASSAULT_RIFLE,
    fireMode: FireMode.AUTO,
    damage: 25,
    fireRate: 12,
    magazineSize: 30,
    reloadTime: 2.5,
    accuracy: 0.92,
    recoil: 0.04,
    range: 100,
    headshotMultiplier: 2.0,
    bulletSpeed: 620,
    minDamage: 18,
    falloffStart: 25,
    falloffEnd: 80,
    firstShotRecoilMultiplier: 1.35,
    movingSpreadMultiplier: 1.8,
    crouchSpreadMultiplier: 0.75,
    sightFov: 42,
  },
  [WeaponType.SMG]: {
    name: 'Suomi KP/-31',
    type: WeaponType.SMG,
    fireMode: FireMode.AUTO,
    damage: 18,
    fireRate: 16,
    magazineSize: 20,
    reloadTime: 2.0,
    accuracy: 0.85,
    recoil: 0.03,
    range: 60,
    headshotMultiplier: 1.5,
    bulletSpeed: 400,
    minDamage: 12,
    falloffStart: 15,
    falloffEnd: 60,
    firstShotRecoilMultiplier: 1.2,
    movingSpreadMultiplier: 1.5,
    crouchSpreadMultiplier: 0.8,
  },
  [WeaponType.LMG]: {
    name: 'MG42',
    type: WeaponType.LMG,
    fireMode: FireMode.AUTO,
    damage: 30,
    fireRate: 20,
    magazineSize: 50,
    reloadTime: 4.0,
    accuracy: 0.75,
    recoil: 0.06,
    range: 120,
    headshotMultiplier: 1.8,
    bulletSpeed: 800,
    minDamage: 20,
    falloffStart: 35,
    falloffEnd: 110,
    firstShotRecoilMultiplier: 1.45,
    movingSpreadMultiplier: 2.2,
    crouchSpreadMultiplier: 0.65,
    sightFov: 42,
  },
  [WeaponType.BOLT_RIFLE]: {
    name: 'Kar98k',
    type: WeaponType.BOLT_RIFLE,
    fireMode: FireMode.SINGLE,
    damage: 80,
    fireRate: 1.2,
    magazineSize: 5,
    reloadTime: 3.0,
    accuracy: 0.98,
    recoil: 0.15,
    range: 200,
    headshotMultiplier: 2.5,
    bulletSpeed: 760,
    minDamage: 55,
    falloffStart: 60,
    falloffEnd: 200,
    firstShotRecoilMultiplier: 1,
    movingSpreadMultiplier: 3,
    crouchSpreadMultiplier: 0.6,
    boltActionTime: 0.8,
    sightFov: 26,
  },
  [WeaponType.PISTOL]: {
    name: 'P08 鲁格',
    type: WeaponType.PISTOL,
    fireMode: FireMode.SINGLE,
    damage: 22,
    fireRate: 6,
    magazineSize: 8,
    reloadTime: 1.5,
    accuracy: 0.88,
    recoil: 0.05,
    range: 40,
    headshotMultiplier: 1.5,
    bulletSpeed: 350,
    minDamage: 14,
    falloffStart: 10,
    falloffEnd: 40,
    firstShotRecoilMultiplier: 1,
    movingSpreadMultiplier: 1.3,
    crouchSpreadMultiplier: 0.8,
  },
};

export class Weapon {
  config: WeaponConfig;
  currentAmmo: number;
  reserveAmmo: number = DEFAULT_GAME_CONFIG.combat.startingReserveAmmo;
  isReloading: boolean = false;
  reloadStartTime: number = 0;
  lastFireTime: number = 0;
  burstCount: number = 0;
  burstResetTimer: number = 0;
  shotsInBurst: number = 0;
  boltReadyTime: number = 0;
  onAction: ((event: WeaponActionEvent) => void) | null = null;
  private boltReadyEmitted = true;

  constructor(type: WeaponType) {
    this.config = WEAPON_CONFIGS[type];
    this.currentAmmo = this.config.magazineSize;
  }

  canFire(currentTime: number): boolean {
    if (this.isReloading) return false;
    if (this.currentAmmo <= 0) return false;
    if (currentTime < this.boltReadyTime) return false;

    const timeSinceLastFire = (currentTime - this.lastFireTime) / 1000;
    return timeSinceLastFire >= 1 / this.config.fireRate;
  }

  fire(currentTime: number): boolean {
    if (!this.canFire(currentTime)) {
      if (this.currentAmmo <= 0) this.emitAction('dry_fire', currentTime);
      return false;
    }
    this.currentAmmo--;
    this.lastFireTime = currentTime;
    this.shotsInBurst++;
    this.emitAction('fire', currentTime);
    if (this.config.boltActionTime) {
      this.boltReadyTime = currentTime + this.config.boltActionTime * 1000;
      this.boltReadyEmitted = false;
      this.emitAction('bolt_cycle_start', currentTime);
    }
    return true;
  }

  startReload(currentTime: number): boolean {
    if (this.isReloading) return false;
    if (this.currentAmmo === this.config.magazineSize) return false;
    if (this.reserveAmmo <= 0) return false;

    this.isReloading = true;
    this.reloadStartTime = currentTime;
    this.emitAction('reload_start', currentTime);
    return true;
  }

  updateReload(currentTime: number): boolean {
    if (!this.isReloading) return false;

    const reloadProgress = (currentTime - this.reloadStartTime) / 1000;
    if (reloadProgress >= this.config.reloadTime) {
      const ammoNeeded = this.config.magazineSize - this.currentAmmo;
      const ammoToLoad = Math.min(ammoNeeded, this.reserveAmmo);
      this.currentAmmo += ammoToLoad;
      this.reserveAmmo -= ammoToLoad;
      this.isReloading = false;
      this.emitAction('reload_complete', currentTime);
      return true;
    }
    return false;
  }

  getReloadProgress(currentTime: number): number {
    if (!this.isReloading) return 0;
    return Math.min(1, (currentTime - this.reloadStartTime) / (this.config.reloadTime * 1000));
  }

  update(currentTime: number): void {
    this.updateReload(currentTime);
    if (!this.boltReadyEmitted && currentTime >= this.boltReadyTime) {
      this.boltReadyEmitted = true;
      this.emitAction('bolt_ready', currentTime);
    }
  }

  getRecoilMultiplier(currentTime: number): number {
    const burstResetMs = 250;
    if (currentTime - this.lastFireTime > burstResetMs) this.shotsInBurst = 0;
    return this.shotsInBurst <= 1 ? this.config.firstShotRecoilMultiplier : 1;
  }

  getSpreadMultiplier(moving: boolean, crouching: boolean): number {
    if (crouching) return this.config.crouchSpreadMultiplier;
    return moving ? this.config.movingSpreadMultiplier : 1;
  }

  private emitAction(action: WeaponAction, time: number): void {
    this.onAction?.({ action, weaponType: this.config.type, time });
  }
}

export class WeaponSystem {
  weapons: Map<WeaponType, Weapon> = new Map();
  currentWeaponType: WeaponType = WeaponType.ASSAULT_RIFLE;
  isFiring: boolean = false;

  constructor() {
    for (const type of Object.values(WeaponType)) {
      this.weapons.set(type, new Weapon(type));
    }
  }

  getCurrentWeapon(): Weapon {
    return this.weapons.get(this.currentWeaponType)!;
  }

  /** 当前主武器弹尽时自动切副武器（手枪），换弹后恢复 */
  private lastPrimaryType: WeaponType | null = null;
  private hadPrimaryAmmo = true;

  autoSwitchSecondary(): boolean {
    const w = this.getCurrentWeapon();
    if (w.config.type === WeaponType.PISTOL) return false;
    if (w.currentAmmo > 0) { this.hadPrimaryAmmo = true; return false; }
    if (w.reserveAmmo > 0) return false; // 有后备弹药，等换弹
    // 主武器弹尽 → 切副武器
    if (!this.hadPrimaryAmmo) return false; // 已切过
    this.hadPrimaryAmmo = false;
    this.lastPrimaryType = this.currentWeaponType;
    this.switchWeapon(WeaponType.PISTOL);
    return true;
  }

  /** 副武器切回主武器（换弹完成后） */
  restorePrimary(): boolean {
    if (this.currentWeaponType !== WeaponType.PISTOL || !this.lastPrimaryType) return false;
    const primary = this.weapons.get(this.lastPrimaryType);
    if (!primary || primary.currentAmmo <= 0) return false;
    this.switchWeapon(this.lastPrimaryType);
    this.lastPrimaryType = null;
    this.hadPrimaryAmmo = true;
    return true;
  }

  switchWeapon(type: WeaponType): void {
    if (this.weapons.has(type)) {
      this.currentWeaponType = type;
      this.isFiring = false;
    }
  }

  fire(currentTime: number): boolean {
    return this.getCurrentWeapon().fire(currentTime);
  }

  reload(currentTime: number): boolean {
    return this.getCurrentWeapon().startReload(currentTime);
  }

  update(currentTime: number): void {
    this.getCurrentWeapon().update(currentTime);
  }
}
