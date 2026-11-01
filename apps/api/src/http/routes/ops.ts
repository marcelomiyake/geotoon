import type { FastifyInstance } from 'fastify';

export interface ReadinessReport {
  readonly ready: boolean;
  readonly checks: Readonly<Record<string, string>>;
}

export interface VersionInfo {
  readonly version: string;
  readonly gitSha: string;
  readonly contractVersion: number;
  readonly overtureRelease: string;
  readonly radiusM: number;
  readonly tileZoom: number;
}

export interface OpsRoutesOptions {
  readonly readiness: () => Promise<ReadinessReport>;
  readonly version: VersionInfo;
}

/** Liveness, readiness and version. Readiness never calls Photon or S3. */
export function registerOpsRoutes(app: FastifyInstance, options: OpsRoutesOptions): void {
  app.get('/healthz', async () => ({ status: 'ok' }));

  app.get('/readyz', async (_request, reply) => {
    const report = await options.readiness();
    reply.header('cache-control', 'no-store');
    reply.code(report.ready ? 200 : 503);
    return report;
  });

  app.get('/version', async () => options.version);
}
