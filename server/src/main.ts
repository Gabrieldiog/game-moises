import { loadConfig } from './config/env.js';
import { createGameServer } from './net/server.js';
import { createLogger } from './util/log.js';

// Entry point: validate the configuration (fail fast), start listening, and
// shut down cleanly on SIGINT / SIGTERM.

let config;
try {
  config = loadConfig(process.env);
} catch (error) {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exit(1);
}

const logger = createLogger(config.server.logLevel);
let server: ReturnType<typeof createGameServer>;
try {
  server = createGameServer({ config: config.server, rules: config.rules, logger });
} catch (error) {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exit(1);
}

process.on('unhandledRejection', (reason) => logger.error('unhandled rejection', { error: reason }));

const address = await server.listen();
logger.info('server listening', {
  host: address.address,
  port: address.port,
  env: config.server.nodeEnv,
  corsOrigins: config.server.corsOrigins,
});

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    if (stopping) return;
    stopping = true;
    logger.info('shutting down', { signal });
    const force = setTimeout(() => process.exit(1), 5_000);
    force.unref();
    server.close().then(
      () => process.exit(0),
      (error: unknown) => {
        logger.error('shutdown failed', { error });
        process.exit(1);
      },
    );
  });
}
