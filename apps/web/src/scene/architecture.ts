import type { Locality, SceneBuilding } from '@geotoon/contracts';
import { DEFAULT_BUILDING_PALETTE, type BuildingPalette, buildingColours, fnv1a32, hexToRgb } from './palette.js';

export interface FacadeStyle {
  readonly slotM: number;
  readonly storeyM: number;
  readonly sillM: number;
  readonly headM: number;
  readonly halfWindowM: number;
  readonly frameM: number;
}

/** Presentation defaults, not claims about the architecture of individual buildings. */
export interface ArchitectureStyle {
  readonly id: string;
  readonly palette: BuildingPalette;
  readonly pitchedRoofFraction: number;
  readonly facade: FacadeStyle;
  readonly streetSign: 'generic' | 'brazil' | 'sao-paulo';
}

const DEFAULT: ArchitectureStyle = {
  id: 'default',
  palette: DEFAULT_BUILDING_PALETTE,
  pitchedRoofFraction: 1,
  facade: { slotM: 3.2, storeyM: 3, sillM: 0.95, headM: 2.3, halfWindowM: 0.8, frameM: 0.09 },
  streetSign: 'generic',
};

const BRAZIL: ArchitectureStyle = {
  id: 'BR',
  palette: {
    walls: [0xf4e9cf, 0xe8d9bf, 0xf2d2b6, 0xd4dcd5, 0xe6c8a5, 0xc9ddd9, 0xe4bca9, 0xeee9df].map(hexToRgb),
    roofs: [0xc4beb3, 0xd8d0c1, 0xe1dcd2, 0xaaa9a4].map(hexToRgb),
    tiles: [0xb95f40, 0xc96e49, 0xd78354, 0xa8543c].map(hexToRgb),
  },
  pitchedRoofFraction: 0.65,
  facade: { slotM: 3, storeyM: 3, sillM: 1, headM: 2.15, halfWindowM: 0.95, frameM: 0.045 },
  streetSign: 'brazil',
};

const SAO_PAULO: ArchitectureStyle = {
  ...BRAZIL,
  id: 'BR/sao-paulo',
  palette: { ...BRAZIL.palette, walls: [0xe6dfcf, 0xd4cdc1, 0xf0e7d5, 0xc9d1d0, 0xe3c9ae, 0xdbd7ce].map(hexToRgb) },
  pitchedRoofFraction: 0.4,
  facade: { ...BRAZIL.facade, slotM: 2.8, halfWindowM: 1 },
  streetSign: 'sao-paulo',
};

/** City overrides country; unsupported or unknown localities keep the original style. */
export function architectureFor(locality?: Locality): ArchitectureStyle {
  if (locality?.countryCode.toUpperCase() !== 'BR') {
    return DEFAULT;
  }
  const city = locality.city?.normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLowerCase();
  return city === 'sao paulo' ? SAO_PAULO : BRAZIL;
}

const FLAT_ROOF_KINDS: ReadonlySet<string> = new Set([
  'apartments', 'commercial', 'industrial', 'retail', 'office', 'warehouse', 'school', 'hospital',
]);

export function buildingAppearance(building: SceneBuilding, style: ArchitectureStyle) {
  return {
    colours: buildingColours(building.id, style.palette),
    pitched: building.minHeightM < 0.5 && !FLAT_ROOF_KINDS.has(building.kind)
      && fnv1a32(`${building.id}:roof`) / 2 ** 32 < style.pitchedRoofFraction,
  };
}
