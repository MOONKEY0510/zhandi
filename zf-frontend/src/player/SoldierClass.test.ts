import { describe, expect, it } from 'vitest';
import { WeaponType } from '../weapons/WeaponSystem';
import { SOLDIER_CLASSES, SoldierClassId } from './SoldierClass';

describe('Soldier classes', () => {
  it('defines six distinct classes with limited loadouts', () => {
    const classes = Object.values(SOLDIER_CLASSES);

    expect(classes).toHaveLength(6);
    expect(new Set(classes.map((definition) => definition.primaryWeapon)).size).toBe(6);
    expect(classes.every((definition) => definition.equipment.length === 2)).toBe(true);
  });

  it('assigns Kar98k exclusively to recon', () => {
    expect(SOLDIER_CLASSES[SoldierClassId.RECON].primaryWeapon).toBe(WeaponType.BOLT_RIFLE);
    expect(
      Object.values(SOLDIER_CLASSES).filter((definition) => definition.primaryWeapon === WeaponType.BOLT_RIFLE),
    ).toHaveLength(1);
  });

  it('assigns M30 shotgun to engineer and Gewehr 43 to marksman', () => {
    expect(SOLDIER_CLASSES[SoldierClassId.ENGINEER].primaryWeapon).toBe(WeaponType.SHOTGUN);
    expect(SOLDIER_CLASSES[SoldierClassId.MARKSMAN].primaryWeapon).toBe(WeaponType.SEMI_RIFLE);
  });
});
