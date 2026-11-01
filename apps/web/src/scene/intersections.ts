import type { SceneLine } from '@geotoon/contracts';
import type { Vec2 } from './mesh-buffer.js';
import type { Projection } from './projection.js';
import { hasSidewalks } from './street.js';

const SNAP_M = 0.75;
const SAME_DIRECTION_COS = Math.cos(Math.PI / 12);
export const MAX_INTERSECTIONS = 128;

export interface StreetArm {
  readonly name: string;
  readonly kind: string;
  readonly widthM: number;
  /** Unit direction pointing away from the intersection. */
  readonly direction: Vec2;
  readonly lengthM: number;
}

export interface Intersection {
  readonly x: number;
  readonly z: number;
  readonly arms: readonly StreetArm[];
}

/**
 * Connected street vertices, not arbitrary geometric crossings (which may be bridges).
 * Overture splits roads at junctions. A bend or a split with one name is not a junction.
 */
export function buildIntersections(lines: readonly SceneLine[], projection: Projection, radiusM: number): Intersection[] {
  const cells = new Map<string, MutableIntersection[]>();
  const nodes: MutableIntersection[] = [];
  const streets = lines.filter((line) => hasSidewalks(line.kind)).toSorted((a, b) => a.id.localeCompare(b.id));
  for (const street of streets) {
    for (const part of street.coords) {
      const points = part.map(([lon, lat]) => projection.toLocal(lon, lat));
      points.forEach((point, index) => {
        if (Math.hypot(...point) > radiusM) {
          return;
        }
        const arms = [-1, 1].flatMap((step) => {
          const arm = streetArm(street, points, index, step);
          return arm === undefined ? [] : [arm];
        });
        if (arms.length > 0) {
          const node = nodeAt(point, cells, nodes);
          node.arms.push(...arms);
        }
      });
    }
  }
  return nodes.map((node) => ({ ...node, arms: mergeArms(node.arms) }))
    .filter((node) => new Set(node.arms.map((arm) => arm.name).filter(Boolean)).size >= 2
      && node.arms.some((a) => node.arms.some((b) => Math.abs(dot(a.direction, b.direction)) < 0.9)))
    .sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z) || a.x - b.x || a.z - b.z)
    .slice(0, MAX_INTERSECTIONS);
}

type MutableIntersection = { x: number; z: number; arms: StreetArm[] };

function nodeAt(point: Vec2, cells: Map<string, MutableIntersection[]>, nodes: MutableIntersection[]): MutableIntersection {
  const cx = Math.floor(point[0] / SNAP_M);
  const cz = Math.floor(point[1] / SNAP_M);
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dz = -1; dz <= 1; dz += 1) {
      const found = cells.get(`${cx + dx}:${cz + dz}`)?.find((node) => Math.hypot(node.x - point[0], node.z - point[1]) <= SNAP_M);
      if (found !== undefined) {
        return found;
      }
    }
  }
  const node: MutableIntersection = { x: point[0], z: point[1], arms: [] };
  const key = `${cx}:${cz}`;
  const cell = cells.get(key) ?? [];
  cell.push(node);
  cells.set(key, cell);
  nodes.push(node);
  return node;
}

function streetArm(street: SceneLine, points: readonly Vec2[], index: number, step: number): StreetArm | undefined {
  const origin = points[index]!;
  let direction: Vec2 | undefined;
  let lengthM = 0;
  let previous = origin;
  for (let i = index + step; points[i] !== undefined && lengthM < 40; i += step) {
    const point = points[i]!;
    const length = Math.hypot(point[0] - previous[0], point[1] - previous[1]);
    const reach = Math.hypot(point[0] - origin[0], point[1] - origin[1]);
    if (direction === undefined && reach > 0.1) {
      direction = [(point[0] - origin[0]) / reach, (point[1] - origin[1]) / reach];
    }
    lengthM += length;
    previous = point;
  }
  return direction === undefined ? undefined : {
    name: street.name?.trim() ?? '', kind: street.kind, widthM: street.widthM, direction, lengthM,
  };
}

function mergeArms(arms: readonly StreetArm[]): StreetArm[] {
  const out: StreetArm[] = [];
  for (const arm of arms.toSorted((a, b) => b.widthM - a.widthM || a.name.localeCompare(b.name))) {
    if (!out.some((other) => dot(arm.direction, other.direction) > SAME_DIRECTION_COS)) {
      out.push(arm);
    }
  }
  return out.sort((a, b) => Math.atan2(a.direction[1], a.direction[0]) - Math.atan2(b.direction[1], b.direction[0]));
}

export function dot(a: Vec2, b: Vec2): number {
  return a[0] * b[0] + a[1] * b[1];
}
