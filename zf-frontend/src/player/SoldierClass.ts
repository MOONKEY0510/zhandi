import { EquipmentType } from '../equipment/TacticalEquipment';
import { WeaponType } from '../weapons/WeaponSystem';

export enum SoldierClassId {
  ASSAULT = 'assault',
  MEDIC = 'medic',
  SUPPORT = 'support',
  RECON = 'recon',
  ENGINEER = 'engineer',
  MARKSMAN = 'marksman',
}

export interface SoldierClassDefinition {
  id: SoldierClassId;
  name: string;
  primaryWeapon: WeaponType;
  equipment: readonly [EquipmentType | 'medkit' | 'ammo_box' | 'spotting_scope', EquipmentType | 'repair_tool' | 'smoke_launcher'];
  passive: 'anti_vehicle' | 'fast_revive' | 'ammo_resupply' | 'enhanced_spotting';
  role: string;
}

export const SOLDIER_CLASSES: Readonly<Record<SoldierClassId, SoldierClassDefinition>> = {
  [SoldierClassId.ASSAULT]: {
    id: SoldierClassId.ASSAULT,
    name: '突击兵',
    primaryWeapon: WeaponType.ASSAULT_RIFLE,
    equipment: [EquipmentType.FRAG_GRENADE, 'repair_tool'],
    passive: 'anti_vehicle',
    role: '近中距离突破和反载具',
  },
  [SoldierClassId.MEDIC]: {
    id: SoldierClassId.MEDIC,
    name: '医护兵',
    primaryWeapon: WeaponType.SMG,
    equipment: ['medkit', 'smoke_launcher'],
    passive: 'fast_revive',
    role: '治疗、烟雾掩护与救援',
  },
  [SoldierClassId.SUPPORT]: {
    id: SoldierClassId.SUPPORT,
    name: '支援兵',
    primaryWeapon: WeaponType.LMG,
    equipment: ['ammo_box', EquipmentType.FRAG_GRENADE],
    passive: 'ammo_resupply',
    role: '持续火力和弹药补给',
  },
  [SoldierClassId.RECON]: {
    id: SoldierClassId.RECON,
    name: '侦察兵',
    primaryWeapon: WeaponType.BOLT_RIFLE,
    equipment: ['spotting_scope', EquipmentType.SMOKE_GRENADE],
    passive: 'enhanced_spotting',
    role: '远距离精确射击和目标标记',
  },
  [SoldierClassId.ENGINEER]: {
    id: SoldierClassId.ENGINEER,
    name: '工兵',
    primaryWeapon: WeaponType.SHOTGUN,
    equipment: [EquipmentType.FRAG_GRENADE, 'repair_tool'],
    passive: 'anti_vehicle',
    role: '近距离突破与载具维修',
  },
  [SoldierClassId.MARKSMAN]: {
    id: SoldierClassId.MARKSMAN,
    name: '精确射手',
    primaryWeapon: WeaponType.SEMI_RIFLE,
    equipment: ['spotting_scope', EquipmentType.SMOKE_GRENADE],
    passive: 'enhanced_spotting',
    role: '中远距离半自动精确火力',
  },
};

export function getSoldierClass(id: SoldierClassId): SoldierClassDefinition {
  return SOLDIER_CLASSES[id];
}
