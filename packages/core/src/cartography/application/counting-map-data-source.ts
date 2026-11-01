import type { FeatureBatch } from '../domain/features.js';
import type { Bounds } from '../domain/tile-grid.js';
import type { FetchOptions, MapDataSource } from './ports.js';

/**
 * Counts calls to the wrapped source. Counting at the port means DuckDB reads are
 * counted the same way an HTTP call would be: this is the evidence for "fetch once".
 */
export class CountingMapDataSource implements MapDataSource {
  private calls = 0;

  constructor(private readonly inner: MapDataSource) {}

  fetch(bounds: Bounds, options: FetchOptions): Promise<FeatureBatch> {
    this.calls += 1;
    return this.inner.fetch(bounds, options);
  }

  count(): number {
    return this.calls;
  }
}
