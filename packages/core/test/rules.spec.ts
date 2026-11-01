import { describe, expect, it } from 'vitest';
import {
  FLOOR_HEIGHT_M,
  HEIGHT_RULE_VERSION,
  SPAWN_MAX_STREET_DISTANCE_M,
  attributionFor,
  chooseSpawn,
  estimateHeight,
  fnv1a32,
  isAreaKind,
  isLineKind,
  toLocal,
  type MapLine,
  type StoredBuilding,
} from '../src/index.js';
import { POC, at, squareRing } from './fakes.js';

describe('height rule', () => {
  it('is version 1', () => {
    expect(HEIGHT_RULE_VERSION).toBe(1);
  });

  it('hashes with FNV-1a 32-bit', () => {
    expect(fnv1a32('')).toBe(0x81_1c_9d_c5);
    expect(fnv1a32('a')).toBe(0xe4_0c_29_2c);
    expect(fnv1a32('foobar')).toBe(0xbf_9c_f9_68);
  });

  it('prefers a measured height', () => {
    expect(estimateHeight({ id: 'b', footprintAreaM2: 100, sourceHeightM: 21.5, numFloors: 3 })).toEqual({
      heightM: 21.5,
      minHeightM: 0,
      source: 'measured',
    });
  });

  it('falls back to floors times 3 m', () => {
    expect(estimateHeight({ id: 'b', footprintAreaM2: 100, sourceHeightM: 0, numFloors: 4 })).toEqual({
      heightM: 4 * FLOOR_HEIGHT_M,
      minHeightM: 0,
      source: 'floors',
    });
  });

  it('keeps a base height only when it is below the top', () => {
    expect(estimateHeight({ id: 'b', footprintAreaM2: 1, sourceHeightM: 20, minHeightM: 5 }).minHeightM).toBe(5);
    expect(estimateHeight({ id: 'b', footprintAreaM2: 1, sourceHeightM: 20, minHeightM: 25 }).minHeightM).toBe(0);
    expect(estimateHeight({ id: 'b', footprintAreaM2: 1, sourceHeightM: 20, minHeightM: -2 }).minHeightM).toBe(0);
  });

  it.each([
    [10, 3, 6],
    [100, 3, 9],
    [400, 6, 15],
    [5000, 8, 12],
  ])('estimates a %s m² footprint between %s and %s m', (area, min, max) => {
    for (let i = 0; i < 50; i++) {
      const height = estimateHeight({ id: `building-${i}`, footprintAreaM2: area });
      expect(height.source).toBe('estimated');
      expect(height.heightM).toBeGreaterThanOrEqual(min);
      expect(height.heightM).toBeLessThanOrEqual(max);
    }
  });

  it('gives the same estimate for the same Overture building every time', () => {
    // Real GERS ids and footprint areas from the PoC area (no height or floors in the source).
    const pinned = [
      ['00011ca5-cfd6-4f62-bd76-9e2c3e86285f', 124.4],
      ['00025179-41d5-4d30-8425-a9d317c44cf1', 96.7],
      ['000373c0-969b-409a-9add-cfb730e2bd98', 194.8],
    ] as const;
    const heights = pinned.map(([id, area]) => estimateHeight({ id, footprintAreaM2: area }).heightM);
    expect(heights).toEqual([6.9, 3.9, 6.5]);
  });
});

describe('spawn point', () => {
  it('avoids footways inside building footprints, but permits courtyards and raised parts', () => {
    const building: StoredBuilding = { id: 'museum', kind: 'building', footprint: [[squareRing(POC, 0, 0, 10)]] };
    const footway: MapLine = { id: 'covered', kind: 'footway', coords: [[at(POC, -5, 0), at(POC, 5, 0)]] };
    const road: MapLine = { id: 'clear', kind: 'residential', coords: [[at(POC, -50, 20), at(POC, 50, 20)]] };
    const blocked = local(chooseSpawn(POC, [footway, road], [building]).position);
    expect(blocked.x).toBeCloseTo(0);
    expect(blocked.y).toBeCloseTo(20);
    const courtyard = { ...building, footprint: [[squareRing(POC, 0, 0, 20), squareRing(POC, 0, 0, 10)]] };
    expect(local(chooseSpawn(POC, [footway], [courtyard]).position)).toEqual({ x: 0, y: 0 });
    expect(local(chooseSpawn(POC, [footway], [{ ...building, minHeightM: 3 }]).position)).toEqual({ x: 0, y: 0 });
  });

  it('considers clear street endpoints when the closest point is covered', () => {
    const building: StoredBuilding = { id: 'museum', kind: 'building', footprint: [[squareRing(POC, 0, 0, 10)]] };
    const road: MapLine = { id: 'road', kind: 'residential', coords: [[at(POC, -20, 0), at(POC, 20, 0)]] };
    expect(Math.abs(local(chooseSpawn(POC, [road], [building]).position).x)).toBeCloseTo(20);
  });
  const street = (id: string, kind: MapLine['kind'], y: number): MapLine => ({
    id,
    kind,
    coords: [[at(POC, -100, y), at(POC, 100, y)]],
  });
  const local = (position: readonly [number, number]) => toLocal(POC, position[0], position[1]);

  it('starts on the nearest walkable street, facing the address', () => {
    const spawn = chooseSpawn(POC, [street('far', 'primary', -60), street('near', 'residential', 20)], []);
    const point = local(spawn.position);
    expect(point.x).toBeCloseTo(0, 3);
    expect(point.y).toBeCloseTo(20, 3);
    expect(spawn.headingDeg).toBe(180);
  });

  it('ignores rail and water lines and streets beyond 150 m', () => {
    const lines = [
      street('rail', 'rail', 5),
      street('river', 'river', -5),
      street('far', 'residential', SPAWN_MAX_STREET_DISTANCE_M + 10),
    ];
    expect(local(chooseSpawn(POC, lines, []).position)).toEqual({ x: 0, y: 0 });
  });

  it('steps 2 m out of the building that contains the address when no street is near', () => {
    const building: StoredBuilding = {
      id: 'b',
      kind: 'building',
      footprint: [[squareRing(POC, 3, 0, 10)]],
    };
    const point = local(chooseSpawn(POC, [], [building]).position);
    expect(point.x).toBeCloseTo(-9, 3);
    expect(point.y).toBeCloseTo(0, 3);
  });

  it('falls back to the address itself', () => {
    const outside: StoredBuilding = { id: 'b', kind: 'building', footprint: [[squareRing(POC, 50, 50, 5)]] };
    const spawn = chooseSpawn(POC, [], [outside]);
    expect(local(spawn.position)).toEqual({ x: 0, y: 0 });
    expect(spawn.headingDeg).toBeGreaterThanOrEqual(0);
    expect(spawn.headingDeg).toBeLessThan(360);
  });
});

describe('attribution', () => {
  it('always credits OpenStreetMap and Overture', () => {
    expect(attributionFor([]).map((a) => a.text)).toEqual([
      '© OpenStreetMap contributors. Available under the Open Database License.',
      'Overture Maps Foundation',
    ]);
  });

  it('adds each known building dataset once and ignores unknown ones', () => {
    const credits = attributionFor([
      'Google Open Buildings',
      'OpenStreetMap',
      'Google Open Buildings',
      'Microsoft ML Buildings',
    ]);
    expect(credits).toHaveLength(4);
    expect(credits.map((c) => c.url)).toContain('https://sites.research.google/gr/open-buildings/');
  });

  it('credits TomTom when street segments come from it', () => {
    expect(attributionFor(['TomTom']).map((a) => a.text)).toContain('Data from TomTom.');
  });
});

describe('feature kinds', () => {
  it('recognises line and area kinds', () => {
    expect(isLineKind('residential')).toBe(true);
    expect(isLineKind('runway')).toBe(false);
    expect(isAreaKind('park')).toBe(true);
    expect(isAreaKind('glacier')).toBe(false);
  });
});
