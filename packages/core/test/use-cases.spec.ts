import { describe, expect, it, vi } from 'vitest';
import {
  CountingMapDataSource,
  DomainError,
  IngestTiles,
  LINE_WIDTH_M,
  ReadScene,
  RequestArea,
  SourceError,
  SuggestAddresses,
  boundsOfTiles,
  classifySourceError,
  normaliseQuery,
  retryDelaySeconds,
  tilesCovering,
  type AddressSuggestion,
  type FeatureBatch,
  type FeatureReader,
  type Geocoder,
  type MapDataSource,
  type StoredFeatures,
} from '../src/index.js';
import {
  FixedClock,
  InMemoryCoverage,
  InMemoryFeatureStore,
  MemoryLogger,
  POC,
  RecordingScheduler,
  at,
  squareRing,
} from './fakes.js';

const RADIUS_M = 300;
const OWNER = 'test-host:1:owner';
const EMPTY: StoredFeatures = { buildings: [], lines: [], areas: [], trees: [], datasets: [] };

function setup() {
  const clock = new FixedClock();
  const coverage = new InMemoryCoverage(clock);
  const scheduler = new RecordingScheduler();
  const readWithin = vi.fn<FeatureReader['readWithin']>(() => Promise.resolve(EMPTY));
  const requestArea = new RequestArea({
    coverage,
    scheduler,
    readScene: new ReadScene({ readWithin }),
    clock,
    owner: OWNER,
    radiusM: RADIUS_M,
  });
  return { clock, coverage, scheduler, readWithin, requestArea, tiles: tilesCovering(POC, RADIUS_M) };
}

describe('RequestArea', () => {
  it('returns the scene with no source call when every tile is stored', async () => {
    const { coverage, scheduler, readWithin, requestArea, tiles } = setup();
    coverage.setAll(tiles, { state: 'complete', attempts: 1, release: '2026-10-21.0' });

    const result = await requestArea.execute(POC, 'req-1');

    expect(result.status).toBe('ready');
    expect(result.sourceCalls).toBe(0);
    expect(result.tiles).toHaveLength(tiles.length);
    expect(scheduler.jobs).toHaveLength(0);
    expect(readWithin).toHaveBeenCalledWith(POC, RADIUS_M);
  });

  it('claims missing tiles and schedules exactly one fetch', async () => {
    const { scheduler, requestArea, tiles } = setup();

    const first = await requestArea.execute(POC, 'req-1');
    const second = await requestArea.execute(POC, 'req-2');

    expect(first).toMatchObject({ status: 'pending', sourceCalls: 1 });
    expect(first.tiles.every((t) => t.state === 'fetching')).toBe(true);
    expect(second).toMatchObject({ status: 'pending', sourceCalls: 0 });
    expect(scheduler.jobs).toEqual([{ tiles, owner: OWNER, requestId: 'req-1' }]);
  });

  it('schedules one fetch when two requests arrive together', async () => {
    const { scheduler, requestArea } = setup();

    const results = await Promise.all([
      requestArea.execute(POC, 'req-a'),
      requestArea.execute(POC, 'req-b'),
    ]);

    expect(results.map((r) => r.sourceCalls).sort((a, b) => a - b)).toEqual([0, 1]);
    expect(scheduler.jobs).toHaveLength(1);
  });

  it('fails with a retry time while failed tiles are backing off', async () => {
    const { clock, coverage, requestArea, tiles } = setup();
    coverage.setAll(tiles, {
      state: 'failed',
      attempts: 1,
      errorClass: 'timeout',
      retryAfter: new Date(clock.now().getTime() + 20_000),
    });

    const error = await requestArea.execute(POC, 'req-1').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DomainError);
    expect(error).toMatchObject({ code: 'AREA_FETCH_FAILED', retryable: true, retryAfterSeconds: 20 });
    expect((error as Error).message).toContain('timeout');
  });

  it('retries failed tiles once their back-off has passed', async () => {
    const { clock, coverage, scheduler, requestArea, tiles } = setup();
    coverage.setAll(tiles, {
      state: 'failed',
      attempts: 1,
      errorClass: 'network',
      retryAfter: new Date(clock.now().getTime() + 20_000),
    });
    clock.advance(21);

    const result = await requestArea.execute(POC, 'req-2');

    expect(result).toMatchObject({ status: 'pending', sourceCalls: 1 });
    expect(scheduler.jobs).toHaveLength(1);
  });
});

describe('IngestTiles', () => {
  const batch: FeatureBatch = { release: '2026-10-21.0', features: [] };

  function ingestSetup(source: MapDataSource) {
    const clock = new FixedClock();
    const coverage = new InMemoryCoverage(clock);
    const store = new InMemoryFeatureStore(coverage);
    const logger = new MemoryLogger();
    const ingest = new IngestTiles({ source, coverage, store, clock, logger, timeoutMs: 120_000 });
    return { clock, coverage, store, logger, ingest, tiles: tilesCovering(POC, RADIUS_M) };
  }

  it('fetches the claimed tiles once and marks them complete', async () => {
    const fetch = vi.fn(() => Promise.resolve(batch));
    const { coverage, store, logger, ingest, tiles } = ingestSetup({ fetch });
    await coverage.claim(tiles, OWNER, 180);

    await ingest.run({ tiles, owner: OWNER, requestId: 'req-1' });

    expect(fetch).toHaveBeenCalledWith(boundsOfTiles(tiles), { timeoutMs: 120_000 });
    expect(store.batches).toEqual([batch]);
    const stored = await coverage.get(tiles);
    expect(stored.every((c) => c.state === 'complete' && c.release === batch.release)).toBe(true);
    expect(logger.entries[0]).toMatchObject({ level: 'info', message: 'ingestion complete' });
  });

  it('marks tiles failed with back-off and logs the classified cause', async () => {
    const cause = new Error('IO Error: could not resolve host\nmore detail');
    const fetch = vi.fn(() => Promise.reject(new SourceError('network', 'Overture unreachable', { cause })));
    const { clock, coverage, logger, ingest, tiles } = ingestSetup({ fetch });
    await coverage.claim(tiles, OWNER, 180);

    await ingest.run({ tiles, owner: OWNER, requestId: 'req-1' });

    const stored = await coverage.get(tiles);
    expect(stored.every((c) => c.state === 'failed' && c.errorClass === 'network')).toBe(true);
    expect(stored[0]?.retryAfter).toEqual(new Date(clock.now().getTime() + retryDelaySeconds(1) * 1000));
    expect(logger.entries[0]).toMatchObject({
      level: 'error',
      message: 'ingestion failed',
      fields: { errorClass: 'network', cause: 'IO Error: could not resolve host' },
    });
  });

  it('classifies unexpected errors as unknown', async () => {
    const fetch = vi.fn(() => Promise.reject(new Error('boom')));
    const { coverage, logger, ingest, tiles } = ingestSetup({ fetch });
    await coverage.claim(tiles, OWNER, 180);

    await ingest.run({ tiles, owner: OWNER, requestId: 'req-1' });

    expect(logger.entries[0]?.fields).toMatchObject({ errorClass: 'unknown', message: 'boom' });
    expect(logger.entries[0]?.fields?.['cause']).toBeUndefined();
  });

  it('does not complete tiles whose lease another owner took over', async () => {
    const { coverage, ingest, tiles } = ingestSetup({ fetch: () => Promise.resolve(batch) });
    await coverage.claim(tiles, OWNER, 180);
    const stolen = tiles[0]!;
    coverage.setAll([stolen], {
      state: 'fetching',
      attempts: 2,
      leaseOwner: 'other-owner',
      leaseExpiresAt: new Date(Date.now() + 600_000),
    });

    await ingest.run({ tiles, owner: OWNER, requestId: 'req-1' });

    const [first, ...rest] = await coverage.get(tiles);
    expect(first).toMatchObject({ state: 'fetching', leaseOwner: 'other-owner' });
    expect(rest.every((c) => c.state === 'complete')).toBe(true);
  });
});

describe('ReadScene', () => {
  it('applies the height rule, line widths, tree sampling and attribution', async () => {
    const stored: StoredFeatures = {
      buildings: [
        { id: 'measured', kind: 'office', footprint: [[squareRing(POC, 40, 40, 5)]], sourceHeightM: 30 },
        { id: 'estimated', kind: 'building', footprint: [[squareRing(POC, -40, 40, 5)]] },
      ],
      lines: [{ id: 'road', kind: 'residential', name: 'Av. Bolonha', coords: [[at(POC, -50, 10), at(POC, 50, 10)]] }],
      areas: [{ id: 'park', kind: 'park', polygons: [[squareRing(POC, 0, -60, 20)]] }],
      trees: [
        { id: 'tree', geometry: { type: 'point', position: at(POC, 5, 5) } },
        { id: 'row', geometry: { type: 'line', coords: [at(POC, 0, 30), at(POC, 13, 30)] } },
      ],
      datasets: ['Google Open Buildings', 'OpenStreetMap'],
    };
    const scene = await new ReadScene({ readWithin: () => Promise.resolve(stored) }).execute(POC, 500);

    expect(scene.centre).toEqual(POC);
    expect(scene.radiusM).toBe(500);
    expect(scene.buildings.map((b) => [b.id, b.heightSource])).toEqual([
      ['measured', 'measured'],
      ['estimated', 'estimated'],
    ]);
    expect(scene.buildings[0]?.heightM).toBe(30);
    expect(scene.lines[0]?.widthM).toBe(LINE_WIDTH_M.residential);
    expect(scene.areas).toEqual(stored.areas);
    expect(scene.trees).toHaveLength(1 + 3);
    expect(scene.attribution).toHaveLength(3);
    expect(scene.spawn.headingDeg).toBe(180);
  });
});

describe('SuggestAddresses', () => {
  const suggestion = (i: number): AddressSuggestion => ({
    id: `osm:N${i}`,
    label: `Avenida Bolonha, ${i}`,
    point: POC,
    kind: 'house',
  });

  function suggestSetup(count = 7, options = { ttlMs: 60_000, maxEntries: 10 }) {
    const clock = new FixedClock();
    const search = vi.fn<Geocoder['search']>(() =>
      Promise.resolve(Array.from({ length: count }, (_, i) => suggestion(i))),
    );
    return { clock, search, suggest: new SuggestAddresses({ search }, clock, options) };
  }

  it('rejects queries that are too short or too long', async () => {
    const { suggest, search } = suggestSetup();
    await expect(suggest.execute('  ab ')).rejects.toMatchObject({ code: 'INVALID_QUERY' });
    await expect(suggest.execute('x'.repeat(201))).rejects.toMatchObject({ code: 'INVALID_QUERY' });
    expect(search).not.toHaveBeenCalled();
  });

  it('returns at most five suggestions and passes the bias through', async () => {
    const { suggest, search } = suggestSetup();
    const result = await suggest.execute('Av.  Bolonha 200', POC);
    expect(result).toHaveLength(5);
    expect(search).toHaveBeenCalledWith({ query: 'Av. Bolonha 200', bias: POC, limit: 5 });
  });

  it('serves repeated queries from the cache until they expire', async () => {
    const { clock, suggest, search } = suggestSetup();
    await suggest.execute('Av. Bolonha 200');
    await suggest.execute(' av. bolonha   200 ');
    expect(search).toHaveBeenCalledTimes(1);
    clock.advance(61);
    await suggest.execute('Av. Bolonha 200');
    expect(search).toHaveBeenCalledTimes(2);
  });

  it('caches per bias and evicts the least recently used entry', async () => {
    const { suggest, search } = suggestSetup(1, { ttlMs: 60_000, maxEntries: 2 });
    await suggest.execute('first query');
    await suggest.execute('first query', { lat: 10, lon: 10 });
    await suggest.execute('first query');
    await suggest.execute('third query');
    await suggest.execute('first query');
    expect(search).toHaveBeenCalledTimes(3);
    await suggest.execute('first query', { lat: 10, lon: 10 });
    expect(search).toHaveBeenCalledTimes(4);
  });

  it('normalises whitespace', () => {
    expect(normaliseQuery('  Rua \t  Bolonha\n200 ')).toBe('Rua Bolonha 200');
  });
});

describe('source errors and call counting', () => {
  it('classifies only SourceError instances', () => {
    expect(classifySourceError(new SourceError('release_not_found', 'missing'))).toBe('release_not_found');
    expect(classifySourceError(new Error('other'))).toBe('unknown');
    expect(classifySourceError('text')).toBe('unknown');
  });

  it('counts every call to the wrapped source', async () => {
    const batch: FeatureBatch = { release: 'r', features: [] };
    const counting = new CountingMapDataSource({ fetch: () => Promise.resolve(batch) });
    const bounds = boundsOfTiles(tilesCovering(POC, 100));
    expect(counting.count()).toBe(0);
    await counting.fetch(bounds, { timeoutMs: 1 });
    await counting.fetch(bounds, { timeoutMs: 1 });
    expect(counting.count()).toBe(2);
  });
});
