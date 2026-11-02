import type { Point2 } from './collision.js';
import type { Projection } from './projection.js';

export interface AreaTarget { readonly lat: number; readonly lon: number }
export const STREAM_RETRY_MS = 15_000;

/** Start early enough to leave over 100 seconds of ground at the 15 m/s fast speed. */
export function areaAhead(position: Point2, movement: Point2, radiusM: number, projection: Projection): AreaTarget | undefined {
  const distance = Math.hypot(position.x, position.z);
  const speed = Math.hypot(movement.x, movement.z);
  if (distance < radiusM * 0.15 || speed < 0.05 || position.x * movement.x + position.z * movement.z <= 0) {
    return undefined;
  }
  const lead = radiusM * 0.5;
  const [lon, lat] = projection.toGeo(position.x + movement.x / speed * lead, position.z + movement.z / speed * lead);
  return { lat, lon };
}

/** The next window must leave room to walk; a stale response must never teleport the player. */
export function canEnterArea(position: AreaTarget, projection: Projection, radiusM: number): boolean {
  const [x, z] = projection.toLocal(position.lon, position.lat);
  return Math.hypot(x, z) < radiusM * 0.85;
}

/** Retarget only a substantial change of direction, keeping ingestion requests bounded. */
export function shouldRetarget(current: AreaTarget, next: AreaTarget, projection: Projection, radiusM: number): boolean {
  const a = projection.toLocal(current.lon, current.lat);
  const b = projection.toLocal(next.lon, next.lat);
  return Math.hypot(a[0] - b[0], a[1] - b[1]) > radiusM * 0.8;
}
