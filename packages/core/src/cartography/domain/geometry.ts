import { fromLocal, toLocal, type GeoPoint, type LocalPoint } from '../../shared/geo-point.js';
import type { LineCoords, MultiPolygonCoords, PolygonCoords, Position } from './features.js';

/** Signed shoelace area of a ring in local metres (positive when anticlockwise). */
export function signedRingArea(ring: readonly LocalPoint[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    if (a && b) {
      sum += a.x * b.y - b.x * a.y;
    }
  }
  return sum / 2;
}

/** Area of a polygon (outer ring minus holes), in square metres. */
export function polygonAreaM2(polygon: PolygonCoords): number {
  const first = polygon[0]?.[0];
  if (!first) {
    return 0;
  }
  const origin: GeoPoint = { lon: first[0], lat: first[1] };
  let area = 0;
  polygon.forEach((ring, index) => {
    const ringArea = Math.abs(signedRingArea(ring.map(([lon, lat]) => toLocal(origin, lon, lat))));
    area += index === 0 ? ringArea : -ringArea;
  });
  return Math.max(0, area);
}

export function multiPolygonAreaM2(multi: MultiPolygonCoords): number {
  return multi.reduce((sum, polygon) => sum + polygonAreaM2(polygon), 0);
}

/** Closest point to `p` on the segment from `a` to `b`. */
export function nearestOnSegment(p: LocalPoint, a: LocalPoint, b: LocalPoint): LocalPoint {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return a;
  }
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

/** Even-odd point-in-ring test. */
export function isInsideRing(p: LocalPoint, ring: readonly LocalPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a && b && a.y > p.y !== b.y > p.y) {
      const crossX = ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
      if (p.x < crossX) {
        inside = !inside;
      }
    }
  }
  return inside;
}

/** Points every `spacingM` metres along a line, starting at its first vertex. */
export function sampleLine(line: LineCoords, spacingM: number): Position[] {
  const first = line[0];
  if (!first || spacingM <= 0) {
    return [];
  }
  const origin: GeoPoint = { lon: first[0], lat: first[1] };
  const local = line.map(([lon, lat]) => toLocal(origin, lon, lat));
  const samples: Position[] = [first];
  let carried = 0;
  for (let i = 1; i < local.length; i++) {
    const a = local[i - 1];
    const b = local[i];
    if (!a || !b) {
      continue;
    }
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    let distance = spacingM - carried;
    while (distance <= length) {
      const t = distance / length;
      samples.push(fromLocal(origin, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) }));
      distance += spacingM;
    }
    carried = length - (distance - spacingM);
  }
  return samples;
}
