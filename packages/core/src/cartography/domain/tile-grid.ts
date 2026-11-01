import { EARTH_RADIUS_M, toLocal, type GeoPoint } from '../../shared/geo-point.js';

/** Zoom of the coverage grid. Fixed in code: changing it would orphan every stored tile. */
export const TILE_ZOOM = 16;
const TILES_PER_AXIS = 2 ** TILE_ZOOM;
const MAX_MERCATOR_LAT = 85.05112878;
const DEG = Math.PI / 180;

/** A slippy-map tile at {@link TILE_ZOOM}. */
export interface TileKey {
  readonly x: number;
  readonly y: number;
}

export interface Bounds {
  readonly south: number;
  readonly west: number;
  readonly north: number;
  readonly east: number;
}

export function tileOf(point: GeoPoint): TileKey {
  const lat = Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, point.lat));
  const x = Math.floor(((point.lon + 180) / 360) * TILES_PER_AXIS);
  const y = Math.floor(((1 - Math.asinh(Math.tan(lat * DEG)) / Math.PI) / 2) * TILES_PER_AXIS);
  return { x: clampIndex(x), y: clampIndex(y) };
}

export function boundsOf(tile: TileKey): Bounds {
  return {
    west: (tile.x / TILES_PER_AXIS) * 360 - 180,
    east: ((tile.x + 1) / TILES_PER_AXIS) * 360 - 180,
    north: latitudeOfRow(tile.y),
    south: latitudeOfRow(tile.y + 1),
  };
}

export function tileId(tile: TileKey): string {
  return `${TILE_ZOOM}/${tile.x}/${tile.y}`;
}

export function compareTiles(a: TileKey, b: TileKey): number {
  return a.x - b.x || a.y - b.y;
}

/**
 * Tiles whose bounds come within `radiusM` of `centre`, sorted by (x, y).
 * Corner tiles of the bounding square that the circle does not reach are left out.
 */
export function tilesCovering(centre: GeoPoint, radiusM: number): TileKey[] {
  const dLat = radiusM / (EARTH_RADIUS_M * DEG);
  const dLon = dLat / Math.cos(centre.lat * DEG);
  const northWest = tileOf({ lat: centre.lat + dLat, lon: centre.lon - dLon });
  const southEast = tileOf({ lat: centre.lat - dLat, lon: centre.lon + dLon });
  const tiles: TileKey[] = [];
  for (let x = northWest.x; x <= southEast.x; x++) {
    for (let y = northWest.y; y <= southEast.y; y++) {
      const tile = { x, y };
      if (distanceToBounds(centre, boundsOf(tile)) <= radiusM) {
        tiles.push(tile);
      }
    }
  }
  return tiles;
}

/** Smallest bounds containing every tile. Throws on an empty list. */
export function boundsOfTiles(tiles: readonly TileKey[]): Bounds {
  if (tiles.length === 0) {
    throw new RangeError('boundsOfTiles needs at least one tile');
  }
  const all = tiles.map(boundsOf);
  return {
    south: Math.min(...all.map((b) => b.south)),
    west: Math.min(...all.map((b) => b.west)),
    north: Math.max(...all.map((b) => b.north)),
    east: Math.max(...all.map((b) => b.east)),
  };
}

function distanceToBounds(centre: GeoPoint, bounds: Bounds): number {
  const lon = Math.max(bounds.west, Math.min(bounds.east, centre.lon));
  const lat = Math.max(bounds.south, Math.min(bounds.north, centre.lat));
  const local = toLocal(centre, lon, lat);
  return Math.hypot(local.x, local.y);
}

function latitudeOfRow(y: number): number {
  return Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / TILES_PER_AXIS))) / DEG;
}

function clampIndex(index: number): number {
  return Math.max(0, Math.min(TILES_PER_AXIS - 1, index));
}
