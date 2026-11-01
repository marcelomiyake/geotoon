import { TILE_ZOOM } from '@geotoon/core';
import { pino } from 'pino';
import { compose, type Application } from './composition-root.js';
import { ConfigError, loadConfig, type Config } from './config.js';

const SHUTDOWN_GRACE_MS = 20_000;

function readConfig(): Config {
  try {
    return loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }
}

const config = readConfig();
const logger = pino({ level: config.logLevel, base: { service: 'geotoon-api' } });

let app: Application | undefined;
try {
  app = await compose(config, logger);
  await app.server.listen({ host: '0.0.0.0', port: config.port });
  logger.info(
    {
      gitSha: config.gitSha,
      release: config.overture.release,
      radiusM: config.areaRadiusM,
      tileZoom: TILE_ZOOM,
      storedTiles: app.storedTiles,
      schema: app.migrations.databaseVersion,
      owner: app.owner,
    },
    'geotoon api started',
  );
} catch (error) {
  logger.fatal({ err: error }, 'startup failed');
  process.exit(1);
}

let stopping = false;
function shutdown(signal: string): void {
  if (stopping || app === undefined) {
    return;
  }
  stopping = true;
  logger.info({ signal }, 'shutting down');
  const timer = setTimeout(() => process.exit(1), SHUTDOWN_GRACE_MS);
  timer.unref();
  app
    .close()
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      logger.error({ err: error }, 'shutdown failed');
      process.exit(1);
    });
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
