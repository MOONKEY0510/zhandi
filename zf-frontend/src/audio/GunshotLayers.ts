/**
 * 枪声分层（阶段 6 音频 P0）。
 * 每声枪响由四层组成：机械声（拉栓/抛壳机构）、枪口爆发（近场主体）、
 * 远场尾音（远方可闻的低频轰鸣）、弹壳落地。层间距离窗口不同，
 * 远处只保留尾音，近处四层齐发，避免 32 人枪声互相淹没。
 */
export type GunshotLayerName = 'mechanism' | 'muzzle' | 'tail' | 'casing';

export interface GunshotLayerDef {
  name: GunshotLayerName;
  /** 该层最远可听距离 m */
  maxDistance: number;
  /** 基准音量 0..1 */
  baseVolume: number;
  /** 并发/虚拟化时的保留优先级，越大越优先 */
  priority: number;
}

export const GUNSHOT_LAYERS: Record<GunshotLayerName, GunshotLayerDef> = {
  mechanism: { name: 'mechanism', maxDistance: 12, baseVolume: 0.4, priority: 2 },
  muzzle: { name: 'muzzle', maxDistance: 60, baseVolume: 0.9, priority: 4 },
  casing: { name: 'casing', maxDistance: 20, baseVolume: 0.25, priority: 1 },
  tail: { name: 'tail', maxDistance: 250, baseVolume: 0.5, priority: 3 },
};

/** 播放顺序：主体 → 尾音 → 机械 → 弹壳（与混音总线顺序一致） */
export const GUNSHOT_LAYER_ORDER: readonly GunshotLayerName[] = ['muzzle', 'tail', 'mechanism', 'casing'];

/** 指定距离下该层的增益（平方衰减），超出可听距离为 0 */
export function computeLayerGain(layer: GunshotLayerDef, distance: number): number {
  if (distance >= layer.maxDistance) return 0;
  const t = distance / layer.maxDistance;
  return layer.baseVolume * (1 - t) * (1 - t);
}

/** 指定距离下可听到的层（按播放顺序） */
export function resolveAudibleLayers(distance: number): readonly GunshotLayerDef[] {
  return GUNSHOT_LAYER_ORDER.filter((name) => distance < GUNSHOT_LAYERS[name].maxDistance).map(
    (name) => GUNSHOT_LAYERS[name],
  );
}
