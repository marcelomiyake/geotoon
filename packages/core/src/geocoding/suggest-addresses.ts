import { DomainError } from '../shared/domain-error.js';
import type { GeoPoint } from '../shared/geo-point.js';
import type { Clock } from '../shared/ports.js';
import type { AddressSuggestion, Geocoder } from './address-suggestion.js';

export const MIN_QUERY_LENGTH = 3;
export const MAX_QUERY_LENGTH = 200;
export const MAX_SUGGESTIONS = 5;

export interface SuggestAddressesOptions {
  readonly ttlMs: number;
  readonly maxEntries: number;
}

interface CacheEntry {
  readonly expiresAt: number;
  readonly value: AddressSuggestion[];
}

const DEFAULT_OPTIONS: SuggestAddressesOptions = { ttlMs: 10 * 60 * 1000, maxEntries: 1000 };

/**
 * Validates a typed query and returns at most five suggestions. Results are cached
 * for a short time so repeated keystrokes do not reach the public geocoder again.
 */
export class SuggestAddresses {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly geocoder: Geocoder,
    private readonly clock: Clock,
    private readonly options: SuggestAddressesOptions = DEFAULT_OPTIONS,
  ) {}

  async execute(rawQuery: string, bias?: GeoPoint): Promise<AddressSuggestion[]> {
    const query = normaliseQuery(rawQuery);
    if (query.length < MIN_QUERY_LENGTH || query.length > MAX_QUERY_LENGTH) {
      throw new DomainError(
        'INVALID_QUERY',
        `Query must be between ${MIN_QUERY_LENGTH} and ${MAX_QUERY_LENGTH} characters.`,
      );
    }
    const key = cacheKey(query, bias);
    const now = this.clock.now().getTime();
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > now) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached.value;
    }
    const suggestions = await this.geocoder.search({ query, bias, limit: MAX_SUGGESTIONS });
    const value = suggestions.slice(0, MAX_SUGGESTIONS);
    this.remember(key, { expiresAt: now + this.options.ttlMs, value });
    return value;
  }

  private remember(key: string, entry: CacheEntry): void {
    this.cache.delete(key);
    this.cache.set(key, entry);
    while (this.cache.size > this.options.maxEntries) {
      const oldest = this.cache.keys().next();
      if (oldest.done === true) {
        return;
      }
      this.cache.delete(oldest.value);
    }
  }
}

export function normaliseQuery(raw: string): string {
  return raw.trim().replaceAll(/\s+/g, ' ');
}

function cacheKey(query: string, bias: GeoPoint | undefined): string {
  const biasKey = bias ? `${bias.lat.toFixed(2)},${bias.lon.toFixed(2)}` : '-';
  return `${query.toLowerCase()}|${biasKey}`;
}
