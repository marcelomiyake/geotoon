import type { SceneBuilding } from '@geotoon/contracts';
import type { FacadeStyle } from './architecture.js';
import { fnv1a32 } from './palette.js';

export interface WindowStyle extends FacadeStyle {
  /** 0: single pane; 1: paired panes; 2: cross frame. */
  readonly mullion: number;
}

/** Shared shader presets vary proportions while retaining the locality's character. */
export function windowStyles(base: FacadeStyle): readonly WindowStyle[] {
  return [
    { ...base, slotM: base.slotM * 1.15, halfWindowM: base.halfWindowM * 0.62, mullion: 0 },
    { ...base, sillM: base.sillM * 1.1, halfWindowM: base.halfWindowM * 0.9, mullion: 1 },
    { ...base, storeyM: base.storeyM * 1.12, headM: base.headM * 1.1,
      halfWindowM: base.halfWindowM * 1.2, frameM: base.frameM * 0.65, mullion: 0 },
    { ...base, slotM: base.slotM * 0.9, headM: base.headM * 1.08,
      halfWindowM: base.halfWindowM * 0.58, mullion: 2 },
    { ...base, slotM: base.slotM * 1.6, storeyM: base.storeyM * 1.5,
      sillM: base.sillM * 2.1, headM: base.headM * 1.45, mullion: 0 },
    { ...base, slotM: base.slotM * 1.35, halfWindowM: base.halfWindowM * 1.22,
      frameM: base.frameM * 1.35, mullion: 2 },
  ];
}

/** Kind and height select suitable families; IDs keep neighbouring buildings distinct. */
export function buildingFacade(building: SceneBuilding) {
  const hash = fnv1a32(`${building.id}:facade`);
  let variants: readonly number[];
  if (building.kind === 'warehouse' || building.kind === 'industrial') {
    variants = [4];
  } else if (building.kind === 'office' || building.kind === 'commercial') {
    variants = [2, 3, 5];
  } else {
    variants = building.heightM <= 10 ? [0, 1, 3, 5] : [0, 1, 2, 3, 5];
  }
  const variant = variants[hash % variants.length]!;
  return { variant, seed: (hash >>> 8) / 0x1000000 };
}
