import type { GeoPoint } from '../shared/geo-point.js';

export type SuggestionKind = 'house' | 'street' | 'place' | 'other';

/** One autocomplete suggestion, independent of the geocoder that produced it. */
export interface AddressSuggestion {
  readonly id: string;
  readonly label: string;
  readonly point: GeoPoint;
  readonly kind: SuggestionKind;
}

export interface GeocoderSearch {
  readonly query: string;
  readonly bias?: GeoPoint | undefined;
  readonly limit: number;
}

/** Port implemented by a geocoding adapter (Photon). */
export interface Geocoder {
  search(request: GeocoderSearch): Promise<AddressSuggestion[]>;
}
