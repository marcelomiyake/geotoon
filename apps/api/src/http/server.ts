import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { constants as zlib } from 'node:zlib';
import compress from '@fastify/compress';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { API_PREFIX, PROBLEM_MEDIA_TYPE, type Problem } from '@geotoon/contracts';
import { DomainError } from '@geotoon/core';
import Fastify, {
  LogController,
  type FastifyBaseLogger,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import { problemFor } from './problem.js';
import { registerAreaRoutes, type AreaRequester } from './routes/areas.js';
import { registerGeocodeRoutes, type AddressSuggester } from './routes/geocode.js';
import { registerOpsRoutes, type ReadinessReport, type VersionInfo } from './routes/ops.js';

export interface ServerOptions {
  readonly logger: FastifyBaseLogger;
  /** Built web client; omitted in API-only tests. */
  readonly staticDir?: string;
  readonly requestArea: AreaRequester;
  readonly suggest: AddressSuggester;
  readonly radiusM: number;
  readonly rateLimits: { readonly areasPerMinute: number; readonly geocodePerMinute: number };
  readonly readiness: () => Promise<ReadinessReport>;
  readonly version: VersionInfo;
}

const QUIET_ROUTES: ReadonlySet<string> = new Set(['/healthz', '/readyz']);
const IMMUTABLE = 'public, max-age=31536000, immutable';

export async function buildServer(options: ServerOptions): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: options.logger,
    // Fastify's own request logs include the query string (typed addresses); onResponse logs instead.
    logController: new LogController({ disableRequestLogging: true }),
    genReqId: () => randomUUID(),
    requestIdHeader: false,
    trustProxy: false,
  });

  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
    reply.header('server-timing', `app;dur=${reply.elapsedTime.toFixed(1)}`);
  });
  app.addHook('onResponse', async (request, reply) => logResponse(request, reply));

  await app.register(compress, {
    encodings: ['br', 'gzip'],
    threshold: 1024,
    brotliOptions: { params: { [zlib.BROTLI_PARAM_QUALITY]: 4 } },
  });
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: (_request, context) =>
      new DomainError('RATE_LIMITED', 'Too many requests. Wait before trying again.', {
        retryable: true,
        retryAfterSeconds: Math.max(1, Math.ceil(context.ttl / 1000)),
      }),
  });

  app.setErrorHandler(async (error, request, reply) => {
    const problem = toProblem(error, request.id);
    if (problem.status >= 500) {
      request.log.error({ err: error, code: problem.code }, 'request failed');
    } else {
      request.log.info({ code: problem.code, status: problem.status }, 'request rejected');
    }
    return sendProblem(reply, problem);
  });

  registerGeocodeRoutes(app, {
    suggest: options.suggest,
    perMinute: options.rateLimits.geocodePerMinute,
  });
  registerAreaRoutes(app, {
    requestArea: options.requestArea,
    radiusM: options.radiusM,
    perMinute: options.rateLimits.areasPerMinute,
  });
  registerOpsRoutes(app, { readiness: options.readiness, version: options.version });

  const staticRoot =
    options.staticDir !== undefined && existsSync(options.staticDir)
      ? path.resolve(options.staticDir)
      : undefined;
  if (staticRoot !== undefined) {
    await app.register(fastifyStatic, {
      root: staticRoot,
      wildcard: false,
      setHeaders: (staticReply, filePath) => {
        staticReply.header(
          'cache-control',
          filePath.includes(`${path.sep}assets${path.sep}`) ? IMMUTABLE : 'no-cache',
        );
      },
    });
  }

  app.setNotFoundHandler(async (request, reply) => {
    const isPage = request.method === 'GET' && !request.url.startsWith(`${API_PREFIX}/`);
    if (isPage && staticRoot !== undefined) {
      reply.header('cache-control', 'no-cache');
      return reply.sendFile('index.html');
    }
    return sendProblem(reply, problemFor('NOT_FOUND', 'No such resource.', request.id));
  });

  return app;
}

function sendProblem(reply: FastifyReply, problem: Problem): FastifyReply {
  if (problem.retryAfterSeconds !== undefined) {
    reply.header('retry-after', String(problem.retryAfterSeconds));
  }
  return reply.code(problem.status).type(PROBLEM_MEDIA_TYPE).send(problem);
}

/** Maps any thrown value to a problem; internals never reach the client. */
export function toProblem(error: unknown, requestId: string): Problem {
  if (error instanceof DomainError) {
    return problemFor(error.code, error.message, requestId, {
      retryable: error.retryable,
      retryAfterSeconds: error.retryAfterSeconds,
    });
  }
  const status = statusOf(error);
  if (status === 404) {
    return problemFor('NOT_FOUND', 'No such resource.', requestId);
  }
  if (status !== undefined && status >= 400 && status < 500) {
    const detail = error instanceof Error ? error.message : 'The request was not valid.';
    return problemFor('INVALID_QUERY', detail, requestId, { status });
  }
  return problemFor('INTERNAL', 'Unexpected error. Quote the request ID when reporting it.', requestId);
}

function statusOf(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'statusCode' in error) {
    const value = error.statusCode;
    return typeof value === 'number' ? value : undefined;
  }
  return undefined;
}

function logResponse(request: FastifyRequest, reply: FastifyReply): void {
  const route = request.routeOptions.url ?? 'unmatched';
  const fields = {
    method: request.method,
    route,
    statusCode: reply.statusCode,
    durationMs: Math.round(reply.elapsedTime),
  };
  if (QUIET_ROUTES.has(route)) {
    request.log.debug(fields, 'request completed');
  } else {
    request.log.info(fields, 'request completed');
  }
}
