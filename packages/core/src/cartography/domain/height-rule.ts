/** Bump when the rule changes; heights are computed at read time, so no refetch is needed. */
export const HEIGHT_RULE_VERSION = 1;
export const FLOOR_HEIGHT_M = 3;

export type HeightSource = 'measured' | 'floors' | 'estimated';

export interface HeightInput {
  readonly id: string;
  readonly footprintAreaM2: number;
  readonly sourceHeightM?: number;
  readonly numFloors?: number;
  readonly minHeightM?: number;
}

export interface Height {
  readonly heightM: number;
  readonly minHeightM: number;
  readonly source: HeightSource;
}

interface Band {
  readonly maxAreaM2: number;
  readonly minM: number;
  readonly maxM: number;
}

/**
 * Footprint-area bands. 95% of buildings in the PoC area have no class, so area is the
 * only signal: small footprints are 1-3 storey houses, large ones are low warehouses.
 */
const BANDS: readonly Band[] = [
  { maxAreaM2: 40, minM: 3, maxM: 6 },
  { maxAreaM2: 150, minM: 3, maxM: 9 },
  { maxAreaM2: 600, minM: 6, maxM: 15 },
  { maxAreaM2: Number.POSITIVE_INFINITY, minM: 8, maxM: 12 },
];

/**
 * FNV-1a (32-bit) over the UTF-16 positions of `text`, reading each position's code point
 * (identical to the code unit for the ASCII ids Overture uses). Stable across platforms.
 */
export function fnv1a32(text: string): number {
  let hash = 0x81_1c_9d_c5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.codePointAt(i) ?? 0;
    hash = Math.imul(hash, 0x01_00_01_93) >>> 0;
  }
  return hash >>> 0;
}

/** Height rule v1: source height, then floors x 3 m, then a deterministic estimate from area. */
export function estimateHeight(input: HeightInput): Height {
  const base = Math.max(0, input.minHeightM ?? 0);
  const { heightM, source } = topHeight(input);
  const minHeightM = base < heightM ? base : 0;
  return { heightM, minHeightM, source };
}

function topHeight(input: HeightInput): { heightM: number; source: HeightSource } {
  if (input.sourceHeightM !== undefined && input.sourceHeightM > 0) {
    return { heightM: input.sourceHeightM, source: 'measured' };
  }
  if (input.numFloors !== undefined && input.numFloors > 0) {
    return { heightM: input.numFloors * FLOOR_HEIGHT_M, source: 'floors' };
  }
  const band = BANDS.find((b) => input.footprintAreaM2 < b.maxAreaM2) ?? BANDS.at(-1);
  const fraction = (fnv1a32(input.id) % 1000) / 1000;
  const raw = band ? band.minM + fraction * (band.maxM - band.minM) : FLOOR_HEIGHT_M;
  return { heightM: Math.round(raw * 10) / 10, source: 'estimated' };
}
