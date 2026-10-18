import type { LogLevel } from '../config/env.js';

// Minimal structured logger (one JSON line per entry). Never log session
// tokens, game seeds or card faces.

export interface Logger {
  error(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  debug(message: string, meta?: Record<string, unknown>): void;
}

const RANK: Record<Exclude<LogLevel, 'silent'>, number> = { error: 0, warn: 1, info: 2, debug: 3 };

export function createLogger(level: LogLevel, write: (line: string) => void = (line) => process.stdout.write(`${line}\n`)): Logger {
  const max = level === 'silent' ? -1 : RANK[level];
  const log = (entryLevel: Exclude<LogLevel, 'silent'>) => (message: string, meta?: Record<string, unknown>) => {
    if (RANK[entryLevel] > max) return;
    write(JSON.stringify({ time: new Date().toISOString(), level: entryLevel, message, ...serializeMeta(meta) }));
  };
  return { error: log('error'), warn: log('warn'), info: log('info'), debug: log('debug') };
}

export const silentLogger: Logger = createLogger('silent');

function serializeMeta(meta: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!meta) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    out[key] = value instanceof Error ? { name: value.name, message: value.message, stack: value.stack } : value;
  }
  return out;
}
