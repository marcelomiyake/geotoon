import type { Point2 } from './collision.js';
import type { Projection } from './projection.js';

export interface AreaTarget { readonly lat: number; readonly lon: number }
export const STREAM_RETRY_MS = 15_000;
const MIN_MOVEMENT_M = 0.05;

export interface MovementSample {
  readonly anchor: Point2;
  readonly movement: Point2;
}

/** Accumulate small frame steps so direction detection also works on high-refresh displays. */
export function sampleMovement(position: Point2, previous?: MovementSample): MovementSample {
  if (previous === undefined) return { anchor: position, movement: { x: 0, z: 0 } };
  const movement = { x: position.x - previous.anchor.x, z: position.z - previous.anchor.z };
  return Math.hypot(movement.x, movement.z) > MIN_MOVEMENT_M ? { anchor: position, movement } : previous;
}

/** Start early enough to leave over 100 seconds of ground at the 15 m/s fast speed. */
export function areaAhead(position: Point2, movement: Point2, radiusM: number, projection: Projection): AreaTarget | undefined {
  const distance = Math.hypot(position.x, position.z);
  const length = Math.hypot(movement.x, movement.z);
  if (distance < radiusM * 0.15 || length < MIN_MOVEMENT_M || position.x * movement.x + position.z * movement.z <= 0) {
    return undefined;
  }
  const lead = radiusM * 0.5;
  const [lon, lat] = projection.toGeo(position.x + movement.x / length * lead, position.z + movement.z / length * lead);
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
