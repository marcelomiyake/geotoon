import { z } from 'zod';

export const APP_VERSION = '0.1.0';

const port = z.coerce.number().int().min(1).max(65_535);
const positiveInt = z.coerce.number().int().positive();
const emptyAsUndefined = (value: unknown): unknown => (value === '' ? undefined : value);

const EnvSchema = z
  .object({
    PORT: port.default(8080),
    STATIC_DIR: z.string().min(1).default('apps/web/dist'),
    MIGRATIONS_DIR: z.preprocess(emptyAsUndefined, z.string().min(1).optional()),
    DATABASE_HOST: z.string().min(1).default('localhost'),
    DATABASE_PORT: port.default(5432),
    DATABASE_NAME: z.string().min(1).default('geotoon'),
    DATABASE_USER: z.string().min(1).default('geotoon'),
    DATABASE_PASSWORD: z.string().min(1),
    OVERTURE_BASE_URL: z.string().min(1).default('s3://overturemaps-us-west-2/release'),
    OVERTURE_RELEASE: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}\.\d+$/, 'must look like 2026-10-21.0')
      .default('2026-10-21.0'),
    OVERTURE_QUERY_TIMEOUT_S: positiveInt.max(170).default(120),
    AREA_RADIUS_M: positiveInt.default(2000),
    AREA_RADIUS_MAX_M: positiveInt.default(2000),
    PHOTON_URL: z.url().default('https://photon.komoot.io'),
    PHOTON_TIMEOUT_MS: positiveInt.default(4000),
    USER_AGENT: z
      .string()
      .min(1)
      .default(`geotoon/${APP_VERSION} (+https://github.com/marcelomiyake/geotoon)`),
    DUCKDB_MEMORY_LIMIT: z.string().min(1).default('1GB'),
    DUCKDB_THREADS: positiveInt.default(4),
    DUCKDB_EXTENSION_DIR: z.preprocess(emptyAsUndefined, z.string().min(1).optional()),
    DUCKDB_TEMP_DIR: z.string().min(1).default('/tmp/duckdb'),
    RATE_LIMIT_AREAS_PER_MIN: positiveInt.default(30),
    RATE_LIMIT_GEOCODE_PER_MIN: positiveInt.default(60),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    GIT_SHA: z.string().default('unknown'),
  })
  .refine((env) => env.AREA_RADIUS_M <= env.AREA_RADIUS_MAX_M, {
    message: 'AREA_RADIUS_M must not exceed AREA_RADIUS_MAX_M',
    path: ['AREA_RADIUS_M'],
  });

export type Env = z.infer<typeof EnvSchema>;

export interface Config {
  readonly port: number;
  readonly staticDir: string;
  readonly migrationsDir: string | undefined;
  readonly database: {
    readonly host: string;
    readonly port: number;
    readonly database: string;
    readonly user: string;
    readonly password: string;
  };
  readonly overture: {
    readonly baseUrl: string;
    readonly release: string;
    readonly timeoutMs: number;
  };
  readonly areaRadiusM: number;
  readonly photon: { readonly url: string; readonly timeoutMs: number };
  readonly userAgent: string;
  readonly duckdb: {
    readonly memoryLimit: string;
    readonly threads: number;
    readonly extensionDirectory: string | undefined;
    readonly tempDirectory: string;
  };
  readonly rateLimits: { readonly areasPerMinute: number; readonly geocodePerMinute: number };
  readonly logLevel: Env['LOG_LEVEL'];
  readonly gitSha: string;
}

export class ConfigError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`Invalid configuration:\n  ${problems.join('\n  ')}`);
    this.name = 'ConfigError';
  }
}

/** Validates the environment once; every invalid variable is reported together. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    );
  }
  const e = parsed.data;
  return {
    port: e.PORT,
    staticDir: e.STATIC_DIR,
    migrationsDir: e.MIGRATIONS_DIR,
    database: {
      host: e.DATABASE_HOST,
      port: e.DATABASE_PORT,
      database: e.DATABASE_NAME,
      user: e.DATABASE_USER,
      password: e.DATABASE_PASSWORD,
    },
    overture: {
      baseUrl: e.OVERTURE_BASE_URL.replace(/\/+$/, ''),
      release: e.OVERTURE_RELEASE,
      timeoutMs: e.OVERTURE_QUERY_TIMEOUT_S * 1000,
    },
    areaRadiusM: e.AREA_RADIUS_M,
    photon: { url: e.PHOTON_URL.replace(/\/+$/, ''), timeoutMs: e.PHOTON_TIMEOUT_MS },
    userAgent: e.USER_AGENT,
    duckdb: {
      memoryLimit: e.DUCKDB_MEMORY_LIMIT,
      threads: e.DUCKDB_THREADS,
      extensionDirectory: e.DUCKDB_EXTENSION_DIR,
      tempDirectory: e.DUCKDB_TEMP_DIR,
    },
    rateLimits: {
      areasPerMinute: e.RATE_LIMIT_AREAS_PER_MIN,
      geocodePerMinute: e.RATE_LIMIT_GEOCODE_PER_MIN,
    },
    logLevel: e.LOG_LEVEL,
    gitSha: e.GIT_SHA,
  };
}
