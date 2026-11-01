/** Mean Earth radius in metres (IUGG), the same value the API uses. */
export const EARTH_RADIUS_M = 6_371_008.8;
const DEG = Math.PI / 180;

/**
 * Local metres around a centre (equirectangular, float64). x points east and z points
 * south, so a camera looking along -z faces north (Three.js convention).
 */
export interface Projection {
  readonly lat: number;
  readonly lon: number;
  toLocal(lon: number, lat: number): [x: number, z: number];
  toGeo(x: number, z: number): [lon: number, lat: number];
}

export function createProjection(lat: number, lon: number): Projection {
  const metresPerDegLat = EARTH_RADIUS_M * DEG;
  const metresPerDegLon = metresPerDegLat * Math.cos(lat * DEG);
  return {
    lat,
    lon,
    toLocal: (pLon, pLat) => [(pLon - lon) * metresPerDegLon, -(pLat - lat) * metresPerDegLat],
    toGeo: (x, z) => [lon + x / metresPerDegLon, lat - z / metresPerDegLat],
  };
}
