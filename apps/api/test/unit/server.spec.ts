import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DomainError, type AddressSuggestion, type AreaResult, type GeoPoint } from '@geotoon/core';
import type { FastifyInstance } from 'fastify';
import { pino } from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildServer, type ServerOptions } from '../../src/http/server.js';
import { POC } from '../support.js';

const PENDING: AreaResult = {
  status: 'pending',
  tiles: [{ tile: { x: 24_257, y: 37_180 }, state: 'fetching' }],
  sourceCalls: 1,
};
const SUGGESTION: AddressSuggestion = {
  id: 'W499319605',
  label: 'Peg Pese Hortifruti, Avenida Bolonha, 200, Jaguaré, São Paulo, Brasil',
  point: POC,
  kind: 'house',
};

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function start(overrides: Partial<ServerOptions> = {}) {
  const requestArea = { execute: vi.fn<(centre: GeoPoint, requestId: string) => Promise<AreaResult>>(() => Promise.resolve(PENDING)) };
  const suggest = { execute: vi.fn<(q: string, bias?: GeoPoint) => Promise<AddressSuggestion[]>>(() => Promise.resolve([SUGGESTION])) };
  app = await buildServer({
    logger: pino({ level: 'silent' }),
    requestArea,
    suggest,
    radiusM: 2000,
    rateLimits: { areasPerMinute: 30, geocodePerMinute: 60 },
    readiness: () => Promise.resolve({ ready: true, checks: { postgis: 'ok' } }),
    version: { version: '0.1.0', gitSha: 'abc', contractVersion: 1, overtureRelease: '2026-10-21.0', radiusM: 2000, tileZoom: 16 },
    ...overrides,
  });
  return { app, requestArea, suggest };
}

describe('POST /api/v1/areas', () => {
  it('answers 202 while tiles are fetched, without caching', async () => {
    const { app, requestArea } = await start();
    const response = await app.inject({ method: 'POST', url: '/api/v1/areas', payload: { lat: POC.lat, lon: POC.lon } });

    expect(response.statusCode).toBe(202);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers['server-timing']).toMatch(/^app;dur=/);
    expect(response.json()).toMatchObject({ status: 'pending', sourceCalls: 1, requestId: response.headers['x-request-id'] });
    expect(requestArea.execute).toHaveBeenCalledWith({ lat: POC.lat, lon: POC.lon }, response.headers['x-request-id']);
  });

  it('answers 200 with the scene when the area is stored', async () => {
    const ready: AreaResult = {
      status: 'ready',
      tiles: [{ tile: { x: 1, y: 2 }, state: 'complete' }],
      sourceCalls: 0,
      scene: { centre: POC, radiusM: 2000, buildings: [], lines: [], areas: [], trees: [], spawn: { position: [POC.lon, POC.lat], headingDeg: 0 }, attribution: [] },
    };
    const { app } = await start({ requestArea: { execute: () => Promise.resolve(ready) } });
    const response = await app.inject({ method: 'POST', url: '/api/v1/areas', payload: { lat: POC.lat, lon: POC.lon } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ready', sourceCalls: 0, area: { radiusM: 2000 } });
  });

  it.each([
    ['out-of-range coordinates', { lat: 95, lon: 0 }],
    ['a missing field', { lat: 1 }],
    ['strings', { lat: '1', lon: '2' }],
  ])('rejects %s as problem+json', async (_name, payload) => {
    const { app, requestArea } = await start();
    const response = await app.inject({ method: 'POST', url: '/api/v1/areas', payload });
    expect(response.statusCode).toBe(400);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json()).toMatchObject({ code: 'INVALID_COORDINATES', status: 400 });
    expect(requestArea.execute).not.toHaveBeenCalled();
  });

  it('rejects a body that is not JSON', async () => {
    const { app } = await start();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/areas',
      headers: { 'content-type': 'application/json' },
      payload: '{"lat":',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'INVALID_QUERY' });
  });

  it('passes on domain failures with a Retry-After header', async () => {
    const failure = new DomainError('AREA_FETCH_FAILED', 'Map data could not be fetched (timeout).', {
      retryable: true,
      retryAfterSeconds: 20,
    });
    const { app } = await start({ requestArea: { execute: () => Promise.reject(failure) } });
    const response = await app.inject({ method: 'POST', url: '/api/v1/areas', payload: { lat: 0, lon: 0 } });
    expect(response.statusCode).toBe(502);
    expect(response.headers['retry-after']).toBe('20');
    expect(response.json()).toMatchObject({ code: 'AREA_FETCH_FAILED', retryable: true });
  });

  it('hides unexpected errors behind a request id', async () => {
    const { app } = await start({ requestArea: { execute: () => Promise.reject(new Error('connection to db.internal.example refused')) } });
    const response = await app.inject({ method: 'POST', url: '/api/v1/areas', payload: { lat: 0, lon: 0 } });
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('db.internal.example');
    expect(response.json()).toMatchObject({ code: 'INTERNAL', requestId: response.headers['x-request-id'] });
  });

  it('rate-limits per client with a problem response', async () => {
    const { app } = await start({ rateLimits: { areasPerMinute: 1, geocodePerMinute: 60 } });
    const send = () => app.inject({ method: 'POST', url: '/api/v1/areas', payload: { lat: 0, lon: 0 } });
    expect((await send()).statusCode).toBe(202);
    const limited = await send();
    expect(limited.statusCode).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(limited.json()).toMatchObject({ code: 'RATE_LIMITED', retryable: true });
  });
});

describe('GET /api/v1/geocode', () => {
  it('returns suggestions with the bias passed through', async () => {
    const { app, suggest } = await start();
    const response = await app.inject({ method: 'GET', url: '/api/v1/geocode?q=Av.%20Bolonha%20200&lat=-23.5&lon=-46.7' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('private, max-age=300');
    expect(response.json()).toEqual({
      suggestions: [{ id: SUGGESTION.id, label: SUGGESTION.label, lat: POC.lat, lon: POC.lon, kind: 'house' }],
    });
    expect(suggest.execute).toHaveBeenCalledWith('Av. Bolonha 200', { lat: -23.5, lon: -46.7 });
  });

  it('rejects a missing query', async () => {
    const { app } = await start();
    const response = await app.inject({ method: 'GET', url: '/api/v1/geocode' });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'INVALID_QUERY' });
  });

  it('passes structured locality to the browser', async () => {
    const locality = { countryCode: 'BR', city: 'São Paulo' };
    const { app } = await start({ suggest: { execute: () => Promise.resolve([{ ...SUGGESTION, locality }]) } });
    const response = await app.inject({ url: '/api/v1/geocode?q=Bolonha' });
    expect(response.json()).toMatchObject({ suggestions: [{ locality }] });
  });

  it('maps a busy geocoder to 429', async () => {
    const busy = new DomainError('GEOCODER_RATE_LIMITED', 'busy', { retryable: true, retryAfterSeconds: 3 });
    const { app } = await start({ suggest: { execute: () => Promise.reject(busy) } });
    const response = await app.inject({ method: 'GET', url: '/api/v1/geocode?q=Bolonha' });
    expect(response.statusCode).toBe(429);
    expect(response.headers['retry-after']).toBe('3');
  });
});

describe('operations endpoints', () => {
  it('reports liveness, readiness and version', async () => {
    const { app } = await start();
    expect((await app.inject({ url: '/healthz' })).json()).toEqual({ status: 'ok' });
    const ready = await app.inject({ url: '/readyz' });
    expect(ready.statusCode).toBe(200);
    expect(ready.headers['cache-control']).toBe('no-store');
    expect((await app.inject({ url: '/version' })).json()).toMatchObject({ gitSha: 'abc', tileZoom: 16 });
  });

  it('answers 503 when a dependency is not ready', async () => {
    const { app } = await start({ readiness: () => Promise.resolve({ ready: false, checks: { postgis: 'error: refused' } }) });
    expect((await app.inject({ url: '/readyz' })).statusCode).toBe(503);
  });
});

describe('static web client', () => {
  function webRoot(): string {
    const root = mkdtempSync(path.join(tmpdir(), 'geotoon-web-'));
    mkdirSync(path.join(root, 'assets'));
    writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>GeoToon</title>');
    writeFileSync(path.join(root, 'assets', 'app-abc123.js'), 'console.log(1);');
    return root;
  }

  it('serves hashed assets as immutable and pages without caching', async () => {
    const { app } = await start({ staticDir: webRoot() });
    const asset = await app.inject({ url: '/assets/app-abc123.js' });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    const page = await app.inject({ url: '/' });
    expect(page.body).toContain('<title>GeoToon</title>');
    expect(page.headers['cache-control']).toBe('no-cache');
  });

  it('falls back to index.html for app routes but not for API routes', async () => {
    const { app } = await start({ staticDir: webRoot() });
    const deepLink = await app.inject({ url: '/somewhere?lat=1&lon=2' });
    expect(deepLink.statusCode).toBe(200);
    expect(deepLink.body).toContain('GeoToon');
    const api = await app.inject({ url: '/api/v1/unknown' });
    expect(api.statusCode).toBe(404);
    expect(api.json()).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('answers 404 problems when no client is built', async () => {
    const { app } = await start({ staticDir: '/does/not/exist' });
    const response = await app.inject({ url: '/' });
    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain('application/problem+json');
  });
});
