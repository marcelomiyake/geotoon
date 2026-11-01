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

/** Pastel plaster walls, as in hand-painted anime street scenes. */
export const WALL_COLOURS: readonly Rgb[] = [
  0xf7e6a6, // cream yellow
  0xfaf1cf, // butter
  0xc2e6c4, // mint
  0xd6e7b4, // sage
  0xbcdcee, // powder blue
  0xd3cce6, // lavender
  0xf4d2c8, // blush
  0xf7d8ae, // peach
  0xf5f0e4, // off-white
  0xaee0d8, // pale teal
].map(hexToRgb);

/** Flat roofs, seen from above: concrete and painted slabs, softer than the walls. */
export const ROOF_COLOURS: readonly Rgb[] = [
  0xd9d6cf, // concrete
  0xe6dac4, // sand
  0xc98a6b, // faded terracotta
  0xa9bccf, // grey-blue
  0xc4d3c0, // grey-green
  0xefebe3, // white slab
].map(hexToRgb);

/** Clay tiles for pitched roofs, with an occasional painted metal roof. */
export const TILE_COLOURS: readonly Rgb[] = [
  0xd9573b, // terracotta
  0xc94a31, // brick
  0xe46a43, // orange clay
  0xbd4b36, // dark clay
  0xd4613f, // red clay
  0x4f74a3, // blue metal
  0x3f8f88, // teal metal
].map(hexToRgb);

export interface BuildingColours {
  readonly wall: Rgb;
  readonly roof: Rgb;
  readonly tile: Rgb;
}

/** Stable colours per building id, so a building looks the same on every visit. */
export function buildingColours(id: string): BuildingColours {
  const hash = fnv1a32(id);
  return {
    wall: WALL_COLOURS[hash % WALL_COLOURS.length] ?? WALL_COLOURS[0]!,
    roof: ROOF_COLOURS[(hash >>> 8) % ROOF_COLOURS.length] ?? ROOF_COLOURS[0]!,
    tile: TILE_COLOURS[(hash >>> 16) % TILE_COLOURS.length] ?? TILE_COLOURS[0]!,
  };
}

const AREA_COLOURS: Readonly<Record<string, number>> = {
  park: 0x7fd36a,
  grass: 0x96dc74,
  pitch: 0x5cc977,
  forest: 0x4caf5a,
  water: 0x55b9e6,
  residential: 0xe8e2d4,
  industrial: 0xdcd8e2,
  commercial: 0xeee0cf,
  education: 0xf3ebc8,
  other: 0xe6e0d0,
};

/** Sunlit asphalt reads as a light blue-grey in the reference style; paths are warm. */
const LINE_COLOURS: Readonly<Record<string, number>> = {
  motorway: 0x7d8799,
  trunk: 0x7d8799,
  primary: 0x8a94a6,
  secondary: 0x929cad,
  tertiary: 0x9ba4b4,
  residential: 0xa3acbb,
  unclassified: 0xa3acbb,
  service: 0xadb5c2,
  footway: 0xe9dcc0,
  path: 0xdcc69a,
  cycleway: 0xe39a80,
  steps: 0xe2cfa8,
  rail: 0x6b5a4b,
  stream: 0x55b9e6,
  river: 0x45ade0,
  other: 0xadb5c2,
};

export const GROUND_COLOUR: Rgb = hexToRgb(0xe2dccd);
export const SIDEWALK_COLOUR: Rgb = hexToRgb(0xe6e1d6);
export const MARKING_COLOUR: Rgb = hexToRgb(0xf2c230);

/**
 * Cel lighting, in linear RGB. A face in shadow gets `SHADOW_TINT` times its colour plus
 * `SHADE_LIFT`, a cool blue-lavender as in painted anime backgrounds; a sunlit face gets
 * `LIT_TINT` times its colour plus the same lift.
 */
export const SHADOW_TINT: Rgb = [0.44, 0.49, 0.7];
export const LIT_TINT: Rgb = [1, 0.97, 0.88];
export const SHADE_LIFT: Rgb = [0.03, 0.045, 0.13];

/** Window glass, frames and the trim along the top of walls (linear RGB). */
export const GLASS_COLOUR: Rgb = hexToRgb(0x4f93bd);
export const GLASS_HIGHLIGHT_COLOUR: Rgb = hexToRgb(0xa9dcf2);
export const FRAME_COLOUR: Rgb = hexToRgb(0xf6f3ea);
export const TRIM_COLOUR: Rgb = hexToRgb(0xf3eee2);

/** These are hex values for `THREE.Color`, which applies colour management itself. */
export const SKY_ZENITH_COLOUR = 0x22b4ec;
export const SKY_HORIZON_COLOUR = 0xc8eef8;
/** Kept until the renderer draws the painted sky. */
export const SKY_COLOUR = 0x5cc8ff;
export const CLOUD_SHADE_COLOUR = 0xb9cde6;
export const MOUNTAIN_COLOUR = 0x7fb9c4;
export const TRUNK_COLOUR = 0x8b5a2b;
export const CROWN_COLOUR = 0x5ec24c;
export const POLE_COLOUR = 0xb9b3a7;
export const MARKER_COLOUR = 0xff3b5c;
/** Ink for contour lines: a deep blue-black reads softer than pure black. */
export const INK_COLOUR = 0x23263a;

export function areaColour(kind: string): Rgb {
  return hexToRgb(AREA_COLOURS[kind] ?? AREA_COLOURS['other']!);
}

export function lineColour(kind: string): Rgb {
  return hexToRgb(LINE_COLOURS[kind] ?? LINE_COLOURS['other']!);
}
