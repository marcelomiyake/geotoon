import { describe, expect, it } from 'vitest';
import {
  DomainError,
  distanceMeters,
  fromLocal,
  geoPoint,
  isInsideRing,
  multiPolygonAreaM2,
  nearestOnSegment,
  polygonAreaM2,
  sampleLine,
  signedRingArea,
  toLocal,
} from '../src/index.js';
import { POC, at, squareRing } from './fakes.js';

describe('geoPoint', () => {
  it('accepts the PoC address and freezes it', () => {
    const point = geoPoint(POC.lat, POC.lon);
    expect(point).toEqual(POC);
    expect(Object.isFrozen(point)).toBe(true);
  });

  it.each([
    [91, 0],
    [-90.1, 0],
    [0, 180.5],
    [Number.NaN, 0],
    [0, Number.POSITIVE_INFINITY],
  ])('rejects %s, %s with INVALID_COORDINATES', (lat, lon) => {
    expect(() => geoPoint(lat, lon)).toThrow(DomainError);
    try {
      geoPoint(lat, lon);
    } catch (error) {
      expect((error as DomainError).code).toBe('INVALID_COORDINATES');
    }
  });
});

describe('distanceMeters', () => {
  it('measures one degree of latitude as about 111.2 km', () => {
    expect(distanceMeters({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(111_195, -1);
  });

  it('is zero for the same point', () => {
    expect(distanceMeters(POC, POC)).toBe(0);
  });
});

describe('toLocal and fromLocal', () => {
  it('round-trips a point 2 km away', () => {
    const [lon, lat] = fromLocal(POC, { x: 1500, y: -1300 });
    const back = toLocal(POC, lon, lat);
    expect(back.x).toBeCloseTo(1500, 6);
    expect(back.y).toBeCloseTo(-1300, 6);
  });

  it('stays within 1 m of the great-circle distance at 2 km', () => {
    const [lon, lat] = fromLocal(POC, { x: 1414.2, y: 1414.2 });
    const local = toLocal(POC, lon, lat);
    const planar = Math.hypot(local.x, local.y);
    expect(Math.abs(planar - distanceMeters(POC, { lat, lon }))).toBeLessThan(1);
  });
});

describe('ring and polygon geometry', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];

  it('gives a positive signed area for an anticlockwise ring', () => {
    expect(signedRingArea(square)).toBe(100);
    expect(signedRingArea([...square].reverse())).toBe(-100);
  });

  it('subtracts holes from the polygon area', () => {
    const outer = squareRing(POC, 0, 0, 5);
    const hole = squareRing(POC, 0, 0, 2);
    expect(polygonAreaM2([outer])).toBeCloseTo(100, 1);
    expect(polygonAreaM2([outer, hole])).toBeCloseTo(84, 1);
    expect(multiPolygonAreaM2([[outer], [squareRing(POC, 50, 0, 5)]])).toBeCloseTo(200, 1);
  });

  it('returns 0 for an empty polygon', () => {
    expect(polygonAreaM2([])).toBe(0);
  });

  it('clamps the nearest point to the segment ends', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 10, y: 0 };
    expect(nearestOnSegment({ x: 5, y: 3 }, a, b)).toEqual({ x: 5, y: 0 });
    expect(nearestOnSegment({ x: -4, y: 1 }, a, b)).toEqual(a);
    expect(nearestOnSegment({ x: 14, y: 1 }, a, b)).toEqual(b);
    expect(nearestOnSegment({ x: 1, y: 1 }, a, a)).toEqual(a);
  });

  it('tests points against a ring', () => {
    expect(isInsideRing({ x: 5, y: 5 }, square)).toBe(true);
    expect(isInsideRing({ x: 15, y: 5 }, square)).toBe(false);
  });
});

describe('sampleLine', () => {
  it('places a point every spacing metres, starting at the first vertex', () => {
    const line = [at(POC, 0, 0), at(POC, 10, 0), at(POC, 20, 0)];
    const samples = sampleLine(line, 6);
    expect(samples).toHaveLength(4);
    const xs = samples.map(([lon, lat]) => toLocal(POC, lon, lat).x);
    xs.forEach((x, i) => expect(x).toBeCloseTo(i * 6, 3));
  });

  it('returns nothing for an empty line or a non-positive spacing', () => {
    expect(sampleLine([], 6)).toEqual([]);
    expect(sampleLine([at(POC, 0, 0), at(POC, 10, 0)], 0)).toEqual([]);
  });
});
