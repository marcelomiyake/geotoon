import { API_PREFIX, AreaRequestBodySchema } from '@geotoon/contracts';
import { DomainError, geoPoint, type AreaResult, type GeoPoint } from '@geotoon/core';
import type { FastifyInstance } from 'fastify';
import { toAreaBody } from '../wire.js';

export interface AreaRequester {
  execute(centre: GeoPoint, requestId: string): Promise<AreaResult>;
}

export interface AreaRoutesOptions {
  readonly requestArea: AreaRequester;
  readonly radiusM: number;
  readonly perMinute: number;
}

/** `POST /api/v1/areas`: idempotent; 202 while tiles are fetched, 200 with the scene. */
export function registerAreaRoutes(app: FastifyInstance, options: AreaRoutesOptions): void {
  app.post(
    `${API_PREFIX}/areas`,
    { config: { rateLimit: { max: options.perMinute, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const parsed = AreaRequestBodySchema.safeParse(request.body);
      if (!parsed.success) {
        throw new DomainError(
          'INVALID_COORDINATES',
          'The body must be {"lat": number in -90..90, "lon": number in -180..180}.',
        );
      }
      const centre = geoPoint(parsed.data.lat, parsed.data.lon);
      const started = performance.now();
      const result = await options.requestArea.execute(centre, request.id);
      const complete = result.tiles.filter((t) => t.state === 'complete').length;
      request.log.info(
        {
          status: result.status,
          tiles: result.tiles.length,
          completeTiles: complete,
          sourceCalls: result.sourceCalls,
          durationMs: Math.round(performance.now() - started),
        },
        'area request',
      );
      reply.header('cache-control', 'no-store');
      reply.code(result.status === 'pending' ? 202 : 200);
      return toAreaBody(result, centre, options.radiusM, request.id);
    },
  );
}
