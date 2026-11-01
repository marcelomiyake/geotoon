import { describe, expect, it } from 'vitest';
import {
  LEASE_SECONDS,
  TILE_ZOOM,
  areaStatus,
  boundsOf,
  boundsOfTiles,
  compareTiles,
  earliestRetry,
  isClaimable,
  missingCoverage,
  retryDelaySeconds,
  tileId,
  tileOf,
  tilesCovering,
  type TileCoverage,
} from '../src/index.js';
import { POC } from './fakes.js';

const NOW = new Date('2026-11-01T12:00:00Z');
const later = (seconds: number): Date => new Date(NOW.getTime() + seconds * 1000);
const TILE = { x: 1, y: 2 };

describe('tile grid', () => {
  it('finds the zoom-16 tile of the PoC address', () => {
    expect(TILE_ZOOM).toBe(16);
    expect(tileOf(POC)).toEqual({ x: 24_257, y: 37_180 });
    expect(tileId(tileOf(POC))).toBe('16/24257/37180');
  });

  it('gives bounds that contain the point', () => {
    const bounds = boundsOf(tileOf(POC));
    expect(bounds.west).toBeLessThanOrEqual(POC.lon);
    expect(bounds.east).toBeGreaterThan(POC.lon);
    expect(bounds.south).toBeLessThanOrEqual(POC.lat);
    expect(bounds.north).toBeGreaterThan(POC.lat);
  });

  it('clamps polar latitudes into the grid', () => {
    expect(tileOf({ lat: 89.9, lon: 179.999_999 })).toEqual({ x: 65_535, y: 0 });
    expect(tileOf({ lat: -89.9, lon: -180 })).toEqual({ x: 0, y: 65_535 });
  });

  it('covers 1 km with at most 16 tiles, sorted and including the centre', () => {
    const tiles = tilesCovering(POC, 1000);
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.length).toBeLessThanOrEqual(16);
    expect(tiles).toContainEqual(tileOf(POC));
    expect([...tiles].sort(compareTiles)).toEqual(tiles);
  });

  it('leaves out corner tiles the circle does not reach', () => {
    const radius = 2000;
    const tiles = tilesCovering(POC, radius);
    const xs = tiles.map((t) => t.x);
    const ys = tiles.map((t) => t.y);
    const square = (Math.max(...xs) - Math.min(...xs) + 1) * (Math.max(...ys) - Math.min(...ys) + 1);
    expect(tiles).toHaveLength(55);
    expect(tiles.length).toBeLessThan(square);
  });

  it('merges tile bounds and rejects an empty list', () => {
    const a = boundsOf({ x: 10, y: 10 });
    const b = boundsOf({ x: 11, y: 12 });
    expect(boundsOfTiles([{ x: 10, y: 10 }, { x: 11, y: 12 }])).toEqual({
      south: b.south,
      west: a.west,
      north: a.north,
      east: b.east,
    });
    expect(() => boundsOfTiles([])).toThrow(RangeError);
  });
});

describe('tile coverage rules', () => {
  const coverage = (fields: Partial<TileCoverage>): TileCoverage => ({
    ...missingCoverage(TILE),
    ...fields,
  });

  it('lets a fetch claim missing tiles only', () => {
    expect(isClaimable(missingCoverage(TILE), NOW)).toBe(true);
    expect(isClaimable(coverage({ state: 'complete' }), NOW)).toBe(false);
  });

  it('protects a live lease and frees an expired one', () => {
    expect(isClaimable(coverage({ state: 'fetching', leaseExpiresAt: later(10) }), NOW)).toBe(false);
    expect(isClaimable(coverage({ state: 'fetching', leaseExpiresAt: later(-1) }), NOW)).toBe(true);
    expect(isClaimable(coverage({ state: 'fetching' }), NOW)).toBe(true);
  });

  it('holds failed tiles until their retry time', () => {
    expect(isClaimable(coverage({ state: 'failed', retryAfter: later(5) }), NOW)).toBe(false);
    expect(isClaimable(coverage({ state: 'failed', retryAfter: NOW }), NOW)).toBe(true);
    expect(isClaimable(coverage({ state: 'failed' }), NOW)).toBe(true);
  });

  it('backs off exponentially and caps at 10 minutes', () => {
    expect([0, 1, 2, 3].map(retryDelaySeconds)).toEqual([10, 20, 40, 80]);
    expect(retryDelaySeconds(-3)).toBe(10);
    expect(retryDelaySeconds(30)).toBe(600);
  });

  it('keeps the lease longer than the 120 s source timeout', () => {
    expect(LEASE_SECONDS).toBeGreaterThan(120);
  });

  it('derives the area status from its tiles', () => {
    const complete = coverage({ state: 'complete' });
    const fetching = coverage({ state: 'fetching', leaseExpiresAt: later(60) });
    const blocked = coverage({ state: 'failed', retryAfter: later(30) });
    const retryable = coverage({ state: 'failed', retryAfter: later(-30) });
    expect(areaStatus([complete, complete], NOW)).toBe('ready');
    expect(areaStatus([complete, fetching], NOW)).toBe('pending');
    expect(areaStatus([complete, retryable], NOW)).toBe('pending');
    expect(areaStatus([fetching, blocked], NOW)).toBe('failed');
  });

  it('finds the earliest retry among failed tiles', () => {
    expect(earliestRetry([coverage({ state: 'complete' })])).toBeUndefined();
    expect(
      earliestRetry([
        coverage({ state: 'failed', retryAfter: later(90) }),
        coverage({ state: 'failed' }),
        coverage({ state: 'failed', retryAfter: later(30) }),
      ]),
    ).toEqual(later(30));
  });
});
