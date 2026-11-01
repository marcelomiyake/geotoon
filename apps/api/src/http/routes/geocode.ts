import { API_PREFIX, GeocodeQuerySchema, type GeocodeResponse } from '@geotoon/contracts';
import { DomainError, geoPoint, type AddressSuggestion, type GeoPoint } from '@geotoon/core';
import type { FastifyInstance } from 'fastify';

export interface AddressSuggester {
  execute(query: string, bias?: GeoPoint): Promise<AddressSuggestion[]>;
}

export interface GeocodeRoutesOptions {
  readonly suggest: AddressSuggester;
  readonly perMinute: number;
}

/** `GET /api/v1/geocode?q=…[&lat=…&lon=…]`: up to five address suggestions. */
export function registerGeocodeRoutes(app: FastifyInstance, options: GeocodeRoutesOptions): void {
  app.get(
    `${API_PREFIX}/geocode`,
    { config: { rateLimit: { max: options.perMinute, timeWindow: '1 minute' } } },
    async (request, reply): Promise<GeocodeResponse> => {
      const parsed = GeocodeQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new DomainError(
          'INVALID_QUERY',
          'q must be 3 to 200 characters; lat and lon, when given, must be valid coordinates.',
        );
      }
      const { q, lat, lon } = parsed.data;
      const bias = lat !== undefined && lon !== undefined ? geoPoint(lat, lon) : undefined;
      const suggestions = await options.suggest.execute(q, bias);
      reply.header('cache-control', 'private, max-age=300');
      return {
        suggestions: suggestions.map((s) => ({
          id: s.id,
          label: s.label,
          lat: s.point.lat,
          lon: s.point.lon,
          kind: s.kind,
        })),
      };
    },
  );
}
