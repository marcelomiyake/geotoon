import type { SceneBuilding, SceneLine } from '@geotoon/contracts';
import { CollisionIndex, closestOnSegment, type Point2 } from './collision.js';
import { dot, type Intersection, type StreetArm } from './intersections.js';
import type { Vec2 } from './mesh-buffer.js';
import { PointSpacing } from './point-spacing.js';
import type { Projection } from './projection.js';
import { SIDEWALK_WIDTH_M, hasSidewalks } from './street.js';
import type { TrafficApproach } from './traffic.js';

export const ROAD_SIGN_KINDS = ['stop', 'yield', 'pedestrian-crossing', 'signals-ahead',
  'curve-left', 'curve-right', 'crossroads', 't-junction', 'junction-left', 'junction-right',
  'y-junction', 'school', 'hospital'] as const;
export type RoadSignKind = (typeof ROAD_SIGN_KINDS)[number];
export const ROAD_SIGN_SIZE_M = 0.9;
export const ROAD_SIGN_CENTRE_Y_M = 2.5;
export const ROAD_SIGN_CHUNK_M = 250;

export interface RoadSign extends Point2 {
  readonly kind: RoadSignKind;
  /** Front normal points towards approaching drivers, x towards z. */
  readonly angle: number;
}

interface RoadSignContext {
  readonly intersections: readonly Intersection[];
  readonly approaches: readonly TrafficApproach[];
  readonly lines: readonly SceneLine[];
  readonly buildings: readonly SceneBuilding[];
  readonly projection: Projection;
  readonly radiusM: number;
  readonly collision: CollisionIndex;
  readonly occupied: readonly Point2[];
}

const PRIORITY: Readonly<Record<string, number>> = {
  primary: 1, secondary: 2, tertiary: 3, unclassified: 4, residential: 5, living_street: 6,
};
type StreetPart = { points: readonly Vec2[]; widthM: number };
type RoadPosition = { point: Point2; direction: Vec2 };

/** Illustrative signs selected from actual street geometry, crossings and building kinds. */
export function buildRoadSigns(context: RoadSignContext): RoadSign[] {
  const placement = new SignPlacement(context.radiusM, context.collision, context.occupied);
  const controlled = new Set(context.approaches.filter((approach) => approach.light !== undefined)
    .map((approach) => approach.intersection));
  const schools = buildingPoints(context.buildings, 'school', context.projection);
  for (const approach of context.approaches) {
    const { intersection, arm } = approach;
    if (controlled.has(intersection)) {
      placeOnApproach(placement, 'signals-ahead', arm, 30);
    } else {
      const priority = prioritySign(intersection, arm);
      if (priority !== undefined) {
        placeOnApproach(placement, priority, arm, 11);
      }
      if ((PRIORITY[arm.kind] ?? 5) <= 3) {
        placeOnApproach(placement, junctionSign(intersection, arm), arm, 30);
      }
    }
    const school = schools.some((point) => Math.hypot(point.x - approach.crossing.x, point.z - approach.crossing.z) < 80);
    placeOnApproach(placement, school ? 'school' : 'pedestrian-crossing', arm, 20);
  }
  const streets: StreetPart[] = context.lines.filter((line) => hasSidewalks(line.kind))
    .toSorted((a, b) => a.id.localeCompare(b.id)).flatMap((line) => line.coords.map((part) => ({
      points: part.map(([lon, lat]) => context.projection.toLocal(lon, lat)), widthM: line.widthM,
    })));
  addCurveSigns(streets, context.intersections, placement);
  for (const hospital of buildingPoints(context.buildings, 'hospital', context.projection)) {
    addHospitalSigns(hospital, streets, placement);
  }
  return placement.signs;
}

/** Six metres between posts; existing name signs and signal poles reserve their own space. */
class SignPlacement {
  readonly signs: RoadSign[] = [];
  private readonly spacing = new PointSpacing(6);

  constructor(private readonly radiusM: number, private readonly collision: CollisionIndex, occupied: readonly Point2[]) {
    occupied.forEach((point) => this.spacing.add(point));
  }

  place(kind: RoadSignKind, road: RoadPosition, widthM: number): void {
    const [ux, uz] = road.direction;
    const offset = widthM / 2 + SIDEWALK_WIDTH_M / 2;
    const point = { x: road.point.x + uz * offset, z: road.point.z - ux * offset };
    if (Math.hypot(point.x, point.z) + ROAD_SIGN_SIZE_M > this.radiusM || !this.spacing.isClear(point)) {
      return;
    }
    const reached = this.collision.move(road.point, point, 0.5);
    if (Math.hypot(reached.x - point.x, reached.z - point.z) > 0.01) {
      return;
    }
    this.signs.push({ ...point, kind, angle: Math.atan2(uz, ux) });
    this.spacing.add(point);
  }
}

function placeOnApproach(placement: SignPlacement, kind: RoadSignKind, arm: StreetArm, distanceM: number): void {
  if (arm.lengthM < distanceM + 4) {
    return;
  }
  const road = sampleAlong(arm.path, 0, 1, distanceM);
  if (road !== undefined) {
    placement.place(kind, road, arm.widthM);
  }
}

function prioritySign(node: Intersection, arm: StreetArm): 'stop' | 'yield' | undefined {
  const main = node.arms.toSorted((a, b) => (PRIORITY[a.kind] ?? 5) - (PRIORITY[b.kind] ?? 5)
    || Number(hasOpposite(node, b)) - Number(hasOpposite(node, a)) || b.widthM - a.widthM)[0]!;
  if (Math.abs(dot(main.direction, arm.direction)) > 0.7) {
    return undefined;
  }
  const gap = (PRIORITY[arm.kind] ?? 5) - (PRIORITY[main.kind] ?? 5);
  if (gap > 0 || main.widthM - arm.widthM >= 2) {
    return gap >= 2 ? 'stop' : 'yield';
  }
  const through = node.arms.some((a) => node.arms.some((b) => dot(a.direction, b.direction) < -0.9));
  const ending = !hasOpposite(node, arm);
  return node.arms.length === 3 && through && ending ? 'stop' : undefined;
}

function junctionSign(node: Intersection, arm: StreetArm): RoadSignKind {
  if (node.arms.length >= 4) {
    return 'crossroads';
  }
  const through = node.arms.some((a) => node.arms.some((b) => dot(a.direction, b.direction) < -0.9));
  if (!through) {
    return 'y-junction';
  }
  if (!hasOpposite(node, arm)) {
    return 't-junction';
  }
  const branch = node.arms.filter((other) => other !== arm)
    .toSorted((a, b) => Math.abs(dot(arm.direction, a.direction)) - Math.abs(dot(arm.direction, b.direction)))[0]!;
  return -arm.direction[0] * branch.direction[1] + arm.direction[1] * branch.direction[0] > 0
    ? 'junction-right' : 'junction-left';
}

function hasOpposite(node: Intersection, arm: StreetArm): boolean {
  return node.arms.some((other) => dot(arm.direction, other.direction) < -0.9);
}

/** Walk the connected polyline, keeping sign positions and facing correct through bends. */
function sampleAlong(points: readonly Vec2[], index: number, step: number, distanceM: number): RoadPosition | undefined {
  let remaining = distanceM;
  let previous = points[index];
  if (previous === undefined) {
    return undefined;
  }
  for (let i = index + step; points[i] !== undefined; i += step) {
    const next = points[i]!;
    const dx = next[0] - previous[0];
    const dz = next[1] - previous[1];
    const length = Math.hypot(dx, dz);
    if (length > 0.001 && length >= remaining) {
      return { point: { x: previous[0] + dx * remaining / length, z: previous[1] + dz * remaining / length },
        direction: [dx / length, dz / length] };
    }
    remaining -= length;
    previous = next;
  }
  return undefined;
}

function addCurveSigns(streets: readonly StreetPart[], intersections: readonly Intersection[], placement: SignPlacement): void {
  const junctions = new PointSpacing(35);
  intersections.forEach((node) => junctions.add(node));
  const bends = new PointSpacing(45);
  for (const street of streets) {
    for (let i = 1; i + 1 < street.points.length; i += 1) {
      const [x, z] = street.points[i]!;
      if (!junctions.isClear({ x, z }) || !bends.isClear({ x, z })) {
        continue;
      }
      const curve = curveAt(street.points, i);
      if (curve === undefined) {
        continue;
      }
      placement.place(curve.right ? 'curve-right' : 'curve-left', curve.before, street.widthM);
      placement.place(curve.right ? 'curve-left' : 'curve-right', curve.after, street.widthM);
      bends.add({ x, z });
    }
  }
}

function curveAt(points: readonly Vec2[], index: number) {
  const before = sampleAlong(points, index, -1, 30);
  const after = sampleAlong(points, index, 1, 30);
  if (before === undefined || after === undefined) return undefined;
  const cosine = -dot(before.direction, after.direction);
  if (cosine > Math.cos(Math.PI / 7) || cosine < Math.cos(Math.PI * 0.65)) return undefined;
  const turn = -before.direction[0] * after.direction[1] + before.direction[1] * after.direction[0];
  return { before, after, right: turn > 0 };
}

function buildingPoints(buildings: readonly SceneBuilding[], kind: string, projection: Projection): Point2[] {
  return buildings.filter((building) => building.kind === kind).toSorted((a, b) => a.id.localeCompare(b.id))
    .flatMap((building) => {
      const ring = building.footprint[0]?.[0];
      if (ring === undefined || ring.length === 0) {
        return [];
      }
      const points = ring.map(([lon, lat]) => projection.toLocal(lon, lat));
      const xs = points.map((point) => point[0]);
      const zs = points.map((point) => point[1]);
      return [{ x: (Math.min(...xs) + Math.max(...xs)) / 2, z: (Math.min(...zs) + Math.max(...zs)) / 2 }];
    });
}

function addHospitalSigns(hospital: Point2, streets: readonly StreetPart[], placement: SignPlacement): void {
  let nearest: { road: RoadPosition; widthM: number; distance: number } | undefined;
  for (const street of streets) {
    for (let i = 1; i < street.points.length; i += 1) {
      const a = street.points[i - 1]!;
      const b = street.points[i]!;
      const [x, z] = closestOnSegment(hospital.x, hospital.z, a[0], a[1], b[0], b[1]);
      const distance = Math.hypot(x - hospital.x, z - hospital.z);
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (length > 1 && distance < 60 && (nearest === undefined || distance < nearest.distance)) {
        nearest = { road: { point: { x, z }, direction: [(b[0] - a[0]) / length, (b[1] - a[1]) / length] },
          widthM: street.widthM, distance };
      }
    }
  }
  if (nearest !== undefined) {
    placement.place('hospital', nearest.road, nearest.widthM);
    placement.place('hospital', { ...nearest.road,
      direction: [-nearest.road.direction[0], -nearest.road.direction[1]] }, nearest.widthM);
  }
}

/** Normalised outlines shared by the artwork and the metal backing geometry. */
export function roadSignOutline(kind: RoadSignKind): readonly Vec2[] {
  if (kind === 'stop') {
    return [[0.3, 0], [0.7, 0], [1, 0.3], [1, 0.7], [0.7, 1], [0.3, 1], [0, 0.7], [0, 0.3]];
  }
  if (kind === 'yield') {
    return [[0, 0.04], [1, 0.04], [0.5, 1]];
  }
  return kind === 'hospital' ? [[0.1, 0], [0.9, 0], [0.9, 1], [0.1, 1]]
    : [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]];
}
