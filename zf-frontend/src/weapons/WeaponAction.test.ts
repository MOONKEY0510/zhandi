import { describe, expect, it, vi } from 'vitest';
import { Weapon, WeaponType } from './WeaponSystem';

describe('Weapon action events', () => {
  it('emits fire and bolt lifecycle events for Kar98k', () => {
    const weapon = new Weapon(WeaponType.BOLT_RIFLE);
    const onAction = vi.fn();
    weapon.onAction = onAction;

    weapon.fire(1_000);
    weapon.update(1_800);

    expect(onAction.mock.calls.map(([event]) => event.action)).toEqual([
      'fire',
      'bolt_cycle_start',
      'bolt_ready',
    ]);
  });

  it('emits reload start and completion events', () => {
    const weapon = new Weapon(WeaponType.ASSAULT_RIFLE);
    const onAction = vi.fn();
    weapon.onAction = onAction;
    weapon.currentAmmo = 10;

    weapon.startReload(1_000);
    weapon.update(3_500);

    expect(onAction.mock.calls.map(([event]) => event.action)).toEqual([
      'reload_start',
      'reload_complete',
    ]);
  });

  it('emits a dry fire event for an empty weapon', () => {
    const weapon = new Weapon(WeaponType.ASSAULT_RIFLE);
    const onAction = vi.fn();
    weapon.onAction = onAction;
    weapon.currentAmmo = 0;

    expect(weapon.fire(1_000)).toBe(false);
    expect(onAction).toHaveBeenCalledWith({
      action: 'dry_fire',
      weaponType: WeaponType.ASSAULT_RIFLE,
      time: 1_000,
    });
  });
});
