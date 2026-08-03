import { DEFAULT_GAME_CONFIG } from '../config';

export enum WeaponType {
  ASSAULT_RIFLE = 'assault_rifle',
  SMG = 'smg',
  LMG = 'lmg',
  BOLT_RIFLE = 'bolt_rifle',
}

export enum FireMode {
  SINGLE = 'single',
  AUTO = 'auto',
  BURST = 'burst',
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
    if (!this.canFire(currentTime)) return false;
    this.currentAmmo--;
    this.lastFireTime = currentTime;
    this.shotsInBurst++;
    if (this.config.boltActionTime) this.boltReadyTime = currentTime + this.config.boltActionTime * 1000;
    return true;
  }

  startReload(currentTime: number): boolean {
    if (this.isReloading) return false;
    if (this.currentAmmo === this.config.magazineSize) return false;
    if (this.reserveAmmo <= 0) return false;

    this.isReloading = true;
    this.reloadStartTime = currentTime;
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
      return true;
    }
    return false;
  }

  getReloadProgress(currentTime: number): number {
    if (!this.isReloading) return 0;
    return Math.min(1, (currentTime - this.reloadStartTime) / (this.config.reloadTime * 1000));
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
    this.getCurrentWeapon().updateReload(currentTime);
  }
}
