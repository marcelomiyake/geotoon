export type Rgb = readonly [number, number, number];

export function hexToRgb(hex: number): Rgb {
  return [((hex >> 16) & 0xff) / 255, ((hex >> 8) & 0xff) / 255, (hex & 0xff) / 255];
}

/** FNV-1a over UTF-16 code units; deterministic across browsers and Node. */
export function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Eight warm toon colours for building walls and roofs. */
export const BUILDING_COLOURS: readonly Rgb[] = [
  0xf2d0a4, 0xe8b07d, 0xf4e1c1, 0xd9a07b, 0xf0c987, 0xe6c3b3, 0xc9b79c, 0xf7d9a8,
].map(hexToRgb);

export function buildingColour(id: string): Rgb {
  return BUILDING_COLOURS[fnv1a32(id) % BUILDING_COLOURS.length] ?? BUILDING_COLOURS[0]!;
}

export const ROOF_SHADE = 0.82;

const AREA_COLOURS: Readonly<Record<string, number>> = {
  park: 0x8fcf6a,
  grass: 0x9fd77a,
  pitch: 0x6fbf5a,
  forest: 0x5fa64f,
  water: 0x5aaee0,
  residential: 0xe9e2cf,
  industrial: 0xd8d2c8,
  commercial: 0xeadbc8,
  education: 0xeedfb0,
  other: 0xe4ddca,
};

const LINE_COLOURS: Readonly<Record<string, number>> = {
  motorway: 0x6b6f7a,
  trunk: 0x6b6f7a,
  primary: 0x75798a,
  secondary: 0x7d8190,
  tertiary: 0x858996,
  residential: 0x8d909b,
  unclassified: 0x8d909b,
  service: 0x9a9da6,
  footway: 0xd7c7a7,
  path: 0xc9b48a,
  cycleway: 0xc98f7a,
  steps: 0xbfae90,
  rail: 0x5b4a3f,
  stream: 0x5aaee0,
  river: 0x4f9fd4,
  other: 0x9a9da6,
};

export const GROUND_COLOUR: Rgb = hexToRgb(0xdcd6bf);
export const SKY_COLOUR = 0xa8d8f0;
export const TRUNK_COLOUR = 0x8a5a3b;
export const CROWN_COLOUR = 0x4f9a45;
export const MARKER_COLOUR = 0xe8453c;

export function areaColour(kind: string): Rgb {
  return hexToRgb(AREA_COLOURS[kind] ?? AREA_COLOURS['other']!);
}

export function lineColour(kind: string): Rgb {
  return hexToRgb(LINE_COLOURS[kind] ?? LINE_COLOURS['other']!);
}
