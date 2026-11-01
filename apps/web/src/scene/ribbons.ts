import { type MeshBuffer, type Vec2 } from './mesh-buffer.js';
import type { Rgb } from './palette.js';

/** A miter may extend at most this many half-widths from the centre line. */
export const MITER_LIMIT = 2;

/**
 * Turns a polyline into a flat strip of `width` metres at height `y`, with mitred joins.
 * Returns the number of triangles added.
 */
export function addRibbon(
  points: readonly Vec2[],
  width: number,
  y: number,
  colour: Rgb,
  out: MeshBuffer,
): number {
  const line = dedupe(points);
  if (line.length < 2 || width <= 0) {
    return 0;
  }
  const half = width / 2;
  const left: Vec2[] = [];
  const right: Vec2[] = [];
  for (let i = 0; i < line.length; i += 1) {
    const [ox, oz] = offsetAt(line, i, half);
    const [x, z] = line[i]!;
    left.push([x + ox, z + oz]);
    right.push([x - ox, z - oz]);
  }
  for (let i = 0; i + 1 < line.length; i += 1) {
    out.upTriangle(left[i]!, right[i]!, right[i + 1]!, y, colour);
    out.upTriangle(left[i]!, right[i + 1]!, left[i + 1]!, y, colour);
  }
  return (line.length - 1) * 2;
}

function dedupe(points: readonly Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const point of points) {
    const last = out.at(-1);
    if (!last || Math.hypot(point[0] - last[0], point[1] - last[1]) > 1e-3) {
      out.push(point);
    }
  }
  return out;
}

function unitNormal(a: Vec2, b: Vec2): Vec2 {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const length = Math.hypot(dx, dz);
  return [-dz / length, dx / length];
}

/** Offset from the centre line to the left edge at vertex i, miter-limited. */
export function offsetAt(line: readonly Vec2[], i: number, half: number): Vec2 {
  const prev = line[i - 1];
  const here = line[i]!;
  const next = line[i + 1];
  if (prev === undefined || next === undefined) {
    const n = prev === undefined ? unitNormal(here, next!) : unitNormal(prev, here);
    return [n[0] * half, n[1] * half];
  }
  const n1 = unitNormal(prev, here);
  const n2 = unitNormal(here, next);
  const mx = n1[0] + n2[0];
  const mz = n1[1] + n2[1];
  const mLength = Math.hypot(mx, mz);
  if (mLength < 1e-6) {
    return [n1[0] * half, n1[1] * half];
  }
  const miter: Vec2 = [mx / mLength, mz / mLength];
  const cos = miter[0] * n1[0] + miter[1] * n1[1];
  const length = Math.min(half / Math.max(cos, 1e-6), half * MITER_LIMIT);
  return [miter[0] * length, miter[1] * length];
}
