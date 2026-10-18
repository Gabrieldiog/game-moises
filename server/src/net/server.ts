import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server, type DefaultEventsMap, type Socket } from 'socket.io';
import type { z } from 'zod';
import {
  CLIENT_EVENT_NAMES,
  CreateRoomPayloadSchema,
  EmptyPayloadSchema,
  GameActionPayloadSchema,
  JoinRoomPayloadSchema,
  QuickPlayPayloadSchema,
  RemoveBotPayloadSchema,
  ResumeSessionPayloadSchema,
  type Ack,
  type ClientEventName,
  type ConnectionErrorMessage,
  type ServerErrorCode,
  type ServerToClientEvents,
} from '@moises/shared';
import { isOriginAllowed, type ServerConfig } from '../config/env.js';
import type { RulesConfig } from '../config/rules.js';
import { RoomManager, type Outcome, type RoomManagerDeps } from '../rooms/manager.js';
import { silentLogger, type Logger } from '../util/log.js';
import { TokenBucket } from './rate-limit.js';

// HTTP (GET /health) and Socket.IO on the same port. This layer only does
// transport concerns: origin check, connection limits, message size, rate
// limit, schema validation of every payload, and generic error replies. Game
// and room rules are in RoomManager / GameSession / the engine.

interface SocketData {
  ip: string;
}

type IoServer = Server<DefaultEventsMap, ServerToClientEvents, DefaultEventsMap, SocketData>;
type IoSocket = Socket<DefaultEventsMap, ServerToClientEvents, DefaultEventsMap, SocketData>;

export interface GameServerOptions {
  readonly config: ServerConfig;
  readonly rules: RulesConfig;
  readonly logger?: Logger;
  /** Clock, randomness and id generators (tests replace them). */
  readonly deps?: Partial<RoomManagerDeps>;
}

export interface GameServer {
  readonly http: HttpServer;
  readonly io: IoServer;
  readonly rooms: RoomManager;
  listen(): Promise<AddressInfo>;
  close(): Promise<void>;
}

const KNOWN_EVENTS: ReadonlySet<unknown> = new Set<unknown>(CLIENT_EVENT_NAMES);

/** Generic text for each code. Never includes details from the request or the state. */
function errorAck(code: ServerErrorCode): Ack<never> {
  return { ok: false, error: { code, message: code.toLowerCase().replaceAll('_', ' ') } };
}

function toAck<T>(outcome: Outcome<T>): Ack<T> {
  return outcome.ok ? { ok: true, data: outcome.data } : errorAck(outcome.code);
}

/**
 * Address used for per-IP limits. With trustProxyHops = N, the N-th address
 * from the right of X-Forwarded-For (the one seen by the outermost trusted
 * proxy); otherwise the TCP peer.
 */
export function clientIp(remote: string | undefined, forwardedFor: string | string[] | undefined, trustProxyHops: number): string {
  let ip = remote ?? 'unknown';
  if (trustProxyHops > 0 && forwardedFor !== undefined) {
    const list = (Array.isArray(forwardedFor) ? forwardedFor.join(',') : forwardedFor)
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item !== '');
    const candidate = list[list.length - trustProxyHops];
    if (candidate !== undefined && candidate.length <= 64) ip = candidate;
  }
  return ip.startsWith('::ffff:') ? ip.slice('::ffff:'.length) : ip;
}

function sendJson(req: IncomingMessage, res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(req.method === 'HEAD' ? undefined : payload);
}

function handleHttp(req: IncomingMessage, res: ServerResponse): void {
  let path: string;
  try {
    path = new URL(req.url ?? '/', 'http://localhost').pathname;
  } catch {
    sendJson(req, res, 400, { error: 'BAD_REQUEST' });
    return;
  }
  if (path === '/health') {
    if (req.method === 'GET' || req.method === 'HEAD') sendJson(req, res, 200, { status: 'ok' });
    else {
      res.setHeader('Allow', 'GET, HEAD');
      sendJson(req, res, 405, { error: 'METHOD_NOT_ALLOWED' });
    }
    return;
  }
  sendJson(req, res, 404, { error: 'NOT_FOUND' });
}

export function createGameServer(options: GameServerOptions): GameServer {
  const { config, rules } = options;
  const logger = options.logger ?? silentLogger;
  const now = options.deps?.now ?? (() => Date.now());

  const http = createServer(handleHttp);
  const io: IoServer = new Server(http, {
    serveClient: false,
    maxHttpBufferSize: config.limits.maxMessageBytes,
    cors: {
      origin: config.corsOrigins === '*' ? '*' : [...config.corsOrigins],
      methods: ['GET', 'POST'],
    },
    // CORS only covers HTTP long-polling; check the Origin of every handshake (WebSocket included).
    allowRequest: (req, callback) => callback(null, isOriginAllowed(req.headers.origin, config.corsOrigins)),
  });

  const rooms = new RoomManager({
    config,
    rules,
    logger,
    ...(options.deps ? { deps: options.deps } : {}),
    transport: {
      roomState: (socketId, room) => io.sockets.sockets.get(socketId)?.emit('room:state', room),
      gameUpdate: (socketId, update) => io.sockets.sockets.get(socketId)?.emit('game:update', update),
      roomClosed: (socketId, info) => io.sockets.sockets.get(socketId)?.emit('room:closed', info),
      sessionReplaced: (socketId) => {
        const socket = io.sockets.sockets.get(socketId);
        socket?.emit('session:replaced');
        // Not synchronously: the disconnect handler would re-enter the manager in the middle of resume().
        setImmediate(() => socket?.disconnect());
      },
    },
  });

  // --- connection limits ---------------------------------------------------------
  let connections = 0;
  const connectionsByIp = new Map<string, number>();

  io.use((socket, next) => {
    const ip = clientIp(socket.handshake.address, socket.handshake.headers['x-forwarded-for'], config.trustProxyHops);
    const refuse = (message: ConnectionErrorMessage) => next(new Error(message));
    if (connections >= config.limits.maxConnections) return refuse('SERVER_FULL');
    if ((connectionsByIp.get(ip) ?? 0) >= config.limits.maxConnectionsPerIp) return refuse('TOO_MANY_CONNECTIONS');
    socket.data.ip = ip;
    next();
  });

  io.on('connection', (socket: IoSocket) => {
    const ip = socket.data.ip;
    connections += 1;
    connectionsByIp.set(ip, (connectionsByIp.get(ip) ?? 0) + 1);
    logger.debug('connected', { socket: socket.id, connections });

    // Rate limit and unknown events, before any handler runs.
    const { burst, perSecond, disconnectAfter } = config.limits.rateLimit;
    const bucket = new TokenBucket(burst, perSecond, now());
    let refusedInARow = 0;
    socket.use((packet, next) => {
      const last: unknown = packet[packet.length - 1];
      const ack = typeof last === 'function' ? (last as (response: unknown) => void) : null;
      if (!bucket.take(now())) {
        refusedInARow += 1;
        ack?.(errorAck('RATE_LIMITED'));
        if (refusedInARow >= disconnectAfter) {
          logger.warn('rate limit exceeded; disconnecting', { socket: socket.id });
          socket.disconnect(true);
        }
        return;
      }
      refusedInARow = 0;
      if (!KNOWN_EVENTS.has(packet[0])) {
        ack?.(errorAck('UNKNOWN_EVENT'));
        return;
      }
      next();
    });

    const on = <S extends z.ZodType>(event: ClientEventName, schema: S, handler: (payload: z.output<S>) => Outcome<unknown>) => {
      socket.on(event, (...args: unknown[]) => {
        const last = args[args.length - 1];
        const ack = typeof last === 'function' ? (args.pop() as (response: Ack<unknown>) => void) : null;
        let response: Ack<unknown>;
        try {
          const parsed = args.length <= 1 ? schema.safeParse(args[0]) : null;
          response = parsed?.success ? toAck(handler(parsed.data)) : errorAck('BAD_REQUEST');
        } catch (error) {
          logger.error('request failed', { event, socket: socket.id, error });
          response = errorAck('INTERNAL_ERROR');
        }
        ack?.(response);
        try {
          rooms.flush();
        } catch (error) {
          logger.error('flush failed', { event, error });
        }
      });
    };

    on('room:create', CreateRoomPayloadSchema, (p) => rooms.createRoom(socket.id, ip, p.name));
    on('room:join', JoinRoomPayloadSchema, (p) => rooms.joinRoom(socket.id, p.code, p.name));
    on('room:quickPlay', QuickPlayPayloadSchema, (p) => rooms.quickPlay(socket.id, ip, p.name, p.bots));
    on('session:resume', ResumeSessionPayloadSchema, (p) => rooms.resume(socket.id, p.token));
    on('room:leave', EmptyPayloadSchema, () => rooms.leave(socket.id));
    on('room:addBot', EmptyPayloadSchema, () => rooms.addBot(socket.id));
    on('room:removeBot', RemoveBotPayloadSchema, (p) => rooms.removeBot(socket.id, p.playerId));
    on('room:start', EmptyPayloadSchema, () => rooms.start(socket.id));
    on('game:action', GameActionPayloadSchema, (action) => rooms.act(socket.id, action));

    socket.on('disconnect', () => {
      connections -= 1;
      const left = (connectionsByIp.get(ip) ?? 1) - 1;
      if (left <= 0) connectionsByIp.delete(ip);
      else connectionsByIp.set(ip, left);
      try {
        rooms.disconnect(socket.id);
        rooms.flush();
      } catch (error) {
        logger.error('disconnect handling failed', { error });
      }
    });
  });

  let sweeper: ReturnType<typeof setInterval> | null = null;

  return {
    http,
    io,
    rooms,
    listen: () =>
      new Promise<AddressInfo>((resolve, reject) => {
        http.once('error', reject);
        http.listen(config.port, config.host, () => {
          http.off('error', reject);
          sweeper = setInterval(() => {
            try {
              rooms.sweep();
            } catch (error) {
              logger.error('sweep failed', { error });
            }
          }, config.rooms.sweepIntervalMs);
          sweeper.unref();
          resolve(http.address() as AddressInfo);
        });
      }),
    close: async () => {
      if (sweeper) clearInterval(sweeper);
      sweeper = null;
      rooms.closeAll('shutdown');
      await io.close();
    },
  };
}
