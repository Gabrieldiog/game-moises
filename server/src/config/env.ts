import { z } from 'zod';
import { ROOM_CODE_LIMITS } from '@moises/shared';
import { loadRules, type Env, type RulesConfig } from './rules.js';

// Server (infrastructure) settings, read from the environment once at startup
// and validated with Zod. Any invalid value stops the process with a message
// naming the variable. Game rules live in rules.ts (MOISES_* variables).
// There are no secrets here: session tokens and game seeds are generated at
// runtime and never configured.

export const LOG_LEVELS = ['silent', 'error', 'warn', 'info', 'debug'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const NODE_ENVS = ['development', 'production', 'test'] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];

export interface RateLimitConfig {
  /** Messages a connection may send in a burst. */
  readonly burst: number;
  /** Sustained messages per second. */
  readonly perSecond: number;
  /** Consecutive refused messages before the connection is closed. */
  readonly disconnectAfter: number;
}

export interface JoinFailureConfig {
  /** Wrong room codes one address may try inside the window before joining is refused. */
  readonly max: number;
  readonly windowMs: number;
}

export interface ServerConfig {
  readonly nodeEnv: NodeEnv;
  readonly host: string;
  /** 0 = any free port (tests). */
  readonly port: number;
  /** Allowed browser origins, or '*' (never accepted in production). */
  readonly corsOrigins: '*' | readonly string[];
  /** Reverse proxies in front of the server whose X-Forwarded-For can be trusted (0 = none). */
  readonly trustProxyHops: number;
  readonly logLevel: LogLevel;
  readonly limits: {
    /** Largest Socket.IO message accepted (bytes). */
    readonly maxMessageBytes: number;
    readonly maxConnections: number;
    readonly maxConnectionsPerIp: number;
    readonly maxRooms: number;
    /** Rooms that may exist at once created from the same address. */
    readonly maxRoomsPerIp: number;
    readonly rateLimit: RateLimitConfig;
    /** Per address: limits guessing room codes (see FailureLimiter). */
    readonly joinFailures: JoinFailureConfig;
  };
  readonly rooms: {
    readonly codeLength: number;
    /** A room with no human activity for this long is closed. */
    readonly idleTtlMs: number;
    /** A room with no connected human for this long is closed. */
    readonly emptyTtlMs: number;
    /** In the lobby, a disconnected human loses the seat after this long. */
    readonly lobbyReconnectGraceMs: number;
    readonly sweepIntervalMs: number;
  };
  readonly bots: {
    /** Bots wait a random time in [minDelayMs, maxDelayMs] before each move, to feel natural. */
    readonly minDelayMs: number;
    readonly maxDelayMs: number;
  };
}

/** Every variable read by loadServerConfig (server/.env.example lists them all). */
export const SERVER_ENV_VARS = [
  'NODE_ENV',
  'HOST',
  'PORT',
  'CORS_ORIGIN',
  'TRUST_PROXY_HOPS',
  'LOG_LEVEL',
  'MAX_MESSAGE_BYTES',
  'MAX_CONNECTIONS',
  'MAX_CONNECTIONS_PER_IP',
  'MAX_ROOMS',
  'MAX_ROOMS_PER_IP',
  'RATE_LIMIT_BURST',
  'RATE_LIMIT_PER_SECOND',
  'RATE_LIMIT_DISCONNECT_AFTER',
  'JOIN_FAIL_MAX',
  'JOIN_FAIL_WINDOW_MS',
  'ROOM_CODE_LENGTH',
  'ROOM_IDLE_TTL_MS',
  'ROOM_EMPTY_TTL_MS',
  'LOBBY_RECONNECT_GRACE_MS',
  'ROOM_SWEEP_INTERVAL_MS',
  'BOT_DELAY_MIN_MS',
  'BOT_DELAY_MAX_MS',
] as const;

const DEV_CORS_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'] as const;

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** Optional whole number with a default; empty means "use the default". */
function wholeNumber(defaultValue: number, min: number, max: number) {
  return z
    .string()
    .optional()
    .transform((raw) => (raw === undefined || raw.trim() === '' ? String(defaultValue) : raw.trim()))
    .pipe(z.string().regex(/^\d+$/, 'must be a whole number'))
    .transform(Number)
    .pipe(z.number().int().min(min).max(max));
}

function optionalEnum<const T extends readonly [string, ...string[]]>(values: T, defaultValue: T[number]) {
  return z
    .string()
    .optional()
    .transform((raw) => (raw === undefined || raw.trim() === '' ? defaultValue : raw.trim()))
    .pipe(z.enum(values));
}

const HostSchema = z
  .string()
  .optional()
  .transform((raw) => (raw === undefined || raw.trim() === '' ? '0.0.0.0' : raw.trim()))
  .pipe(z.string().max(255).regex(/^[A-Za-z0-9.:_[\]-]+$/, 'must be a host name or IP address'));

/** "a,b" -> ['a', 'b'] (each a bare http(s) origin), or '*'. Empty -> undefined (decided later). */
const CorsSchema = z
  .string()
  .optional()
  .transform((raw, ctx): '*' | string[] | undefined => {
    if (raw === undefined || raw.trim() === '') return undefined;
    const items = raw
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item !== '');
    if (items.includes('*')) {
      if (items.length > 1) ctx.addIssue({ code: 'custom', message: '"*" cannot be combined with other origins' });
      return '*';
    }
    for (const item of items) {
      if (!isBareOrigin(item)) {
        ctx.addIssue({ code: 'custom', message: 'each origin must look like https://example.com (no path, no trailing slash)' });
      }
    }
    return items;
  });

function isBareOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === value;
  } catch {
    return false;
  }
}

const EnvSchema = z
  .object({
    NODE_ENV: optionalEnum(NODE_ENVS, 'development'),
    HOST: HostSchema,
    PORT: wholeNumber(3000, 0, 65_535),
    CORS_ORIGIN: CorsSchema,
    TRUST_PROXY_HOPS: wholeNumber(0, 0, 10),
    LOG_LEVEL: optionalEnum(LOG_LEVELS, 'info'),
    MAX_MESSAGE_BYTES: wholeNumber(16_384, 1_024, 1_048_576),
    MAX_CONNECTIONS: wholeNumber(2_000, 1, 1_000_000),
    MAX_CONNECTIONS_PER_IP: wholeNumber(20, 1, 10_000),
    MAX_ROOMS: wholeNumber(500, 1, 100_000),
    MAX_ROOMS_PER_IP: wholeNumber(5, 1, 10_000),
    RATE_LIMIT_BURST: wholeNumber(20, 1, 10_000),
    RATE_LIMIT_PER_SECOND: wholeNumber(10, 1, 10_000),
    RATE_LIMIT_DISCONNECT_AFTER: wholeNumber(50, 1, 1_000_000),
    JOIN_FAIL_MAX: wholeNumber(20, 1, 10_000),
    JOIN_FAIL_WINDOW_MS: wholeNumber(5 * MINUTE, 1_000, DAY),
    ROOM_CODE_LENGTH: wholeNumber(6, ROOM_CODE_LIMITS.minLength, ROOM_CODE_LIMITS.maxLength),
    ROOM_IDLE_TTL_MS: wholeNumber(30 * MINUTE, 1_000, DAY),
    ROOM_EMPTY_TTL_MS: wholeNumber(2 * MINUTE, 1_000, DAY),
    LOBBY_RECONNECT_GRACE_MS: wholeNumber(MINUTE, 1_000, DAY),
    ROOM_SWEEP_INTERVAL_MS: wholeNumber(15_000, 100, 10 * MINUTE),
    BOT_DELAY_MIN_MS: wholeNumber(600, 0, 10_000),
    BOT_DELAY_MAX_MS: wholeNumber(1_400, 0, 10_000),
  })
  .superRefine((env, ctx) => {
    if (env.BOT_DELAY_MAX_MS < env.BOT_DELAY_MIN_MS) {
      ctx.addIssue({ code: 'custom', path: ['BOT_DELAY_MAX_MS'], message: 'must be >= BOT_DELAY_MIN_MS' });
    }
    if (env.NODE_ENV === 'production') {
      if (env.CORS_ORIGIN === undefined) {
        ctx.addIssue({ code: 'custom', path: ['CORS_ORIGIN'], message: 'is required in production (comma-separated origins)' });
      } else if (env.CORS_ORIGIN === '*') {
        ctx.addIssue({ code: 'custom', path: ['CORS_ORIGIN'], message: '"*" is not allowed in production' });
      }
    }
  });

/** Reads and validates the server settings. Throws one error listing every problem. */
export function loadServerConfig(env: Env = process.env): ServerConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    // Only variable names and the rule they break are reported, never the values.
    const problems = parsed.error.issues.map((issue) => `${issue.path.join('.') || '(env)'} ${issue.message}`);
    throw new Error(`Invalid server environment: ${problems.join('; ')}`);
  }
  const e = parsed.data;
  return deepFreeze({
    nodeEnv: e.NODE_ENV,
    host: e.HOST,
    port: e.PORT,
    corsOrigins: e.CORS_ORIGIN ?? [...DEV_CORS_ORIGINS],
    trustProxyHops: e.TRUST_PROXY_HOPS,
    logLevel: e.LOG_LEVEL,
    limits: {
      maxMessageBytes: e.MAX_MESSAGE_BYTES,
      maxConnections: e.MAX_CONNECTIONS,
      maxConnectionsPerIp: e.MAX_CONNECTIONS_PER_IP,
      maxRooms: e.MAX_ROOMS,
      maxRoomsPerIp: e.MAX_ROOMS_PER_IP,
      rateLimit: {
        burst: e.RATE_LIMIT_BURST,
        perSecond: e.RATE_LIMIT_PER_SECOND,
        disconnectAfter: e.RATE_LIMIT_DISCONNECT_AFTER,
      },
      joinFailures: { max: e.JOIN_FAIL_MAX, windowMs: e.JOIN_FAIL_WINDOW_MS },
    },
    rooms: {
      codeLength: e.ROOM_CODE_LENGTH,
      idleTtlMs: e.ROOM_IDLE_TTL_MS,
      emptyTtlMs: e.ROOM_EMPTY_TTL_MS,
      lobbyReconnectGraceMs: e.LOBBY_RECONNECT_GRACE_MS,
      sweepIntervalMs: e.ROOM_SWEEP_INTERVAL_MS,
    },
    bots: { minDelayMs: e.BOT_DELAY_MIN_MS, maxDelayMs: e.BOT_DELAY_MAX_MS },
  });
}

export interface AppConfig {
  readonly server: ServerConfig;
  readonly rules: RulesConfig;
}

/** Server settings and game rules for this process. Throws (fail fast) listing what is wrong. */
export function loadConfig(env: Env = process.env): AppConfig {
  const problems: string[] = [];
  let server: ServerConfig | undefined;
  let rules: RulesConfig | undefined;
  try {
    server = loadServerConfig(env);
  } catch (error) {
    problems.push((error as Error).message);
  }
  try {
    rules = loadRules(env);
  } catch (error) {
    problems.push((error as Error).message);
  }
  if (!server || !rules) throw new Error(problems.join('\n'));
  return { server, rules };
}

/** Whether a browser Origin header is allowed. Requests without Origin (non-browser clients) are allowed. */
export function isOriginAllowed(origin: string | undefined, allowed: ServerConfig['corsOrigins']): boolean {
  if (origin === undefined) return true;
  if (allowed === '*') return true;
  return allowed.includes(origin);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
