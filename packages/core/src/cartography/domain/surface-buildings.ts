import type { LocalPoint } from '../../shared/geo-point.js';
import type { MapLine, PolygonCoords, Position, StoredBuilding } from './features.js';
import { isInsideRing } from './geometry.js';

const ROAD_KINDS = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'service']);
type Bounds = { west: number; east: number; south: number; north: number };
type RoadPart = { points: readonly Position[]; bounds: Bounds };

/**
 * An unmeasured transportation footprint can describe an underground station, not a
 * solid above-ground building. Do not invent walls across a mapped vehicle street.
 * Measured structures and ordinary buildings remain solid, even when sources disagree.
 */
export function surfaceBuildings(buildings: readonly StoredBuilding[], lines: readonly MapLine[]): StoredBuilding[] {
  const roads = lines.filter((line) => ROAD_KINDS.has(line.kind)).flatMap((line) => line.coords
    .filter((part) => part.length >= 2).map((points) => ({ points, bounds: boundsOf(points) })));
  return buildings.filter((building) => {
    if (building.kind !== 'transportation' || (building.sourceHeightM ?? 0) > 0
      || (building.numFloors ?? 0) > 0 || (building.minHeightM ?? 0) > 0) return true;
    return !building.footprint.some((polygon) => crossedByRoad(polygon, roads));
  });
}

function boundsOf(points: readonly Position[]): Bounds {
  return points.reduce((bounds, [lon, lat]) => ({ west: Math.min(bounds.west, lon), east: Math.max(bounds.east, lon),
    south: Math.min(bounds.south, lat), north: Math.max(bounds.north, lat) }),
  { west: Number.POSITIVE_INFINITY, east: Number.NEGATIVE_INFINITY, south: Number.POSITIVE_INFINITY, north: Number.NEGATIVE_INFINITY });
}

function crossedByRoad(polygon: PolygonCoords, roads: readonly RoadPart[]): boolean {
  const bounds = boundsOf(polygon[0] ?? []);
  const rings = polygon.map((ring) => ring.map(([x, y]) => ({ x, y })));
  return roads.some((road) => road.bounds.east > bounds.west && road.bounds.west < bounds.east
    && road.bounds.north > bounds.south && road.bounds.south < bounds.north
    && road.points.slice(1).some((b, i) => crossesInterior(road.points[i]!, b, rings)));
}

function crossesInterior(a: Position, b: Position, rings: readonly (readonly LocalPoint[])[]): boolean {
  const cuts = [0, 1];
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i += 1) {
      const t = intersectionFraction(a, b, ring[i]!, ring[(i + 1) % ring.length]!);
      if (t !== undefined) cuts.push(t);
    }
  }
  cuts.sort((x, y) => x - y);
  return cuts.slice(1).some((end, i) => {
    const t = (cuts[i]! + end) / 2;
    const point = { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t };
    return isInsideRing(point, rings[0] ?? []) && !rings.slice(1).some((ring) => isInsideRing(point, ring));
  });
}

function intersectionFraction(a: Position, b: Position, p: LocalPoint, q: LocalPoint): number | undefined {
  const dx = b[0] - a[0]; const dy = b[1] - a[1];
  const ex = q.x - p.x; const ey = q.y - p.y;
  const cross = dx * ey - dy * ex;
  if (Math.abs(cross) < 1e-18) return undefined;
  const t = ((p.x - a[0]) * ey - (p.y - a[1]) * ex) / cross;
  const u = ((p.x - a[0]) * dy - (p.y - a[1]) * dx) / cross;
  return t > 0 && t < 1 && u >= 0 && u <= 1 ? t : undefined;
}
