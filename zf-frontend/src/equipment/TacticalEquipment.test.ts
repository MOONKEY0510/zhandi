import { describe, it, expect } from 'vitest';
import { EquipmentType, EQUIPMENT_CONFIGS } from './TacticalEquipment';

describe('TacticalEquipment（阶段 7 反载具链）', () => {
  it('所有装备类型都有配置（含新增反坦克火箭）', () => {
    for (const type of Object.values(EquipmentType)) {
      expect(EQUIPMENT_CONFIGS[type]).toBeDefined();
      expect(EQUIPMENT_CONFIGS[type].name.length).toBeGreaterThan(0);
      expect(EQUIPMENT_CONFIGS[type].maxCount).toBeGreaterThan(0);
    }
  });

  it('反坦克火箭：直射高速、命中即爆、大伤害', () => {
    const config = EQUIPMENT_CONFIGS[EquipmentType.PANZERFAUST];
    expect(config.name).toBe('反坦克火箭');
    // 直射：无抛射弧线
    expect(config.throwArc).toBe(0);
    // 高速弹道（远快于手雷 18）
    expect(config.throwSpeed).toBeGreaterThan(40);
    // 引信极长：不会在空中自爆，命中才爆
    expect(config.fuseTime).toBeGreaterThan(100);
    // 高伤害 + 小范围爆炸
    expect(config.damage).toBeGreaterThan(200);
    expect(config.radius).toBeLessThanOrEqual(6);
  });
});
