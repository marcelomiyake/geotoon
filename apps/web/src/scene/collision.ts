export interface Point2 {
  readonly x: number;
  readonly z: number;
}

export const WALKER_RADIUS_M = 0.3;
/**
 * Longest move resolved at once. Walls are zero-thickness edges, so a move longer than the
 * walker's diameter could jump over one; `move` splits longer moves into steps this short.
 */
export const MAX_SUBSTEP_M = 0.25;
const PUSH_EPSILON = 1e-3;
const ITERATIONS = 3;

type Edge = readonly [ax: number, az: number, bx: number, bz: number];

/** Building footprint edges in a uniform grid, for walking collisions. */
export class CollisionIndex {
  private readonly cells = new Map<string, Edge[]>();
  private edgeCount = 0;

  constructor(readonly cellSize = 20) {}

  get size(): number {
    return this.edgeCount;
  }

  /** Transfer each wall once when scene geometry is built in a worker. */
  toSegments(): Float64Array {
    const edges = new Set<Edge>();
    for (const cell of this.cells.values()) cell.forEach((edge) => edges.add(edge));
    return new Float64Array([...edges].flat());
  }

  static fromSegments(segments: Float64Array): CollisionIndex {
    const collision = new CollisionIndex();
    for (let i = 0; i < segments.length; i += 4) {
      collision.addEdge(segments[i]!, segments[i + 1]!, segments[i + 2]!, segments[i + 3]!);
    }
    return collision;
  }

  addEdge(ax: number, az: number, bx: number, bz: number): void {
    const edge: Edge = [ax, az, bx, bz];
    this.edgeCount += 1;
    const [x0, x1] = [Math.min(ax, bx), Math.max(ax, bx)].map((v) => Math.floor(v / this.cellSize));
    const [z0, z1] = [Math.min(az, bz), Math.max(az, bz)].map((v) => Math.floor(v / this.cellSize));
    for (let cx = x0!; cx <= x1!; cx += 1) {
      for (let cz = z0!; cz <= z1!; cz += 1) {
        const key = `${cx}:${cz}`;
        const list = this.cells.get(key);
        if (list) {
          list.push(edge);
        } else {
          this.cells.set(key, [edge]);
        }
      }
    }
  }

  /** Edges whose cells overlap the square of half-size `reach` around a point. */
  private near(p: Point2, reach: number): Set<Edge> {
    const found = new Set<Edge>();
    const x0 = Math.floor((p.x - reach) / this.cellSize);
    const x1 = Math.floor((p.x + reach) / this.cellSize);
    const z0 = Math.floor((p.z - reach) / this.cellSize);
    const z1 = Math.floor((p.z + reach) / this.cellSize);
    for (let cx = x0; cx <= x1; cx += 1) {
      for (let cz = z0; cz <= z1; cz += 1) {
        for (const edge of this.cells.get(`${cx}:${cz}`) ?? []) {
          found.add(edge);
        }
      }
    }
    return found;
  }

  /**
   * Moves a circle of `radius` from `from` to `to` in steps of at most `MAX_SUBSTEP_M`
   * (or `radius`, if smaller), resolving walls after each step, so fast moves cannot pass
   * through a wall.
   */
  move(from: Point2, to: Point2, radius = WALKER_RADIUS_M): Point2 {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / Math.min(MAX_SUBSTEP_M, radius)));
    let position = from;
    for (let step = 0; step < steps; step += 1) {
      position = this.resolve(position, { x: position.x + dx / steps, z: position.z + dz / steps }, radius);
    }
    return position;
  }

  /**
   * Moves a circle of `radius` from `from` towards `to` and pushes it out of any wall it
   * overlaps, which slides it along walls. `from` decides the side when exactly on a wall.
   */
  resolve(from: Point2, to: Point2, radius = WALKER_RADIUS_M): Point2 {
    let x = to.x;
    let z = to.z;
    for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
      let moved = false;
      for (const [ax, az, bx, bz] of this.near({ x, z }, radius)) {
        const [cx, cz] = closestOnSegment(x, z, ax, az, bx, bz);
        let dx = x - cx;
        let dz = z - cz;
        let distance = Math.hypot(dx, dz);
        if (distance >= radius) {
          continue;
        }
        if (distance < 1e-9) {
          // Exactly on the wall: push back towards the side we came from.
          dx = from.x - cx;
          dz = from.z - cz;
          distance = Math.hypot(dx, dz) || 1;
        }
        const push = radius - Math.hypot(x - cx, z - cz) + PUSH_EPSILON;
        x += (dx / distance) * push;
        z += (dz / distance) * push;
        moved = true;
      }
      if (!moved) {
        break;
      }
    }
    return { x, z };
  }
}

export function closestOnSegment(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): [number, number] {
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSq = dx * dx + dz * dz;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lengthSq));
  return [ax + t * dx, az + t * dz];
}

/** Keeps a point at least `margin` metres inside a circle around the origin. */
export function clampToRadius(p: Point2, radius: number, margin: number): { point: Point2; clamped: boolean } {
  const limit = Math.max(0, radius - margin);
  const distance = Math.hypot(p.x, p.z);
  if (distance <= limit) {
    return { point: p, clamped: false };
  }
  return { point: { x: (p.x / distance) * limit, z: (p.z / distance) * limit }, clamped: true };
}
