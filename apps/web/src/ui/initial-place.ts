import type { Locality } from '@geotoon/contracts';
import type { PickedPlace } from './search-box.js';

/** Photon location for MASP, whose official address is Avenida Paulista, 1578. */
export const DEFAULT_PLACE: PickedPlace = {
  lat: -23.561496,
  lon: -46.655968,
  label: 'Av. Paulista, 1578 — MASP, São Paulo',
  locality: { countryCode: 'BR', city: 'São Paulo' },
};

/** Shared coordinates take precedence over the initial address. */
export function initialPlace(point?: { lat: number; lon: number; locality?: Locality }): PickedPlace {
  return point ? { ...point, label: `${point.lat}, ${point.lon}` } : DEFAULT_PLACE;
}
