import { DomainError } from './domain-error.js';

/** A WGS84 position in degrees. */
export interface GeoPoint {
  readonly lat: number;
  readonly lon: number;
}

/** A position in metres on a local tangent plane: x points east, y points north. */
export interface LocalPoint {
  readonly x: number;
  readonly y: number;
}

/** Mean earth radius (IUGG), in metres. */
export const EARTH_RADIUS_M = 6_371_008.8;
const DEG = Math.PI / 180;

export function geoPoint(lat: number, lon: number): GeoPoint {
  const valid =
    Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  if (!valid) {
    throw new DomainError('INVALID_COORDINATES', `Coordinates out of range: ${lat}, ${lon}`);
  }
  return Object.freeze({ lat, lon });
}

/** Great-circle distance (haversine), in metres. */
export function distanceMeters(a: GeoPoint, b: GeoPoint): number {
  const dLat = (b.lat - a.lat) * DEG;
  const dLon = (b.lon - a.lon) * DEG;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Equirectangular projection around `origin`. The error stays below 1 m within
 * 2 km of the origin, which is the largest area this system serves.
 */
export function toLocal(origin: GeoPoint, lon: number, lat: number): LocalPoint {
  return {
    x: (lon - origin.lon) * DEG * EARTH_RADIUS_M * Math.cos(origin.lat * DEG),
    y: (lat - origin.lat) * DEG * EARTH_RADIUS_M,
  };
}

/** Inverse of {@link toLocal}. Returns `[lon, lat]`. */
export function fromLocal(origin: GeoPoint, point: LocalPoint): [number, number] {
  const lat = origin.lat + point.y / (EARTH_RADIUS_M * DEG);
  const lon = origin.lon + point.x / (EARTH_RADIUS_M * DEG * Math.cos(origin.lat * DEG));
  return [lon, lat];
}
