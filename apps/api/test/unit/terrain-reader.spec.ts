import { readFileSync } from 'node:fs';
import path from 'node:path';
import type pg from 'pg';
import { PNG } from 'pngjs';
import { describe, expect, it, vi } from 'vitest';
import { PgTerrainReader, decodeTerrainPng } from '../../src/adapters/postgres/terrain-reader.js';
import { FIXTURES } from '../support.js';

const RECORDED = readFileSync(path.join(FIXTURES, 'terrain/srtm-12-1517-2323.png'));
const CENTRE = { lat: -23.561496, lon: -46.655968 };

function setup(respond: () => Promise<Response> = () => Promise.resolve(new Response(Uint8Array.from(RECORDED), {
  headers: { 'x-amz-meta-x-imagery-sources': 'srtm/S24W047.tif' },
}))) {
  const query = vi.fn().mockResolvedValue({ rows: [] });
  const fetch = vi.fn<typeof globalThis.fetch>(respond);
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { query, fetch, logger, reader: new PgTerrainReader({ query } as unknown as pg.Pool, logger, fetch) };
}

describe('SRTM terrain adapter', () => {
  it('decodes a recorded Terrarium raster without colour conversion', () => {
    const data = decodeTerrainPng(RECORDED);
    expect(data).toHaveLength(256 * 256 * 4);
    expect([...data.slice(0, 4)]).toEqual([130, 255, 0, 255]);
  });

  it('samples a relative grid with a datum at the address and deduplicates concurrent requests', async () => {
    const { reader, fetch, query } = setup();
    const [grid, concurrent] = await Promise.all([reader.readWithin(CENTRE, 100), reader.readWithin(CENTRE, 100)]);
    expect(concurrent).toEqual(grid);
    expect(grid).toMatchObject({ originM: -150, spacingM: 50, size: 7 });
    expect(grid!.datumM).toBeGreaterThan(700);
    expect(grid!.heights).toHaveLength(49);
    expect(grid!.heights[24]).toBe(0);
    expect(new Set(grid!.heights).size).toBeGreaterThan(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(query.mock.calls.some(([sql]) => String(sql).startsWith('INSERT INTO terrain_tile'))).toBe(true);
    const options = fetch.mock.calls[0]![1];
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });

  it('reads persisted tiles without network access', async () => {
    const { reader, query, fetch } = setup();
    query.mockResolvedValue({ rows: [{ png: RECORDED, imagery: 'srtm/S24W047.tif' }] });
    expect(await reader.readWithin(CENTRE, 100)).toBeDefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('attenuates a small elevation spike without exaggerating the landscape', async () => {
    const raster = new PNG({ width: 256, height: 256 });
    const x = Math.floor((CENTRE.lon + 180) / 360 * 4096 * 256) % 256;
    const lat = CENTRE.lat * Math.PI / 180;
    const y = Math.floor((1 - Math.asinh(Math.tan(lat)) / Math.PI) / 2 * 4096 * 256) % 256;
    for (let row = 0; row < 256; row += 1) {
      for (let col = 0; col < 256; col += 1) {
        const at = (row * 256 + col) * 4;
        const metres = Math.abs(row - y) <= 2 && Math.abs(col - x) <= 2 ? 900 : 800;
        raster.data[at] = Math.floor((metres + 32768) / 256);
        raster.data[at + 1] = (metres + 32768) % 256;
        raster.data[at + 3] = 255;
      }
    }
    const png = PNG.sync.write(raster);
    const { reader } = setup(() => Promise.resolve(new Response(Uint8Array.from(png), {
      headers: { 'x-amz-meta-x-imagery-sources': 'srtm/test.tif' },
    })));
    const grid = await reader.readWithin(CENTRE, 500);
    expect(grid!.datumM).toBeGreaterThan(800);
    expect(grid!.datumM).toBeLessThan(860);
    expect(Math.max(...grid!.heights) - Math.min(...grid!.heights)).toBeLessThan(60);
  });

  it('uses a flat fallback beyond Mercator coverage or for uncredited DEM sources', async () => {
    const { reader, query, fetch } = setup();
    expect(await reader.readWithin({ lat: 89, lon: 0 }, 100)).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
    query.mockResolvedValue({ rows: [{ png: RECORDED, imagery: 'ned/somewhere.tif' }] });
    expect(await reader.readWithin(CENTRE, 100)).toBeUndefined();
    query.mockResolvedValue({ rows: [{ png: RECORDED, imagery: '' }] });
    expect(await reader.readWithin(CENTRE, 100)).toBeUndefined();
  });

  it.each([
    ['source error', () => Promise.resolve(new Response('', { status: 503 }))],
    ['timeout', () => Promise.reject(new DOMException('timeout', 'TimeoutError'))],
    ['invalid PNG', () => Promise.resolve(new Response('bad PNG'))],
  ])('keeps maps available after a %s', async (_name, respond) => {
    const { reader, logger } = setup(respond);
    expect(await reader.readWithin(CENTRE, 100)).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it('rejects rasters with wrong dimensions or missing elevation samples', async () => {
    const wrong = Buffer.from(RECORDED);
    wrong.writeUInt32BE(4096, 16);
    expect(() => decodeTerrainPng(wrong)).toThrow('Invalid terrain raster dimensions');
    const raster = new PNG({ width: 256, height: 256 });
    const png = PNG.sync.write(raster);
    const { reader } = setup(() => Promise.resolve(new Response(Uint8Array.from(png), {
      headers: { 'x-amz-meta-x-imagery-sources': 'srtm/S24W047.tif' },
    })));
    expect(await reader.readWithin(CENTRE, 100)).toBeUndefined();
  });
});
