import {
  DomainError,
  geoPoint,
  type AddressSuggestion,
  type Geocoder,
  type GeocoderSearch,
  type SuggestionKind,
} from '@geotoon/core';

export interface PhotonConfig {
  readonly url: string;
  readonly timeoutMs: number;
  readonly userAgent: string;
}

interface PhotonProperties {
  readonly osm_type?: string;
  readonly osm_id?: number;
  readonly type?: string;
  readonly name?: string;
  readonly housenumber?: string;
  readonly street?: string;
  readonly district?: string;
  readonly locality?: string;
  readonly city?: string;
  readonly state?: string;
  readonly country?: string;
  readonly countrycode?: string;
}

interface PhotonFeature {
  readonly geometry?: { readonly type?: string; readonly coordinates?: readonly number[] };
  readonly properties?: PhotonProperties;
}

interface PhotonResponse {
  readonly features?: readonly PhotonFeature[];
}

const PLACE_TYPES: ReadonlySet<string> = new Set([
  'city',
  'district',
  'locality',
  'county',
  'state',
  'country',
]);

/** `Geocoder` adapter for the public Photon API (OpenStreetMap data, no key). */
export class PhotonGeocoder implements Geocoder {
  constructor(
    private readonly config: PhotonConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async search(request: GeocoderSearch): Promise<AddressSuggestion[]> {
    const url = new URL('/api/', this.config.url);
    url.searchParams.set('q', request.query);
    url.searchParams.set('limit', String(request.limit));
    url.searchParams.set('lang', 'default');
    if (request.bias) {
      url.searchParams.set('lat', request.bias.lat.toFixed(4));
      url.searchParams.set('lon', request.bias.lon.toFixed(4));
    }
    const response = await this.get(url);
    if (response.status === 429) {
      throw new DomainError('GEOCODER_RATE_LIMITED', 'The address service is busy. Try again shortly.', {
        retryable: true,
        retryAfterSeconds: retryAfter(response.headers.get('retry-after')),
      });
    }
    if (!response.ok) {
      throw unavailable(`Photon answered ${response.status}`);
    }
    let body: PhotonResponse;
    try {
      body = (await response.json()) as PhotonResponse;
    } catch (error) {
      throw unavailable('Photon returned an unreadable body', error);
    }
    return (body.features ?? []).flatMap((feature, index) => toSuggestion(feature, index));
  }

  private async get(url: URL): Promise<Response> {
    try {
      return await this.fetchImpl(url, {
        headers: { 'user-agent': this.config.userAgent, accept: 'application/json' },
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error) {
      throw unavailable('Photon could not be reached', error);
    }
  }
}

function unavailable(message: string, cause?: unknown): DomainError {
  return new DomainError('GEOCODER_UNAVAILABLE', 'The address service is unavailable.', {
    retryable: true,
    cause: cause ?? new Error(message),
  });
}

function retryAfter(header: string | null): number | undefined {
  const seconds = header === null ? Number.NaN : Number(header);
  return Number.isInteger(seconds) && seconds > 0 ? seconds : undefined;
}

export function suggestionKind(type: string | undefined): SuggestionKind {
  if (type === 'house' || type === 'street') {
    return type;
  }
  return type !== undefined && PLACE_TYPES.has(type) ? 'place' : 'other';
}

/** Name, street and number, district, city, state, country; empty and repeated parts dropped. */
export function buildLabel(p: PhotonProperties): string {
  const street = p.street && p.housenumber ? `${p.street}, ${p.housenumber}` : p.street;
  const parts = [p.name, street, p.district ?? p.locality, p.city, p.state, p.country];
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const part of parts) {
    const value = part?.trim();
    if (value && !seen.has(value.toLowerCase())) {
      seen.add(value.toLowerCase());
      kept.push(value);
    }
  }
  return kept.join(', ');
}

function toSuggestion(feature: PhotonFeature, index: number): AddressSuggestion[] {
  const coords = feature.geometry?.coordinates;
  const lon = coords?.[0];
  const lat = coords?.[1];
  if (feature.geometry?.type !== 'Point' || lon === undefined || lat === undefined) {
    return [];
  }
  const properties = feature.properties ?? {};
  const label = buildLabel(properties);
  if (label === '') {
    return [];
  }
  let point;
  try {
    point = geoPoint(lat, lon);
  } catch {
    return [];
  }
  const id =
    properties.osm_type && properties.osm_id !== undefined
      ? `${properties.osm_type}${properties.osm_id}`
      : `photon-${index}`;
  const countryCode = properties.countrycode?.trim().toUpperCase();
  const city = (properties.city ?? (properties.type === 'city' ? properties.name : undefined))?.trim();
  const locality = countryCode !== undefined && /^[A-Z]{2}$/.test(countryCode)
    ? { countryCode, ...(city ? { city: city.slice(0, 120) } : {}) }
    : undefined;
  return [{ id, label, point, kind: suggestionKind(properties.type), ...(locality ? { locality } : {}) }];
}
