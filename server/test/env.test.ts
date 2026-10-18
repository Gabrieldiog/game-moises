import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SERVER_ENV_VARS, isOriginAllowed, loadConfig, loadServerConfig } from '../src/config/env.js';
import { DEFAULT_RULES, TIMING_ENV_VARS } from '../src/config/rules.js';

describe('loadServerConfig', () => {
  it('has safe defaults for development (no "*")', () => {
    const config = loadServerConfig({});
    expect(config.nodeEnv).toBe('development');
    expect(config.port).toBe(3000);
    expect(config.corsOrigins).toEqual(['http://localhost:5173', 'http://127.0.0.1:5173']);
    expect(config.trustProxyHops).toBe(0);
    expect(config.limits.maxMessageBytes).toBe(16_384);
    expect(config.rooms.codeLength).toBe(6);
    expect(config.limits.joinFailures).toEqual({ max: 20, windowMs: 300_000 });
    expect(config.bots.minDelayMs).toBeLessThanOrEqual(config.bots.maxDelayMs);
    expect(Object.isFrozen(config.limits.rateLimit)).toBe(true);
  });

  it('reads every variable', () => {
    const config = loadServerConfig({
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: '8080',
      CORS_ORIGIN: 'https://moises.example, https://www.moises.example',
      TRUST_PROXY_HOPS: '1',
      LOG_LEVEL: 'warn',
      STATIC_DIR: ' ../client/dist ',
      MAX_MESSAGE_BYTES: '4096',
      MAX_CONNECTIONS: '100',
      MAX_CONNECTIONS_PER_IP: '3',
      MAX_ROOMS: '10',
      MAX_ROOMS_PER_IP: '2',
      RATE_LIMIT_BURST: '5',
      RATE_LIMIT_PER_SECOND: '2',
      RATE_LIMIT_DISCONNECT_AFTER: '7',
      JOIN_FAIL_MAX: '4',
      JOIN_FAIL_WINDOW_MS: '90000',
      ROOM_CODE_LENGTH: '8',
      ROOM_IDLE_TTL_MS: '60000',
      ROOM_EMPTY_TTL_MS: '30000',
      LOBBY_RECONNECT_GRACE_MS: '20000',
      ROOM_SWEEP_INTERVAL_MS: '1000',
      BOT_DELAY_MIN_MS: '100',
      BOT_DELAY_MAX_MS: '200',
    });
    expect(config).toEqual({
      nodeEnv: 'production',
      host: '127.0.0.1',
      port: 8080,
      corsOrigins: ['https://moises.example', 'https://www.moises.example'],
      trustProxyHops: 1,
      logLevel: 'warn',
      staticDir: '../client/dist',
      limits: {
        maxMessageBytes: 4096,
        maxConnections: 100,
        maxConnectionsPerIp: 3,
        maxRooms: 10,
        maxRoomsPerIp: 2,
        rateLimit: { burst: 5, perSecond: 2, disconnectAfter: 7 },
        joinFailures: { max: 4, windowMs: 90000 },
      },
      rooms: { codeLength: 8, idleTtlMs: 60000, emptyTtlMs: 30000, lobbyReconnectGraceMs: 20000, sweepIntervalMs: 1000 },
      bots: { minDelayMs: 100, maxDelayMs: 200 },
    });
  });

  it('requires CORS_ORIGIN in production and refuses "*" there', () => {
    expect(() => loadServerConfig({ NODE_ENV: 'production' })).toThrow(/CORS_ORIGIN is required/);
    expect(() => loadServerConfig({ NODE_ENV: 'production', CORS_ORIGIN: '*' })).toThrow(/not allowed in production/);
  });

  it('accepts "*" only when set explicitly outside production', () => {
    expect(loadServerConfig({ CORS_ORIGIN: '*' }).corsOrigins).toBe('*');
    expect(() => loadServerConfig({ CORS_ORIGIN: '*, https://a.example' })).toThrow(/cannot be combined/);
  });

  it.each(['https://a.example/', 'https://a.example/path', 'ftp://a.example', 'a.example', 'https://'])(
    'rejects the malformed origin %j',
    (origin) => {
      expect(() => loadServerConfig({ CORS_ORIGIN: origin })).toThrow(/CORS_ORIGIN/);
    },
  );

  it.each([
    ['PORT', '70000'],
    ['PORT', '-1'],
    ['PORT', '80.5'],
    ['MAX_ROOMS', '0'],
    ['JOIN_FAIL_MAX', '0'],
    ['JOIN_FAIL_WINDOW_MS', '999'],
    ['ROOM_CODE_LENGTH', '3'],
    ['ROOM_CODE_LENGTH', '13'],
    ['MAX_MESSAGE_BYTES', '77'],
    ['LOG_LEVEL', 'verbose'],
    ['NODE_ENV', 'staging'],
    ['HOST', 'bad host'],
  ])('rejects %s=%j and names the variable without echoing the value', (name, value) => {
    let message = '';
    try {
      loadServerConfig({ [name]: value });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain(name);
    expect(message).not.toContain(value);
  });

  it('rejects a bot delay range upside down', () => {
    expect(() => loadServerConfig({ BOT_DELAY_MIN_MS: '500', BOT_DELAY_MAX_MS: '100' })).toThrow(/BOT_DELAY_MAX_MS/);
  });

  it('treats empty values as unset', () => {
    expect(loadServerConfig({ PORT: '', CORS_ORIGIN: '  ' }).port).toBe(3000);
  });
});

describe('loadConfig', () => {
  it('returns server settings and rules', () => {
    const config = loadConfig({ MOISES_TURN_MS: '15000' });
    expect(config.rules.timings.turnMs).toBe(15000);
    expect(config.rules.cards).toEqual(DEFAULT_RULES.cards);
  });

  it('rejects a MOISES_TURN_MS the table settings could not echo back (room:setTable would fail)', () => {
    for (const bad of ['4999', '3000', '250', '15500', '61000']) {
      expect(() => loadConfig({ MOISES_TURN_MS: bad }), bad).toThrow(/MOISES_TURN_MS/);
    }
    expect(loadConfig({ MOISES_TURN_MS: '5000' }).rules.timings.turnMs).toBe(5000);
    expect(loadConfig({ MOISES_TURN_MS: '60000' }).rules.timings.turnMs).toBe(60000);
  });

  it('reports server and rule problems together', () => {
    expect(() => loadConfig({ PORT: 'x', MOISES_TURN_MS: '1' })).toThrow(/PORT[\s\S]*MOISES_TURN_MS/);
  });
});

describe('isOriginAllowed', () => {
  const allowed = ['https://moises.example'];
  it('allows listed origins and requests without Origin (non-browser clients)', () => {
    expect(isOriginAllowed('https://moises.example', allowed)).toBe(true);
    expect(isOriginAllowed(undefined, allowed)).toBe(true);
    expect(isOriginAllowed('https://anything', '*')).toBe(true);
  });
  it('refuses other origins', () => {
    expect(isOriginAllowed('https://evil.example', allowed)).toBe(false);
    expect(isOriginAllowed('https://moises.example.evil.example', allowed)).toBe(false);
    expect(isOriginAllowed('null', allowed)).toBe(false);
  });
});

describe('server/.env.example', () => {
  it('documents every variable the server reads', () => {
    const example = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
    const documented = new Set([...example.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]));
    for (const name of [...SERVER_ENV_VARS, ...Object.values(TIMING_ENV_VARS)]) {
      expect(documented.has(name), name).toBe(true);
    }
  });
});
