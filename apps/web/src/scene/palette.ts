/** Linear-light RGB in 0..1, the space WebGL vertex colours are blended in. */
export type Rgb = readonly [number, number, number];

/** sRGB transfer function, inverted (IEC 61966-2-1). */
export function srgbToLinear(channel: number): number {
  return channel <= 0.040_45 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

/**
 * Converts a design colour (sRGB hex, as picked by eye) to linear RGB. Vertex colours
 * skip three.js colour management, so passing sRGB values straight through would wash
 * every colour out toward grey.
 */
export function hexToRgb(hex: number): Rgb {
  return [
    srgbToLinear(((hex >> 16) & 0xff) / 255),
    srgbToLinear(((hex >> 8) & 0xff) / 255),
    srgbToLinear((hex & 0xff) / 255),
  ];
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

/** Anime-style walls: bright, saturated pastels with a few clean whites. */
export const WALL_COLOURS: readonly Rgb[] = [
  0xfff4e0, // warm white
  0xffd166, // sunflower
  0xff9e7a, // coral
  0x7cc6fe, // sky blue
  0x9be564, // lime
  0xf7a8d8, // sakura pink
  0xc3a6ff, // lilac
  0x5fd3c4, // mint teal
  0xffb347, // tangerine
  0xf1f7ff, // cool white
].map(hexToRgb);

/** Roofs contrast with the walls, as in hand-painted anime backgrounds. */
export const ROOF_COLOURS: readonly Rgb[] = [
  0xe4572e, // vermilion
  0x2f6fd6, // cobalt
  0x2fa84f, // emerald
  0x8e44ad, // violet
  0xf0a202, // mustard
  0x17a2b8, // teal
  0xc0392b, // brick red
  0x34495e, // slate
].map(hexToRgb);

export interface BuildingColours {
  readonly wall: Rgb;
  readonly roof: Rgb;
}

/** Stable colours per building id, so a building looks the same on every visit. */
export function buildingColours(id: string): BuildingColours {
  const hash = fnv1a32(id);
  return {
    wall: WALL_COLOURS[hash % WALL_COLOURS.length] ?? WALL_COLOURS[0]!,
    roof: ROOF_COLOURS[(hash >>> 8) % ROOF_COLOURS.length] ?? ROOF_COLOURS[0]!,
  };
}

const AREA_COLOURS: Readonly<Record<string, number>> = {
  park: 0x6fdc5a,
  grass: 0x8be36b,
  pitch: 0x3fc36a,
  forest: 0x2e9e4f,
  water: 0x3fa9f5,
  residential: 0xf3ead2,
  industrial: 0xdcd3e6,
  commercial: 0xffe0c2,
  education: 0xfff0a8,
  other: 0xefe6cc,
};

const LINE_COLOURS: Readonly<Record<string, number>> = {
  motorway: 0x5a5f73,
  trunk: 0x5a5f73,
  primary: 0x666b80,
  secondary: 0x70758a,
  tertiary: 0x7a7f93,
  residential: 0x878ba0,
  unclassified: 0x878ba0,
  service: 0x9599ab,
  footway: 0xf2d6a2,
  path: 0xe6bf7e,
  cycleway: 0xf08a6c,
  steps: 0xe2c494,
  rail: 0x5b4636,
  stream: 0x3fa9f5,
  river: 0x2f95e8,
  other: 0x9599ab,
};

export const GROUND_COLOUR: Rgb = hexToRgb(0xf0e6c8);
/** These are hex values for `THREE.Color`, which applies colour management itself. */
export const SKY_COLOUR = 0x5cc8ff;
export const TRUNK_COLOUR = 0x8b5a2b;
export const CROWN_COLOUR = 0x3dbb4f;
export const MARKER_COLOUR = 0xff3b5c;
/** Ink for contour lines: a deep blue-black reads softer than pure black. */
export const INK_COLOUR = 0x1a1a2e;

export function areaColour(kind: string): Rgb {
  return hexToRgb(AREA_COLOURS[kind] ?? AREA_COLOURS['other']!);
}

export function lineColour(kind: string): Rgb {
  return hexToRgb(LINE_COLOURS[kind] ?? LINE_COLOURS['other']!);
}
