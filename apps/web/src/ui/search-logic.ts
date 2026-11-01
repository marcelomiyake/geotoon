export const MIN_QUERY_CHARS = 3;
export const DEBOUNCE_MS = 300;

/** Parses "lat, lon" (also "lat lon" or "lat;lon"); returns undefined when it is not a pair. */
export function parseLatLon(text: string): { lat: number; lon: number } | undefined {
  const match = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,; ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(text);
  if (!match) {
    return undefined;
  }
  const lat = Number(match[1]);
  const lon = Number(match[2]);
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
