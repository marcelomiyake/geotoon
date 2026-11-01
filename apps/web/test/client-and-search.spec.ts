import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiProblem, abortableSleep, type AreaProgress } from '../src/api/client.js';
import {
  debounce,
  nextIndex,
  parseLatLon,
  readUrlState,
  searchErrorMessage,
  shouldSearch,
} from '../src/ui/search-logic.js';

const json = (status: number, body: unknown, type = 'application/json'): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': type } });

const pending = (complete: number) => ({
  contractVersion: 1,
  requestId: 'req-1',
  status: 'pending',
  pollAfterMs: 2000,
  sourceCalls: complete === 0 ? 1 : 0,
  tiles: [
    { x: 1, y: 1, state: complete > 0 ? 'complete' : 'fetching' },
    { x: 1, y: 2, state: 'fetching' },
  ],
});

const ready = {
  contractVersion: 1,
  requestId: 'req-2',
  status: 'ready',
  sourceCalls: 0,
  tiles: [{ x: 1, y: 1, state: 'complete' }],
  area: { lat: -23.5, lon: -46.7, radiusM: 2000 },
  scene: {
    buildings: [],
    lines: [],
    areas: [],
    trees: [],
    spawn: { lon: -46.7, lat: -23.5, headingDeg: 0 },
    attribution: [],
  },
};

function client(responses: Array<Response | Error>) {
  const queue = [...responses];
  const fetch = vi.fn<typeof globalThis.fetch>(() => {
    const next = queue.shift();
    if (next === undefined) {
      throw new Error('no more responses');
    }
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  });
  const sleep = vi.fn<(ms: number, signal?: AbortSignal) => Promise<void>>(() => Promise.resolve());
  let clock = 0;
  return { fetch, sleep, api: new ApiClient({ fetch, sleep, now: () => (clock += 1000), baseUrl: 'http://api.test' }) };
}

async function problemOf(promise: Promise<unknown>): Promise<ApiProblem> {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ApiProblem);
  return error as ApiProblem;
}

describe('ApiClient.loadArea', () => {
  it('polls while pending, reports progress, and returns the ready scene', async () => {
    const { api, fetch, sleep } = client([json(202, pending(0)), json(202, pending(1)), json(200, ready)]);
    const progress: AreaProgress[] = [];

    const result = await api.loadArea(-23.5, -46.7, (p) => progress.push(p));

    expect(result.status).toBe('ready');
    expect(fetch).toHaveBeenCalledTimes(3);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('http://api.test/api/v1/areas');
    expect(init).toMatchObject({ method: 'POST', body: JSON.stringify({ lat: -23.5, lon: -46.7 }) });
    expect(progress.map((p) => [p.completeTiles, p.totalTiles])).toEqual([
      [0, 2],
      [1, 2],
    ]);
    expect(progress[1]?.elapsedMs).toBe(2000);
    expect(sleep).toHaveBeenCalledWith(2000, undefined);
  });

  it('throws the problem the server returned', async () => {
    const problem = {
      type: 'urn:geotoon:problem:area-fetch-failed',
      title: 'Map data could not be fetched',
      status: 502,
      detail: 'Map data for 4 tile(s) could not be fetched (timeout).',
      code: 'AREA_FETCH_FAILED',
      retryable: true,
      retryAfterSeconds: 20,
      requestId: 'req-9',
    };
    const { api } = client([json(502, problem, 'application/problem+json')]);
    const error = await problemOf(api.loadArea(0, 0, () => undefined));
    expect(error).toMatchObject({ code: 'AREA_FETCH_FAILED', requestId: 'req-9', retryAfterSeconds: 20 });
    expect(error.message).toBe(problem.detail);
  });

  it.each([
    ['an error page that is not a problem', [new Response('<html>', { status: 503 })], 'BAD_RESPONSE'],
    ['a network failure', [new TypeError('fetch failed')], 'NETWORK'],
    ['a ready body with the wrong shape', [json(200, { status: 'ready' })], 'BAD_RESPONSE'],
    ['a pending body with the wrong shape', [json(202, { status: 'queued' })], 'BAD_RESPONSE'],
    ['an unreadable body', [new Response('not json', { status: 200 })], 'BAD_RESPONSE'],
  ])('reports %s', async (_name, responses, code) => {
    const { api } = client(responses);
    expect((await problemOf(api.loadArea(0, 0, () => undefined))).code).toBe(code);
  });

  it('passes an abort through instead of reporting a network error', async () => {
    const controller = new AbortController();
    controller.abort(new DOMException('stopped', 'AbortError'));
    const { api } = client([new DOMException('stopped', 'AbortError')]);
    await expect(api.loadArea(0, 0, () => undefined, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('ApiClient.suggest', () => {
  it('sends the query and the rounded bias', async () => {
    const suggestions = [{ id: 'W1', label: 'Avenida Bolonha, 200', lat: -23.5, lon: -46.7, kind: 'house' }];
    const { api, fetch } = client([json(200, { suggestions })]);
    expect(await api.suggest('Av. Bolonha', undefined, { lat: -23.548_581_7, lon: -46.746_914_4 })).toEqual(suggestions);
    expect(fetch.mock.calls[0]?.[0]).toBe('http://api.test/api/v1/geocode?q=Av.+Bolonha&lat=-23.5486&lon=-46.7469');
  });

  it('rejects an unexpected response', async () => {
    const { api } = client([json(200, { results: [] })]);
    expect((await problemOf(api.suggest('Bolonha'))).code).toBe('BAD_RESPONSE');
  });
});

describe('abortableSleep', () => {
  it('resolves after the delay', async () => {
    vi.useFakeTimers();
    try {
      const done = vi.fn();
      const sleeping = abortableSleep(1000).then(done);
      await vi.advanceTimersByTimeAsync(999);
      expect(done).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await sleeping;
      expect(done).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects at once or on abort', async () => {
    await expect(abortableSleep(10, AbortSignal.abort(new Error('gone')))).rejects.toThrow('gone');
    const controller = new AbortController();
    const sleeping = abortableSleep(60_000, controller.signal);
    controller.abort(new Error('cancelled'));
    await expect(sleeping).rejects.toThrow('cancelled');
  });
});

describe('search logic', () => {
  it.each([
    ['-23.5486, -46.7469', { lat: -23.5486, lon: -46.7469 }],
    ['-23.5486 -46.7469', { lat: -23.5486, lon: -46.7469 }],
    ['  -23.5;-46.7 ', { lat: -23.5, lon: -46.7 }],
    ['10,20', { lat: 10, lon: 20 }],
  ])('parses %j as coordinates', (text, expected) => {
    expect(parseLatLon(text)).toEqual(expected);
  });

  it.each(['Av. Bolonha 200', '-23.5', '1, 2, 3', '95, 10', '10, 190', '1e3, 2', '--1, 2', ''])(
    'does not treat %j as coordinates',
    (text) => {
      expect(parseLatLon(text)).toBeUndefined();
    },
  );

  it('searches only for addresses of three or more characters', () => {
    expect(shouldSearch('Av')).toBe(false);
    expect(shouldSearch('  Av  ')).toBe(false);
    expect(shouldSearch('Av. Bolonha')).toBe(true);
    expect(shouldSearch('-23.5, -46.7')).toBe(false);
  });

  it('debounces calls and can cancel the pending one', () => {
    vi.useFakeTimers();
    try {
      const fn = vi.fn();
      const debounced = debounce(fn, 300);
      debounced('a');
      vi.advanceTimersByTime(200);
      debounced('b');
      vi.advanceTimersByTime(299);
      expect(fn).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(fn).toHaveBeenCalledExactlyOnceWith('b');
      debounced('c');
      debounced.cancel();
      debounced.cancel();
      vi.advanceTimersByTime(1000);
      expect(fn).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('wraps keyboard selection at both ends', () => {
    expect(nextIndex(-1, 3, 'ArrowDown')).toBe(0);
    expect(nextIndex(2, 3, 'ArrowDown')).toBe(0);
    expect(nextIndex(0, 3, 'ArrowUp')).toBe(2);
    expect(nextIndex(-1, 3, 'ArrowUp')).toBe(2);
    expect(nextIndex(1, 3, 'ArrowUp')).toBe(0);
    expect(nextIndex(0, 0, 'ArrowDown')).toBe(-1);
  });

  it('reads the shared-link state from the query string', () => {
    expect(readUrlState('?lat=-23.5&lon=-46.7&debug=1')).toEqual({ point: { lat: -23.5, lon: -46.7 }, debug: true });
    expect(readUrlState('?lat=abc&lon=1')).toEqual({ debug: false });
    expect(readUrlState('')).toEqual({ debug: false });
  });

  it('explains search failures', () => {
    expect(searchErrorMessage(new ApiProblem('GEOCODER_RATE_LIMITED', 'busy'))).toMatch(/^Too many searches/);
    expect(searchErrorMessage(new ApiProblem('RATE_LIMITED', 'busy'))).toMatch(/^Too many searches/);
    expect(searchErrorMessage(new ApiProblem('GEOCODER_UNAVAILABLE', 'down'))).toMatch(/lat, lon/);
    expect(searchErrorMessage(new ApiProblem('INVALID_QUERY', 'Query too short.'))).toBe('Search failed: Query too short.');
    expect(searchErrorMessage(new Error('offline'))).toBe('Search failed. Check the connection and try again.');
  });
});
