import { type MeshBuffer, type Vec2, type Vec3, isCorner, signedArea } from './mesh-buffer.js';
import type { Rgb } from './palette.js';

/** Pitched (gable) roofs go on small, nearly rectangular, low buildings: houses and sheds. */
export const MIN_GABLE_AREA_M2 = 20;
export const MAX_GABLE_AREA_M2 = 400;
export const MAX_GABLE_WALL_M = 10;
/** Corners must be within this many degrees of a right angle. */
const SQUARENESS_DEG = 20;
const SQUARENESS_COS = Math.sin((SQUARENESS_DEG * Math.PI) / 180);

export const ROOF_PITCH_DEG = 27;
const PITCH_TAN = Math.tan((ROOF_PITCH_DEG * Math.PI) / 180);
/** How far the roof reaches past the walls on every side. */
export const EAVE_OVERHANG_M = 0.45;
/** Depth of the board along the eaves, which gives the roof a visible thickness. */
export const FASCIA_M = 0.18;
const UNDERSIDE_SHADE = 0.55;

/** Four corners, anticlockwise from above; AB and CD are the short (gable) ends. */
export type GableCorners = readonly [Vec2, Vec2, Vec2, Vec2];

/**
 * Picks the corners of a ring that is close to a rectangle, ordered so the ridge runs
 * along the long side. Returns undefined for any other shape or size.
 */
export function gableCorners(ring: readonly Vec2[]): GableCorners | undefined {
  const n = ring.length;
  const corners = ring.filter((point, i) => isCorner(ring[(i + n - 1) % n]!, point, ring[(i + 1) % n]!));
  if (corners.length !== 4) {
    return undefined;
  }
  const area = Math.abs(signedArea(corners));
  if (area < MIN_GABLE_AREA_M2 || area > MAX_GABLE_AREA_M2) {
    return undefined;
  }
  for (let i = 0; i < 4; i += 1) {
    if (Math.abs(cosAt(corners[(i + 3) % 4]!, corners[i]!, corners[(i + 1) % 4]!)) > SQUARENESS_COS) {
      return undefined;
    }
  }
  const [a, b, c, d] = [corners[0]!, corners[1]!, corners[2]!, corners[3]!];
  const ends = distance(a, b) + distance(c, d);
  const sides = distance(b, c) + distance(d, a);
  return ends <= sides ? [a, b, c, d] : [b, c, d, a];
}

/**
 * A gable roof on walls whose tops are at `wallTopY`: two slopes with overhang, an
 * underside, eave boards and the two triangular gable walls. When `edges` is given, the
 * ridge, eaves, rakes and the bottom of the eave boards are added as contour segments.
 * Returns the triangles added.
 */
export function addGableRoof(
  corners: GableCorners,
  wallTopY: number,
  wallColour: Rgb,
  tileColour: Rgb,
  out: MeshBuffer,
  edges?: number[],
): number {
  const before = out.triangles;
  const [a, b, c, d] = corners;
  const m1 = midpoint(a, b);
  const m2 = midpoint(c, d);
  const length = distance(m1, m2);
  const axis: Vec2 = [(m2[0] - m1[0]) / length, (m2[1] - m1[1]) / length];
  // Unit vector across the ridge, toward the BC eave.
  const across: Vec2 = [-axis[1], axis[0]];
  const bcSide = Math.sign(dot(across, [b[0] - m1[0], b[1] - m1[1]])) || 1;
  const halfSpan =
    [a, b, c, d].reduce((sum, p) => sum + Math.abs(dot(across, [p[0] - m1[0], p[1] - m1[1]])), 0) / 4;
  const ridgeY = wallTopY + halfSpan * PITCH_TAN;
  const eaveY = wallTopY - EAVE_OVERHANG_M * PITCH_TAN;
  const o = EAVE_OVERHANG_M;

  const eave = (p: Vec2, along: number, side: number): Vec3 => [
    p[0] + (axis[0] * along + across[0] * side) * o,
    eaveY,
    p[1] + (axis[1] * along + across[1] * side) * o,
  ];
  const A = eave(a, -1, -bcSide);
  const B = eave(b, -1, bcSide);
  const C = eave(c, 1, bcSide);
  const D = eave(d, 1, -bcSide);
  const R1: Vec3 = [m1[0] - axis[0] * o, ridgeY, m1[1] - axis[1] * o];
  const R2: Vec3 = [m2[0] + axis[0] * o, ridgeY, m2[1] + axis[1] * o];

  const up: Vec3 = [0, 1, 0];
  const down: Vec3 = [0, -1, 0];
  const underside: Rgb = [tileColour[0] * UNDERSIDE_SHADE, tileColour[1] * UNDERSIDE_SHADE, tileColour[2] * UNDERSIDE_SHADE];
  for (const slope of [
    [B, C, R2, R1],
    [D, A, R1, R2],
  ] as const) {
    out.quad(slope[0], slope[1], slope[2], slope[3], tileColour, up);
    out.quad(slope[0], slope[1], slope[2], slope[3], underside, down);
  }

  const lower = (p: Vec3): Vec3 => [p[0], p[1] - FASCIA_M, p[2]];
  const bcOut: Vec3 = [across[0] * bcSide, 0, across[1] * bcSide];
  const daOut: Vec3 = [-bcOut[0], 0, -bcOut[2]];
  out.quad(B, C, lower(C), lower(B), tileColour, bcOut);
  out.quad(D, A, lower(A), lower(D), tileColour, daOut);

  addGable(a, b, m1, wallTopY, ridgeY, wallColour, out);
  addGable(c, d, m2, wallTopY, ridgeY, wallColour, out);

  if (edges !== undefined) {
    const segments: (readonly [Vec3, Vec3])[] = [
      [R1, R2],
      [B, C],
      [D, A],
      [A, R1],
      [R1, B],
      [C, R2],
      [R2, D],
      [lower(B), lower(C)],
      [lower(D), lower(A)],
    ];
    for (const [p, q] of segments) {
      edges.push(p[0], p[1], p[2], q[0], q[1], q[2]);
    }
  }
  return out.triangles - before;
}

/** The triangle of wall between the wall top and the ridge, on the gable end p-q. */
function addGable(p: Vec2, q: Vec2, apex: Vec2, y: number, ridgeY: number, colour: Rgb, out: MeshBuffer): void {
  const dx = q[0] - p[0];
  const dz = q[1] - p[1];
  const length = Math.hypot(dx, dz);
  const normal: Vec3 = [-dz / length, 0, dx / length];
  out.triangle([p[0], y, p[1]], [q[0], y, q[1]], [apex[0], ridgeY, apex[1]], normal, colour);
}

function cosAt(previous: Vec2, point: Vec2, next: Vec2): number {
  const u: Vec2 = [previous[0] - point[0], previous[1] - point[1]];
  const v: Vec2 = [next[0] - point[0], next[1] - point[1]];
  return dot(u, v) / (Math.hypot(u[0], u[1]) * Math.hypot(v[0], v[1]));
}

function midpoint(p: Vec2, q: Vec2): Vec2 {
  return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
}

function distance(p: Vec2, q: Vec2): number {
  return Math.hypot(q[0] - p[0], q[1] - p[1]);
}

function dot(u: Vec2, v: Vec2): number {
  return u[0] * v[0] + u[1] * v[1];
}
