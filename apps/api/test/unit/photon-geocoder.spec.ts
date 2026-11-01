import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DomainError } from '@geotoon/core';
import { describe, expect, it, vi } from 'vitest';
import { PhotonGeocoder, buildLabel, suggestionKind } from '../../src/adapters/photon/photon-geocoder.js';
import { FIXTURES, POC } from '../support.js';

const RECORDED = readFileSync(path.join(FIXTURES, 'photon', 'av-bolonha-200.json'), 'utf8');
const CONFIG = { url: 'https://photon.example', timeoutMs: 4000, userAgent: 'geotoon-test' };

function geocoder(respond: () => Promise<Response>) {
  const fetchImpl = vi.fn<typeof fetch>(respond);
  return { fetchImpl, photon: new PhotonGeocoder(CONFIG, fetchImpl) };
}

async function failure(promise: Promise<unknown>): Promise<DomainError> {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(DomainError);
  return error as DomainError;
}

describe('PhotonGeocoder', () => {
  it('turns the recorded Photon answer into a suggestion', async () => {
    const { fetchImpl, photon } = geocoder(() => Promise.resolve(new Response(RECORDED, { status: 200 })));

    const suggestions = await photon.search({ query: 'Av. Bolonha 200 Jaguaré', bias: POC, limit: 5 });

    expect(suggestions).toEqual([
      {
        id: 'W499319605',
        label: 'Peg Pese Hortifruti, Avenida Bolonha, 200, Jaguaré, São Paulo, Brasil',
        point: { lat: -23.548_581_7, lon: -46.746_914_4 },
        kind: 'house',
        locality: { countryCode: 'BR', city: 'São Paulo' },
      },
    ]);
    const [url, init] = fetchImpl.mock.calls[0]!;
    const sent = new URL(url instanceof Request ? url.url : url);
    expect(sent.origin + sent.pathname).toBe('https://photon.example/api/');
    expect(Object.fromEntries(sent.searchParams)).toEqual({
      q: 'Av. Bolonha 200 Jaguaré',
      limit: '5',
      lang: 'default',
      lat: '-23.5486',
      lon: '-46.7469',
    });
    expect(init?.headers).toMatchObject({ 'user-agent': 'geotoon-test' });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('skips features without a point, a label or valid coordinates', async () => {
    const body = {
      features: [
        { geometry: { type: 'LineString', coordinates: [1, 2] }, properties: { name: 'line' } },
        { geometry: { type: 'Point', coordinates: [1, 2] }, properties: {} },
        { geometry: { type: 'Point', coordinates: [200, 2] }, properties: { name: 'far away' } },
        { geometry: { type: 'Point', coordinates: [-46.7, -23.5] }, properties: { name: 'Jaguaré', type: 'district' } },
      ],
    };
    const { photon } = geocoder(() => Promise.resolve(Response.json(body)));
    const suggestions = await photon.search({ query: 'Jaguaré', limit: 5 });
    expect(suggestions).toEqual([{ id: 'photon-3', label: 'Jaguaré', point: { lat: -23.5, lon: -46.7 }, kind: 'place' }]);
  });

  it('reports a busy service as GEOCODER_RATE_LIMITED with the retry time', async () => {
    const { photon } = geocoder(() => Promise.resolve(new Response('slow down', { status: 429, headers: { 'retry-after': '7' } })));
    const error = await failure(photon.search({ query: 'Bolonha', limit: 5 }));
    expect(error).toMatchObject({ code: 'GEOCODER_RATE_LIMITED', retryable: true, retryAfterSeconds: 7 });
  });

  it.each([
    [{ countrycode: ' br ', city: ' Recife ' }, { countryCode: 'BR', city: 'Recife' }],
    [{ countrycode: 'BR', type: 'city', name: 'São Paulo' }, { countryCode: 'BR', city: 'São Paulo' }],
    [{ countrycode: 'JP', city: ' ' }, { countryCode: 'JP' }],
    [{ countrycode: 'BRA', city: 'Recife' }, undefined],
    [{ city: 'São Paulo' }, undefined],
  ])('maps structured locality from %j without parsing the label', async (properties, expected) => {
    const body = { features: [{ geometry: { type: 'Point', coordinates: [0, 0] }, properties: { name: 'Place', ...properties } }] };
    const { photon } = geocoder(() => Promise.resolve(Response.json(body)));
    expect((await photon.search({ query: 'Place', limit: 5 }))[0]?.locality).toEqual(expected);
  });

  it('ignores a Retry-After header that is not a positive integer', async () => {
    const { photon } = geocoder(() => Promise.resolve(new Response('', { status: 429, headers: { 'retry-after': 'soon' } })));
    expect((await failure(photon.search({ query: 'Bolonha', limit: 5 }))).retryAfterSeconds).toBeUndefined();
  });

  it.each([
    ['a server error', () => Promise.resolve(new Response('oops', { status: 500 }))],
    ['an unreadable body', () => Promise.resolve(new Response('<html>', { status: 200 }))],
    ['a timeout', () => Promise.reject(new DOMException('The operation timed out.', 'TimeoutError'))],
    ['a network error', () => Promise.reject(new TypeError('fetch failed'))],
  ])('reports %s as GEOCODER_UNAVAILABLE', async (_name, respond) => {
    const { photon } = geocoder(respond);
    const error = await failure(photon.search({ query: 'Bolonha', limit: 5 }));
    expect(error).toMatchObject({ code: 'GEOCODER_UNAVAILABLE', retryable: true });
    expect(error.message).toBe('The address service is unavailable.');
    expect(error.cause).toBeInstanceOf(Error);
  });
});

describe('Photon labels and kinds', () => {
  it('joins the address parts and drops empty and repeated ones', () => {
    expect(
      buildLabel({ name: 'São Paulo', street: 'Avenida Bolonha', city: 'são paulo', state: 'São Paulo', country: ' ' }),
    ).toBe('São Paulo, Avenida Bolonha');
    expect(buildLabel({ street: 'Rua A', housenumber: '10', locality: 'Vila B' })).toBe('Rua A, 10, Vila B');
    expect(buildLabel({})).toBe('');
  });

  it('maps Photon types to suggestion kinds', () => {
    expect(suggestionKind('house')).toBe('house');
    expect(suggestionKind('street')).toBe('street');
    expect(suggestionKind('city')).toBe('place');
    expect(suggestionKind('other')).toBe('other');
    expect(suggestionKind(undefined)).toBe('other');
  });
});
