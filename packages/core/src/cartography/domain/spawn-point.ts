import { fromLocal, toLocal, type GeoPoint, type LocalPoint } from '../../shared/geo-point.js';
import { WALKABLE_LINE_KINDS, type MapLine, type Position, type StoredBuilding } from './features.js';
import { isInsideRing, nearestOnSegment } from './geometry.js';

/** How far from the address a street may be and still be used as the spawn point. */
export const SPAWN_MAX_STREET_DISTANCE_M = 150;
const STEP_OUTSIDE_M = 2;
const ORIGIN: LocalPoint = { x: 0, y: 0 };
type LocalPolygon = readonly (readonly LocalPoint[])[];

export interface Spawn {
  readonly position: Position;
  readonly headingDeg: number;
}

/**
 * Where the walker starts: the nearest point on a walkable street within 150 m of the
 * address; otherwise 2 m outside the building that contains the address; otherwise the
 * address itself. The heading faces the address (0 = north, clockwise).
 */
export function chooseSpawn(
  address: GeoPoint,
  lines: readonly MapLine[],
  buildings: readonly StoredBuilding[],
): Spawn {
  const project = (p: Position): LocalPoint => toLocal(address, p[0], p[1]);
  const blockers = blockingFootprints(buildings, project);
  const spawn =
    nearestStreetPoint(lines, project, blockers) ?? stepOutOfBuilding(buildings, project) ?? ORIGIN;
  const headingDeg = (Math.atan2(-spawn.x, -spawn.y) * 180) / Math.PI;
  return {
    position: fromLocal(address, spawn),
    headingDeg: Math.round(((headingDeg + 360) % 360) * 10) / 10,
  };
}

function nearestStreetPoint(
  lines: readonly MapLine[],
  project: (p: Position) => LocalPoint,
  blockers: readonly LocalPolygon[],
): LocalPoint | undefined {
  let best: LocalPoint | undefined;
  let bestDistance = SPAWN_MAX_STREET_DISTANCE_M;
  for (const line of lines) {
    if (!WALKABLE_LINE_KINDS.has(line.kind)) {
      continue;
    }
    for (const part of line.coords) {
      for (const candidate of streetCandidates(part, project, blockers)) {
        const distance = Math.hypot(candidate.x, candidate.y);
        if (distance <= bestDistance) {
          best = candidate;
          bestDistance = distance;
        }
      }
    }
  }
  return best;
}

function streetCandidates(
  part: readonly Position[], project: (p: Position) => LocalPoint, blockers: readonly LocalPolygon[],
): LocalPoint[] {
  const points = part.map(project);
  return points.slice(1).flatMap((q, i) => {
    const p = points[i] ?? ORIGIN;
    return [nearestOnSegment(ORIGIN, p, q), p, q];
  }).filter((p) => Math.hypot(p.x, p.y) <= SPAWN_MAX_STREET_DISTANCE_M && !insideBuilding(p, blockers));
}

function insideBuilding(point: LocalPoint, polygons: readonly LocalPolygon[]): boolean {
  return polygons.some((rings) => isInsideRing(point, rings[0] ?? [])
    && !rings.slice(1).some((ring) => isInsideRing(point, ring)));
}

/** Only nearby ground-level footprints can block a street candidate. Courtyards stay clear. */
function blockingFootprints(buildings: readonly StoredBuilding[], project: (p: Position) => LocalPoint): LocalPolygon[] {
  const polygons = buildings.filter((building) => (building.minHeightM ?? 0) < 2)
    .flatMap((building) => building.footprint.map((polygon) => polygon.map((ring) => ring.map(project))));
  return polygons.filter((rings) => {
    const outer = rings[0] ?? [];
    return outer.some((p) => p.x <= SPAWN_MAX_STREET_DISTANCE_M)
      && outer.some((p) => p.x >= -SPAWN_MAX_STREET_DISTANCE_M)
      && outer.some((p) => p.y <= SPAWN_MAX_STREET_DISTANCE_M)
      && outer.some((p) => p.y >= -SPAWN_MAX_STREET_DISTANCE_M);
  });
}

function stepOutOfBuilding(
  buildings: readonly StoredBuilding[],
  project: (p: Position) => LocalPoint,
): LocalPoint | undefined {
  for (const building of buildings) {
    for (const polygon of building.footprint) {
      const outer = (polygon[0] ?? []).map(project);
      if (outer.length >= 3 && isInsideRing(ORIGIN, outer)) {
        return pushOutside(outer);
      }
    }
  }
  return undefined;
}

function pushOutside(ring: readonly LocalPoint[]): LocalPoint {
  let edgePoint: LocalPoint = ring[0] ?? ORIGIN;
  let edgeDistance = Number.POSITIVE_INFINITY;
  for (let i = 1; i < ring.length; i++) {
    const candidate = nearestOnSegment(ORIGIN, ring[i - 1] ?? ORIGIN, ring[i] ?? ORIGIN);
    const distance = Math.hypot(candidate.x, candidate.y);
    if (distance < edgeDistance) {
      edgePoint = candidate;
      edgeDistance = distance;
    }
  }
  const length = Math.max(edgeDistance, 1e-6);
  return {
    x: edgePoint.x + (edgePoint.x / length) * STEP_OUTSIDE_M,
    y: edgePoint.y + (edgePoint.y / length) * STEP_OUTSIDE_M,
  };
}
