import { fromLocal, type GeoPoint, type Logger, type TerrainGrid, type TerrainReader } from '@geotoon/core';
import type pg from 'pg';
import { PNG } from 'pngjs';

const TILE_SIZE = 256;
const SPACING_M = 50;
const MARGIN_M = 50;
const MERCATOR_LIMIT = 85.05112878;
const WORLD_M = 40_075_016.686;
export const TERRAIN_BASE_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';

interface Tile { readonly z: number; readonly x: number; readonly y: number }
interface StoredTile { readonly png: Buffer; readonly imagery: string }
interface Pixel { readonly x: number; readonly y: number }

/** Reject oversized rasters before decompression; preserve the exact RGB elevation encoding. */
export function decodeTerrainPng(png: Buffer): Uint8Array {
  if (png.length < 24 || png.length > 1_000_000 || png.readUInt32BE(16) !== TILE_SIZE || png.readUInt32BE(20) !== TILE_SIZE) {
    throw new Error('Invalid terrain raster dimensions');
  }
  return PNG.sync.read(png).data;
}

function pixelAt(lon: number, lat: number, z: number): Pixel {
  const world = 2 ** z * TILE_SIZE;
  const clamped = Math.max(-MERCATOR_LIMIT, Math.min(MERCATOR_LIMIT, lat)) * Math.PI / 180;
  return {
    x: (lon + 180) / 360 * world,
    y: Math.max(0, Math.min(world - 1, (1 - Math.asinh(Math.tan(clamped)) / Math.PI) / 2 * world)),
  };
}

function tileAt(x: number, y: number, z: number): Tile {
  const count = 2 ** z;
  return { z, x: ((Math.floor(x / TILE_SIZE) % count) + count) % count, y: Math.min(count - 1, Math.floor(y / TILE_SIZE)) };
}

const tileId = (tile: Tile): string => `${tile.z}/${tile.x}/${tile.y}`;

function neighbours(pixel: Pixel): Pixel[] {
  const x = Math.floor(pixel.x);
  const y = Math.floor(pixel.y);
  return [{ x, y }, { x: x + 1, y }, { x, y: y + 1 }, { x: x + 1, y: y + 1 }];
}

function elevation(pixel: Pixel, z: number, rasters: ReadonlyMap<string, Uint8Array>): number {
  const samples = neighbours(pixel).map((p) => {
    const tile = tileAt(p.x, p.y, z);
    const data = rasters.get(tileId(tile))!;
    const x = ((p.x % TILE_SIZE) + TILE_SIZE) % TILE_SIZE;
    const y = Math.min(TILE_SIZE - 1, p.y - tile.y * TILE_SIZE);
    const at = (y * TILE_SIZE + x) * 4;
    const value = data[at]! * 256 + data[at + 1]! + data[at + 2]! / 256 - 32768;
    if (data[at + 3] !== 255 || value < -11_000 || value > 9_000) {
      throw new Error('Terrain raster has missing elevations');
    }
    return value;
  });
  const u = pixel.x - Math.floor(pixel.x);
  const v = pixel.y - Math.floor(pixel.y);
  return (samples[0]! * (1 - u) + samples[1]! * u) * (1 - v)
    + (samples[2]! * (1 - u) + samples[3]! * u) * v;
}

/** Suppress small raster bumps while retaining the neighbourhood's broader relief. */
function smoothHeights(values: readonly number[], size: number): number[] {
  const clamp = (value: number): number => Math.max(0, Math.min(size - 1, value));
  return values.map((_, i) => {
    const row = Math.floor(i / size);
    const col = i % size;
    let total = 0;
    for (let dz = -2; dz <= 2; dz += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        total += values[clamp(row + dz) * size + clamp(col + dx)]!;
      }
    }
    return total / 25;
  });
}

/** SRTM terrain from Mapzen, with persistent raster caching independent of Overture tiles. */
export class PgTerrainReader implements TerrainReader {
  private readonly inflight = new Map<string, Promise<StoredTile>>();

  constructor(
    private readonly pool: pg.Pool,
    private readonly logger: Logger,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async readWithin(centre: GeoPoint, radiusM: number): Promise<TerrainGrid | undefined> {
    if (Math.abs(centre.lat) > MERCATOR_LIMIT) {
      return undefined;
    }
    try {
      return await this.readGrid(centre, radiusM);
    } catch (error) {
      this.logger.warn('terrain unavailable; using flat ground', { error: error instanceof Error ? error.message : String(error) });
      return undefined;
    }
  }

  private async readGrid(centre: GeoPoint, radiusM: number): Promise<TerrainGrid | undefined> {
    const z = Math.min(12, Math.floor(Math.log2(WORLD_M * Math.cos(centre.lat * Math.PI / 180) / (TILE_SIZE * 30))));
    const extent = Math.ceil((radiusM + MARGIN_M) / SPACING_M) * SPACING_M;
    const size = extent * 2 / SPACING_M + 1;
    const pixels = Array.from({ length: size * size }, (_, i) => {
      const [lon, lat] = fromLocal(centre, { x: -extent + (i % size) * SPACING_M, y: extent - Math.floor(i / size) * SPACING_M });
      return pixelAt(lon, lat, z);
    });
    const needed = new Map<string, Tile>();
    for (const pixel of pixels) {
      for (const p of neighbours(pixel)) {
        const tile = tileAt(p.x, p.y, z);
        needed.set(tileId(tile), tile);
      }
    }
    const rasters = new Map<string, Uint8Array>();
    const tiles = await Promise.all([...needed.values()].map(async (tile) => ({ tile, stored: await this.tile(tile) })));
    for (const { tile, stored } of tiles) {
      // Only SRTM sources are currently supported and attributed. Other DEMs retain flat maps.
      if (!stored.imagery.trim().split(/\s+/).every((source) => source.startsWith('srtm/'))) {
        return undefined;
      }
      rasters.set(tileId(tile), decodeTerrainPng(stored.png));
    }
    const absolute = smoothHeights(pixels.map((pixel) => elevation(pixel, z, rasters)), size);
    const datumM = absolute[Math.floor(size / 2) * size + Math.floor(size / 2)]!;
    return {
      originM: -extent, spacingM: SPACING_M, size, datumM: Math.round(datumM * 100) / 100,
      heights: absolute.map((value) => Math.round((value - datumM) * 100) / 100),
    };
  }

  private tile(tile: Tile): Promise<StoredTile> {
    const key = tileId(tile);
    const pending = this.inflight.get(key);
    if (pending) {
      return pending;
    }
    const read = this.loadTile(tile).finally(() => this.inflight.delete(key));
    this.inflight.set(key, read);
    return read;
  }

  private async loadTile(tile: Tile): Promise<StoredTile> {
    const params = [tile.z, tile.x, tile.y];
    const cached = await this.pool.query<StoredTile>('SELECT png, imagery FROM terrain_tile WHERE z=$1 AND x=$2 AND y=$3', params);
    if (cached.rows[0]) {
      return cached.rows[0];
    }
    const response = await this.fetchImpl(`${TERRAIN_BASE_URL}/${tileId(tile)}.png`, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) {
      throw new Error(`Terrain source answered ${response.status}`);
    }
    const png = Buffer.from(await response.arrayBuffer());
    decodeTerrainPng(png);
    const imagery = response.headers.get('x-amz-meta-x-imagery-sources') ?? '';
    await this.pool.query(
      'INSERT INTO terrain_tile (z,x,y,png,imagery) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [...params, png, imagery],
    );
    return { png, imagery };
  }
}
