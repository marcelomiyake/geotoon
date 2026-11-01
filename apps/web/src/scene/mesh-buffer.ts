import type { Rgb } from './palette.js';

export type Vec2 = readonly [number, number];
export type Ring = readonly Vec2[];

/** Non-indexed triangle soup with flat normals and per-vertex colours. */
export interface MeshData {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly colors: Float32Array;
  readonly triangles: number;
}

/** Growable buffer; `toMeshData` copies into tight float32 arrays. */
export class MeshBuffer {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly colors: number[] = [];

  get triangles(): number {
    return this.positions.length / 9;
  }

  /** Adds one triangle; the vertex order must already be counter-clockwise seen from the normal. */
  triangle(
    a: readonly [number, number, number],
    b: readonly [number, number, number],
    c: readonly [number, number, number],
    normal: readonly [number, number, number],
    colour: Rgb,
  ): void {
    this.positions.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i += 1) {
      this.normals.push(...normal);
      this.colors.push(...colour);
    }
  }

  /** Adds a horizontal triangle at height y facing up, fixing its winding if needed. */
  upTriangle(a: Vec2, b: Vec2, c: Vec2, y: number, colour: Rgb): void {
    // y component of (b - a) x (c - a) with points (x, y, z); positive means facing up.
    const up = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
    const [p, q] = up >= 0 ? [b, c] : [c, b];
    this.triangle([a[0], y, a[1]], [p[0], y, p[1]], [q[0], y, q[1]], [0, 1, 0], colour);
  }

  toMeshData(): MeshData {
    return {
      positions: new Float32Array(this.positions),
      normals: new Float32Array(this.normals),
      colors: new Float32Array(this.colors),
      triangles: this.triangles,
    };
  }
}

/** Signed area in the x/z plane; positive is counter-clockwise seen from above (+y). */
export function signedArea(ring: Ring): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const [x1, z1] = ring[i]!;
    const [x2, z2] = ring[(i + 1) % ring.length]!;
    sum += x2 * z1 - x1 * z2;
  }
  return sum / 2;
}

/** Drops the closing vertex (GeoJSON rings repeat the first point) and duplicate neighbours. */
export function openRing(ring: Ring): Vec2[] {
  const out: Vec2[] = [];
  for (const point of ring) {
    const last = out.at(-1);
    if (!last || last[0] !== point[0] || last[1] !== point[1]) {
      out.push(point);
    }
  }
  const first = out[0];
  const last = out.at(-1);
  if (out.length > 1 && first && last && first[0] === last[0] && first[1] === last[1]) {
    out.pop();
  }
  return out;
}

/** Returns the ring with the requested orientation seen from above. */
export function orient(ring: Ring, counterClockwise: boolean): Vec2[] {
  const copy = [...ring];
  return signedArea(copy) > 0 === counterClockwise ? copy : copy.reverse();
}
