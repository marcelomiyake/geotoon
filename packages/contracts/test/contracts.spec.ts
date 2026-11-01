import { describe, expect, it } from 'vitest';
import {
  API_PREFIX,
  AreaRequestBodySchema,
  AreaResponseSchema,
  CONTRACT_VERSION,
  ERROR_CODES,
  GeocodeQuerySchema,
  GeocodeResponseSchema,
  LocalitySchema,
  ProblemSchema,
  type AreaPending,
  type AreaReady,
} from '../src/index.js';

const pending: AreaPending = {
  contractVersion: 1,
  requestId: 'req-1',
  status: 'pending',
  pollAfterMs: 1000,
  sourceCalls: 1,
  tiles: [{ x: 24_257, y: 37_180, state: 'fetching' }],
};

const ready: AreaReady = {
  contractVersion: 1,
  requestId: 'req-2',
  status: 'ready',
  sourceCalls: 0,
  tiles: [{ x: 24_257, y: 37_180, state: 'complete', fetchedAt: '2026-11-01T12:00:00Z', release: '2026-10-21.0' }],
  area: { lat: -23.548_582, lon: -46.746_914, radiusM: 2000 },
  scene: {
    buildings: [
      {
        id: 'b1',
        footprint: [[[[-46.747, -23.548], [-46.746, -23.548], [-46.746, -23.549], [-46.747, -23.548]]]],
        heightM: 6.9,
        minHeightM: 0,
        heightSource: 'estimated',
        kind: 'building',
      },
    ],
    lines: [{ id: 'l1', kind: 'residential', widthM: 6, name: 'Avenida Bolonha', coords: [[[-46.747, -23.548], [-46.746, -23.548]]] }],
    areas: [],
    trees: [[-46.7465, -23.5485]],
    spawn: { lon: -46.746_914, lat: -23.548_4, headingDeg: 180 },
    attribution: [{ text: 'Overture Maps Foundation', url: 'https://overturemaps.org' }],
  },
};

describe('version', () => {
  it('is contract version 1 under /api/v1', () => {
    expect(CONTRACT_VERSION).toBe(1);
    expect(API_PREFIX).toBe('/api/v1');
  });
});

describe('area request body', () => {
  it('accepts coordinates in range', () => {
    expect(AreaRequestBodySchema.parse({ lat: -23.5, lon: -46.7 })).toEqual({ lat: -23.5, lon: -46.7 });
  });

  it.each([
    [{ lat: 91, lon: 0 }],
    [{ lat: 0, lon: -181 }],
    [{ lat: '1', lon: 2 }],
    [{ lat: 1 }],
    [{ lat: 1, lon: 2, radius: 5 }],
  ])('rejects %j', (body) => {
    expect(AreaRequestBodySchema.safeParse(body).success).toBe(false);
  });
});

describe('area response', () => {
  it('parses pending and ready payloads by status', () => {
    expect(AreaResponseSchema.parse(pending).status).toBe('pending');
    expect(AreaResponseSchema.parse(ready).status).toBe('ready');
  });

  it('requires the contract version and a known status', () => {
    expect(AreaResponseSchema.safeParse({ ...pending, contractVersion: 2 }).success).toBe(false);
    expect(AreaResponseSchema.safeParse({ ...pending, status: 'queued' }).success).toBe(false);
    expect(AreaResponseSchema.safeParse({ ...ready, scene: undefined }).success).toBe(false);
  });

  it('rejects a negative source call count and a bad tile state', () => {
    expect(AreaResponseSchema.safeParse({ ...pending, sourceCalls: -1 }).success).toBe(false);
    expect(
      AreaResponseSchema.safeParse({ ...pending, tiles: [{ x: 1, y: 1, state: 'unknown' }] }).success,
    ).toBe(false);
  });
});

describe('geocode', () => {
  it('validates optional structured locality without breaking older suggestions', () => {
    expect(LocalitySchema.parse({ countryCode: 'BR', city: ' São Paulo ' })).toEqual({ countryCode: 'BR', city: 'São Paulo' });
    expect(LocalitySchema.parse({ countryCode: 'BR' })).toEqual({ countryCode: 'BR' });
    for (const locality of [{ countryCode: 'Brazil' }, { countryCode: 'br' }, { countryCode: 'BR', city: '' }]) {
      expect(LocalitySchema.safeParse(locality).success).toBe(false);
    }
    const suggestion = { id: '1', label: 'São Paulo', lat: 0, lon: 0, kind: 'place', locality: { countryCode: 'BR', city: 'São Paulo' } };
    expect(GeocodeResponseSchema.parse({ suggestions: [suggestion] }).suggestions[0]?.locality).toEqual(suggestion.locality);
  });
  it('coerces the optional bias from query strings', () => {
    expect(GeocodeQuerySchema.parse({ q: 'Av. Bolonha', lat: '-23.5', lon: '-46.7' })).toEqual({
      q: 'Av. Bolonha',
      lat: -23.5,
      lon: -46.7,
    });
    expect(GeocodeQuerySchema.parse({ q: 'Av. Bolonha' })).toEqual({ q: 'Av. Bolonha' });
  });

  it('rejects empty and out-of-range queries', () => {
    expect(GeocodeQuerySchema.safeParse({ q: '' }).success).toBe(false);
    expect(GeocodeQuerySchema.safeParse({ q: 'x'.repeat(201) }).success).toBe(false);
    expect(GeocodeQuerySchema.safeParse({ q: 'abc', lat: '100' }).success).toBe(false);
  });

  it('validates suggestion kinds', () => {
    const suggestion = { id: 'osm:N1', label: 'Avenida Bolonha, 200', lat: -23.5, lon: -46.7, kind: 'house' };
    expect(GeocodeResponseSchema.parse({ suggestions: [suggestion] }).suggestions).toHaveLength(1);
    expect(GeocodeResponseSchema.safeParse({ suggestions: [{ ...suggestion, kind: 'shop' }] }).success).toBe(false);
  });
});

describe('problem', () => {
  it('lists every error code once', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
    expect(ERROR_CODES).toContain('AREA_FETCH_FAILED');
  });

  it('parses a problem with an optional retry time', () => {
    const problem = {
      type: 'https://github.com/marcelomiyake/geotoon#area_fetch_failed',
      title: 'Map data could not be fetched',
      status: 503,
      detail: 'Try again later.',
      code: 'AREA_FETCH_FAILED',
      retryable: true,
      retryAfterSeconds: 20,
      requestId: 'req-3',
    };
    expect(ProblemSchema.parse(problem)).toEqual(problem);
    expect(ProblemSchema.safeParse({ ...problem, code: 'TEAPOT' }).success).toBe(false);
    expect(ProblemSchema.safeParse({ ...problem, retryAfterSeconds: 0 }).success).toBe(false);
  });
});
