import type { Vec2 } from './mesh-buffer.js';

/** Streets that get a sidewalk on each side, a painted centre line and utility poles. */
const SIDEWALK_KINDS: ReadonlySet<string> = new Set([
  'primary',
  'secondary',
  'tertiary',
  'residential',
  'unclassified',
  'living_street',
]);
const CENTRE_LINE_KINDS: ReadonlySet<string> = new Set([
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'residential',
  'unclassified',
]);
const POLE_KINDS: ReadonlySet<string> = new Set(['secondary', 'tertiary', 'residential', 'unclassified', 'living_street']);

export const SIDEWALK_WIDTH_M = 1.8;
/** Centre lines need a road at least this wide (two lanes). */
export const MIN_CENTRE_LINE_ROAD_M = 6;
export const DASH_M = 3;
export const DASH_GAP_M = 4;
export const MARKING_WIDTH_M = 0.15;
export const POLE_SPACING_M = 34;
export const POLE_HEIGHT_M = 8.6;
export const CROSSARM_Y_M = 7.9;
/** Wire sag at mid-span, in metres. */
export const WIRE_SAG_M = 0.45;
export const WIRE_SEGMENTS = 6;
/** Wires per span: offset across the street from the pole centre, and height. */
export const WIRES: readonly (readonly [across: number, y: number])[] = [
  [-0.7, CROSSARM_Y_M],
  [-0.25, CROSSARM_Y_M],
  [0.7, CROSSARM_Y_M],
  [0.2, 6.4],
  [0.2, 6],
];

export function hasSidewalks(kind: string): boolean {
  return SIDEWALK_KINDS.has(kind);
}

export function hasCentreLine(kind: string, widthM: number): boolean {
  return CENTRE_LINE_KINDS.has(kind) && widthM >= MIN_CENTRE_LINE_ROAD_M;
}

export function hasPoles(kind: string): boolean {
  return POLE_KINDS.has(kind);
}

/** Splits a polyline into dashes of `dash` metres separated by gaps of `gap` metres. */
export function dashes(points: readonly Vec2[], dash: number, gap: number): Vec2[][] {
  const out: Vec2[][] = [];
  const period = dash + gap;
  let travelled = 0;
  let current: Vec2[] | undefined;
  for (let i = 0; i + 1 < points.length; i += 1) {
    const p = points[i]!;
    const q = points[i + 1]!;
    const length = Math.hypot(q[0] - p[0], q[1] - p[1]);
    let at = 0;
    while (at < length) {
      const phase = (travelled + at) % period;
      const drawing = phase < dash;
      const step = Math.min(length - at, drawing ? dash - phase : period - phase);
      if (drawing) {
        current ??= [lerp(p, q, at / length)];
        current.push(lerp(p, q, (at + step) / length));
      } else if (current !== undefined) {
        out.push(current);
        current = undefined;
      }
      at += step;
    }
    travelled += length;
  }
  if (current !== undefined) {
    out.push(current);
  }
  return out.filter((dashPoints) => dashPoints.length >= 2);
}

/** One utility pole: position and the direction of the street (radians, x toward z). */
export interface Pole {
  readonly x: number;
  readonly z: number;
  readonly angle: number;
}

/**
 * Poles every `spacing` metres along a polyline, set `offset` metres to its left. The
 * first pole is half a spacing from the start so short blocks still get one.
 */
export function polesAlong(points: readonly Vec2[], spacing: number, offset: number): Pole[] {
  const poles: Pole[] = [];
  let next = spacing / 2;
  let travelled = 0;
  for (let i = 0; i + 1 < points.length; i += 1) {
    const p = points[i]!;
    const q = points[i + 1]!;
    const dx = q[0] - p[0];
    const dz = q[1] - p[1];
    const length = Math.hypot(dx, dz);
    if (length < 1e-6) {
      continue;
    }
    const ux = dx / length;
    const uz = dz / length;
    while (next <= travelled + length) {
      const t = next - travelled;
      poles.push({ x: p[0] + ux * t - uz * offset, z: p[1] + uz * t + ux * offset, angle: Math.atan2(dz, dx) });
      next += spacing;
    }
    travelled += length;
  }
  return poles;
}

/**
 * Sagging wires between consecutive poles, appended to `out` as line segments
 * (x, y, z pairs, 6 floats per segment). Returns the segments added.
 */
export function addWires(poles: readonly Pole[], out: number[]): number {
  let added = 0;
  for (let i = 0; i + 1 < poles.length; i += 1) {
    const a = poles[i]!;
    const b = poles[i + 1]!;
    for (const [across, y] of WIRES) {
      const from = attachment(a, across);
      const to = attachment(b, across);
      let previous: [number, number, number] = [from[0], y, from[1]];
      for (let s = 1; s <= WIRE_SEGMENTS; s += 1) {
        const t = s / WIRE_SEGMENTS;
        const point: [number, number, number] = [
          from[0] + (to[0] - from[0]) * t,
          y - WIRE_SAG_M * 4 * t * (1 - t),
          from[1] + (to[1] - from[1]) * t,
        ];
        out.push(...previous, ...point);
        previous = point;
        added += 1;
      }
    }
  }
  return added;
}

/** Where a wire meets the crossarm: `across` metres from the pole, across the street. */
function attachment(pole: Pole, across: number): Vec2 {
  return [pole.x - Math.sin(pole.angle) * across, pole.z + Math.cos(pole.angle) * across];
}

function lerp(p: Vec2, q: Vec2, t: number): Vec2 {
  return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
}
