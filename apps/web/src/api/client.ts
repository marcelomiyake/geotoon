import {
  API_PREFIX,
  AreaPendingSchema,
  AreaReadySchema,
  GeocodeResponseSchema,
  ProblemSchema,
  type AreaPending,
  type AreaReady,
  type ErrorCode,
  type Suggestion,
} from '@geotoon/contracts';

/** A problem response (or a client-side failure) with a stable code and request ID. */
export class ApiProblem extends Error {
  constructor(
    readonly code: ErrorCode | 'NETWORK' | 'BAD_RESPONSE',
    message: string,
    readonly requestId?: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'ApiProblem';
  }
}

export interface AreaProgress {
  readonly requestId: string;
  readonly completeTiles: number;
  readonly totalTiles: number;
  readonly elapsedMs: number;
}

export type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>;

export const abortableSleep: Sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason as Error);
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason as Error);
      },
      { once: true },
    );
  });

export interface ApiClientOptions {
  readonly fetch?: typeof fetch;
  readonly sleep?: Sleep;
  readonly now?: () => number;
  readonly baseUrl?: string;
}

export class ApiClient {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: Sleep;
  private readonly now: () => number;
  private readonly baseUrl: string;

  constructor(options: ApiClientOptions = {}) {
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.sleep = options.sleep ?? abortableSleep;
    this.now = options.now ?? (() => Date.now());
    this.baseUrl = options.baseUrl ?? '';
  }

  async suggest(query: string, signal?: AbortSignal, bias?: { lat: number; lon: number }): Promise<Suggestion[]> {
    const params = new URLSearchParams({ q: query });
    if (bias) {
      params.set('lat', bias.lat.toFixed(4));
      params.set('lon', bias.lon.toFixed(4));
    }
    const response = await this.request(`${API_PREFIX}/geocode?${params.toString()}`, { signal });
    const body = await this.json(response);
    const parsed = GeocodeResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiProblem('BAD_RESPONSE', 'The address service returned an unexpected response.');
    }
    return parsed.data.suggestions;
  }

  /** Polls `POST /areas` until the scene is ready, a problem is returned, or `signal` aborts. */
  async loadArea(
    lat: number,
    lon: number,
    onProgress: (progress: AreaProgress) => void,
    signal?: AbortSignal,
  ): Promise<AreaReady> {
    return this.pollArea({ lat, lon, onProgress, signal, started: this.now() });
  }

  /** One `POST /areas`; while the area is pending, reports progress, waits and asks again. */
  private async pollArea(poll: {
    lat: number;
    lon: number;
    onProgress: (progress: AreaProgress) => void;
    signal: AbortSignal | undefined;
    started: number;
  }): Promise<AreaReady> {
    const response = await this.request(`${API_PREFIX}/areas`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lat: poll.lat, lon: poll.lon }),
      signal: poll.signal,
    });
    const body = await this.json(response);
    if (response.status === 200) {
      const ready = AreaReadySchema.safeParse(body);
      if (!ready.success) {
        throw new ApiProblem('BAD_RESPONSE', 'The map data had an unexpected shape.');
      }
      return ready.data;
    }
    const pending = AreaPendingSchema.safeParse(body);
    if (!pending.success) {
      throw new ApiProblem('BAD_RESPONSE', 'The server returned an unexpected response.');
    }
    poll.onProgress(progressOf(pending.data, this.now() - poll.started));
    await this.sleep(pending.data.pollAfterMs, poll.signal);
    return this.pollArea(poll);
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, init);
    } catch (error) {
      if (init.signal?.aborted) {
        throw error;
      }
      throw new ApiProblem('NETWORK', 'The GeoToon server could not be reached.');
    }
    if (!response.ok) {
      throw await toProblem(response);
    }
    return response;
  }

  private async json(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      throw new ApiProblem('BAD_RESPONSE', 'The server returned an unreadable response.');
    }
  }
}

function progressOf(pending: AreaPending, elapsedMs: number): AreaProgress {
  return {
    requestId: pending.requestId,
    completeTiles: pending.tiles.filter((t) => t.state === 'complete').length,
    totalTiles: pending.tiles.length,
    elapsedMs,
  };
}

async function toProblem(response: Response): Promise<ApiProblem> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  const problem = ProblemSchema.safeParse(body);
  if (problem.success) {
    return new ApiProblem(
      problem.data.code,
      problem.data.detail,
      problem.data.requestId,
      problem.data.retryAfterSeconds,
    );
  }
  return new ApiProblem('BAD_RESPONSE', `The server answered ${response.status}.`);
}
