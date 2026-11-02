import type { Rgb } from './palette.js';

export type Vec2 = readonly [number, number];
export type Vec3 = readonly [number, number, number];
export type Ring = readonly Vec2[];

/**
 * Per-vertex facade coordinates for building walls, read by the window shader: window slot
 * (0..n along the wall), metres below the wall top, and slot width in metres. This value
 * marks faces that are not walls (roofs, gables): no windows and no roof trim.
 */
export const NO_FACADE: Vec3 = [0, -1, 0];
const NO_FACADES: readonly [Vec3, Vec3, Vec3] = [NO_FACADE, NO_FACADE, NO_FACADE];
const DEFAULT_FACADE_LAYOUT: Vec3 = [0, 0, 0];

/** Non-indexed triangle soup with flat normals and per-vertex colours. */
export interface MeshData {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly colors: Float32Array;
  /** Facade coordinates (3 floats per vertex); only on buffers created with `facade: true`. */
  readonly facade?: Float32Array;
  /** Per vertex: building floor datum, window-style index and a stable lighting seed. */
  readonly facadeLayout?: Float32Array;
  readonly triangles: number;
}

/** Growable buffer; `toMeshData` copies into tight float32 arrays. */
export class MeshBuffer {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly colors: number[] = [];
  private readonly facade: number[] | undefined;
  private readonly facadeLayout: number[] | undefined;

  constructor(options?: { readonly facade?: boolean }) {
    this.facade = options?.facade === true ? [] : undefined;
    this.facadeLayout = options?.facade === true ? [] : undefined;
  }

  get triangles(): number {
    return this.positions.length / 9;
  }

  /** Adds one triangle; the vertex order must already be counter-clockwise seen from the normal. */
  triangle(a: Vec3, b: Vec3, c: Vec3, normal: Vec3, colour: Rgb, facade = NO_FACADES, layout: Vec3 = DEFAULT_FACADE_LAYOUT): void {
    this.positions.push(...a, ...b, ...c);
    this.normals.push(...normal, ...normal, ...normal);
    this.colors.push(...colour, ...colour, ...colour);
    this.facade?.push(...facade[0], ...facade[1], ...facade[2]);
    this.facadeLayout?.push(...layout, ...layout, ...layout);
  }

  /**
   * Adds a planar quad p0-p1-p2-p3 (in order around its edge), front side toward `facing`:
   * the winding is flipped when its normal points away from that direction.
   */
  quad(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, colour: Rgb, facing: Vec3): void {
    const normal = faceNormal(p0, p1, p2);
    if (normal[0] * facing[0] + normal[1] * facing[1] + normal[2] * facing[2] >= 0) {
      this.triangle(p0, p1, p2, normal, colour);
      this.triangle(p0, p2, p3, normal, colour);
    } else {
      const flipped: Vec3 = [-normal[0], -normal[1], -normal[2]];
      this.triangle(p0, p2, p1, flipped, colour);
      this.triangle(p0, p3, p2, flipped, colour);
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
      ...(this.facade === undefined ? {} : { facade: new Float32Array(this.facade) }),
      ...(this.facadeLayout === undefined ? {} : { facadeLayout: new Float32Array(this.facadeLayout) }),
      triangles: this.triangles,
    };
  }
}

/** Unit normal of the triangle a-b-c (counter-clockwise seen from the normal side). */
export function faceNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const length = Math.hypot(nx, ny, nz) || 1;
  return [nx / length, ny / length, nz / length];
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
    if (last?.[0] !== point[0] || last[1] !== point[1]) {
      out.push(point);
    }
  }
  const first = out[0];
  const last = out.at(-1);
  if (out.length > 1 && first !== undefined && first[0] === last?.[0] && first[1] === last[1]) {
    out.pop();
  }
  return out;
}

/** Returns the ring with the requested orientation seen from above. */
export function orient(ring: Ring, counterClockwise: boolean): Vec2[] {
  const copy = [...ring];
  return signedArea(copy) > 0 === counterClockwise ? copy : copy.reverse();
}

/** Corners that turn more than this get a vertical contour; gentle bends (curved walls) do not. */
export const CREASE_ANGLE_DEG = 30;
const CREASE_COS = Math.cos((CREASE_ANGLE_DEG * Math.PI) / 180);

/** Whether the outline turns at `b` by more than {@link CREASE_ANGLE_DEG}. */
export function isCorner(a: Vec2, b: Vec2, c: Vec2): boolean {
  const ux = b[0] - a[0];
  const uz = b[1] - a[1];
  const vx = c[0] - b[0];
  const vz = c[1] - b[1];
  const lengths = Math.hypot(ux, uz) * Math.hypot(vx, vz);
  if (lengths < 1e-12) {
    return false;
  }
  return (ux * vx + uz * vz) / lengths < CREASE_COS;
}
