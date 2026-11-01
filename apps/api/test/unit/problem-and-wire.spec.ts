import { AreaResponseSchema, ERROR_CODES, ProblemSchema } from '@geotoon/contracts';
import { DomainError, type AreaResult, type Scene } from '@geotoon/core';
import { describe, expect, it } from 'vitest';
import { STATUS_BY_CODE, problemFor } from '../../src/http/problem.js';
import { toProblem } from '../../src/http/server.js';
import { POLL_AFTER_MS, toAreaBody } from '../../src/http/wire.js';
import { POC } from '../support.js';

describe('problemFor', () => {
  it.each(ERROR_CODES.map((code) => [code, STATUS_BY_CODE[code]] as const))(
    'maps %s to HTTP %i with a valid body',
    (code, status) => {
      const problem = problemFor(code, 'detail', 'req-1');
      expect(problem.status).toBe(status);
      expect(problem.type).toBe(`urn:geotoon:problem:${code.toLowerCase().replaceAll('_', '-')}`);
      expect(ProblemSchema.parse(problem)).toEqual(problem);
    },
  );

  it('adds the retry time only when given and lets the status be overridden', () => {
    expect(problemFor('INTERNAL', 'x', 'r')).not.toHaveProperty('retryAfterSeconds');
    expect(problemFor('RATE_LIMITED', 'x', 'r', { retryable: true, retryAfterSeconds: 7 })).toMatchObject({
      retryable: true,
      retryAfterSeconds: 7,
    });
    expect(problemFor('INVALID_QUERY', 'x', 'r', { status: 413 }).status).toBe(413);
  });
});

describe('toProblem', () => {
  it('keeps the code and retry hints of a domain error', () => {
    const error = new DomainError('AREA_FETCH_FAILED', 'fetch failed', { retryable: true, retryAfterSeconds: 20 });
    expect(toProblem(error, 'r')).toMatchObject({ status: 502, code: 'AREA_FETCH_FAILED', retryAfterSeconds: 20 });
  });

  it('maps framework 404 and 4xx errors', () => {
    expect(toProblem(Object.assign(new Error('gone'), { statusCode: 404 }), 'r').code).toBe('NOT_FOUND');
    expect(toProblem(Object.assign(new Error('Body is too large'), { statusCode: 413 }), 'r')).toMatchObject({
      status: 413,
      code: 'INVALID_QUERY',
      detail: 'Body is too large',
    });
    expect(toProblem({ statusCode: 400 }, 'r').detail).toBe('The request was not valid.');
  });

  it('hides the message of anything unexpected', () => {
    const problem = toProblem(new Error('password authentication failed for user geotoon'), 'r');
    expect(problem).toMatchObject({ status: 500, code: 'INTERNAL' });
    expect(problem.detail).not.toContain('password');
    expect(toProblem({ statusCode: 'teapot' }, 'r').status).toBe(500);
  });
});

describe('toAreaBody', () => {
  const tiles = [
    { tile: { x: 24_257, y: 37_180 }, state: 'complete' as const, fetchedAt: new Date('2026-11-01T12:00:00Z'), release: '2026-10-21.0' },
  ];
  const scene: Scene = {
    centre: POC,
    radiusM: 300,
    buildings: [
      {
        id: 'b',
        footprint: [[[[-46.747, -23.548], [-46.746, -23.548], [-46.746, -23.549], [-46.747, -23.548]]]],
        heightM: 6,
        minHeightM: 0,
        heightSource: 'estimated',
        kind: 'building',
      },
    ],
    lines: [
      { id: 'l1', kind: 'residential', widthM: 6, name: 'Avenida Bolonha', coords: [[[-46.747, -23.548], [-46.746, -23.548]]] },
      { id: 'l2', kind: 'footway', widthM: 2, coords: [[[-46.747, -23.549], [-46.746, -23.549]]] },
    ],
    areas: [{ id: 'a', kind: 'park', polygons: [] }],
    trees: [[-46.7465, -23.5485]],
    spawn: { position: [-46.7469, -23.5484], headingDeg: 180 },
    attribution: [{ text: 'Overture Maps Foundation', url: 'https://overturemaps.org' }],
  };

  it('builds a pending body with a poll delay', () => {
    const result: AreaResult = { status: 'pending', tiles: [{ tile: { x: 1, y: 2 }, state: 'fetching' }], sourceCalls: 1 };
    const body = toAreaBody(result, POC, 300, 'req-1');
    expect(AreaResponseSchema.parse(body)).toEqual({
      contractVersion: 1,
      requestId: 'req-1',
      status: 'pending',
      pollAfterMs: POLL_AFTER_MS,
      sourceCalls: 1,
      tiles: [{ x: 1, y: 2, state: 'fetching' }],
    });
  });

  it('builds a ready body that matches the wire contract', () => {
    const body = toAreaBody({ status: 'ready', tiles, sourceCalls: 0, scene }, POC, 300, 'req-2');
    const parsed = AreaResponseSchema.parse(body);
    expect(parsed.status).toBe('ready');
    if (parsed.status !== 'ready') {
      return;
    }
    expect(parsed.tiles[0]).toEqual({ x: 24_257, y: 37_180, state: 'complete', fetchedAt: '2026-11-01T12:00:00.000Z', release: '2026-10-21.0' });
    expect(parsed.area).toEqual({ lat: POC.lat, lon: POC.lon, radiusM: 300 });
    expect(parsed.scene.spawn).toEqual({ lon: -46.7469, lat: -23.5484, headingDeg: 180 });
    expect(parsed.scene.lines[1]).not.toHaveProperty('name');
  });
});
