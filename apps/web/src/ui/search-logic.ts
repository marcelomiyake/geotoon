import { ApiProblem } from '../api/client.js';

export const MIN_QUERY_CHARS = 3;
export const DEBOUNCE_MS = 300;
/** A signed decimal degree such as -23.5485 (no exponent, no thousands separator). */
const DECIMAL_DEGREES = /^-?\d{1,3}(?:\.\d+)?$/;

/** Parses "lat, lon" (also "lat lon" or "lat;lon"); returns undefined when it is not a pair. */
export function parseLatLon(text: string): { lat: number; lon: number } | undefined {
  const parts = text.trim().split(/[\s,;]+/);
  const [latText, lonText] = parts;
  if (parts.length !== 2 || latText === undefined || lonText === undefined) {
    return undefined;
  }
  if (!DECIMAL_DEGREES.test(latText) || !DECIMAL_DEGREES.test(lonText)) {
    return undefined;
  }
  const lat = Number(latText);
  const lon = Number(lonText);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return undefined;
  }
  return { lat, lon };
}

export function shouldSearch(query: string): boolean {
  return query.trim().length >= MIN_QUERY_CHARS && parseLatLon(query) === undefined;
}

export interface Debounced<A extends unknown[]> {
  (...args: A): void;
  cancel(): void;
}

/** Calls `fn` once `waitMs` has passed without another call. */
export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  waitMs: number,
  timers: {
    set: (callback: () => void, ms: number) => unknown;
    clear: (handle: unknown) => void;
  } = {
    set: (callback, ms) => setTimeout(callback, ms),
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  },
): Debounced<A> {
  let handle: unknown;
  const debounced = (...args: A): void => {
    if (handle !== undefined) {
      timers.clear(handle);
    }
    handle = timers.set(() => {
      handle = undefined;
      fn(...args);
    }, waitMs);
  };
  debounced.cancel = (): void => {
    if (handle !== undefined) {
      timers.clear(handle);
      handle = undefined;
    }
  };
  return debounced;
}

/** Moves the active option with arrow keys, wrapping at both ends; -1 means none. */
export function nextIndex(current: number, count: number, key: 'ArrowDown' | 'ArrowUp'): number {
  if (count === 0) {
    return -1;
  }
  if (key === 'ArrowDown') {
    return current + 1 >= count ? 0 : current + 1;
  }
  return current <= 0 ? count - 1 : current - 1;
}

/** Reads `?lat=&lon=` and `?debug=1` from a query string. */
export function readUrlState(search: string): { point?: { lat: number; lon: number }; debug: boolean } {
  const params = new URLSearchParams(search);
  const debug = params.get('debug') === '1';
  const lat = params.get('lat');
  const lon = params.get('lon');
  const point = lat !== null && lon !== null ? parseLatLon(`${lat},${lon}`) : undefined;
  return point ? { point, debug } : { debug };
}

/** What the search box says when a lookup fails. */
export function searchErrorMessage(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'GEOCODER_RATE_LIMITED':
      case 'RATE_LIMITED':
        return 'Too many searches. Wait a few seconds and type again.';
      case 'GEOCODER_UNAVAILABLE':
        return 'Address search is unavailable. You can paste coordinates as "lat, lon".';
      default:
        return `Search failed: ${error.message}`;
    }
  }
  return 'Search failed. Check the connection and try again.';
}
