import { io as connectClient, type Socket as ClientSocket, type ManagerOptions, type SocketOptions } from 'socket.io-client';
import type { ClientToServerEvents, GameUpdate, RoomView, ServerToClientEvents } from '@moises/shared';
import type { ServerConfig } from '../../src/config/env.js';
import { DEFAULT_RULES, parseRules, type RulesConfig } from '../../src/config/rules.js';
import { createGameServer, type GameServer } from '../../src/net/server.js';
import { testConfig } from './fakes.js';

export type Client = ClientSocket<ServerToClientEvents, ClientToServerEvents>;

/** Short timings so whole games run in a few seconds. */
export function fastRules(timings: Partial<RulesConfig['timings']> = {}): RulesConfig {
  return parseRules({
    ...DEFAULT_RULES,
    timings: { arrangeMs: 60, initialPeekMs: 60, reactionWindowMs: 120, reactionClaimMs: 400, revealMs: 150, turnMs: 3_000, ...timings },
  });
}

export interface Running {
  server: GameServer;
  url: string;
}

const running = new Set<GameServer>();
const clients = new Set<Client>();

export async function startServer(
  patch: Parameters<typeof testConfig>[0] = {},
  rules: RulesConfig = fastRules(),
): Promise<Running & { config: ServerConfig }> {
  const config = testConfig(patch);
  const server = createGameServer({ config, rules });
  const address = await server.listen();
  running.add(server);
  return { server, url: `http://127.0.0.1:${address.port}`, config };
}

/** Every message a client received, in order. */
export interface Recorded {
  readonly log: { event: string; args: unknown[] }[];
  updates(): GameUpdate[];
  rooms(): RoomView[];
}

export function record(client: Client): Recorded {
  const log: { event: string; args: unknown[] }[] = [];
  client.onAny((event: string, ...args: unknown[]) => log.push({ event, args }));
  return {
    log,
    updates: () => log.filter((m) => m.event === 'game:update').map((m) => m.args[0] as GameUpdate),
    rooms: () => log.filter((m) => m.event === 'room:state').map((m) => m.args[0] as RoomView),
  };
}

export function connect(url: string, options: Partial<ManagerOptions & SocketOptions> = {}): Promise<Client> {
  const client: Client = connectClient(url, { transports: ['websocket'], forceNew: true, reconnection: false, ...options });
  clients.add(client);
  return new Promise((resolve, reject) => {
    client.once('connect', () => resolve(client));
    client.once('connect_error', (error) => reject(error));
  });
}

/** Resolves when `predicate` is true for a message of `event` (checks messages already recorded too). */
export function waitFor<T>(
  client: Client,
  event: keyof ServerToClientEvents | 'disconnect',
  predicate: (payload: T) => boolean = () => true,
  timeoutMs = 5_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.off(event as 'room:state', listener as never);
      reject(new Error(`timed out waiting for ${String(event)}`));
    }, timeoutMs);
    const listener = (payload: T) => {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      client.off(event as 'room:state', listener as never);
      resolve(payload);
    };
    client.on(event as 'room:state', listener as never);
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function cleanup(): Promise<void> {
  for (const client of clients) client.disconnect();
  clients.clear();
  await Promise.all([...running].map((server) => server.close()));
  running.clear();
}

/** Sends a raw (untyped) event, for payloads the typed API would not allow. */
export function emitRaw(client: Client, event: string, ...args: unknown[]): Promise<unknown> {
  return (client as unknown as { emitWithAck(event: string, ...args: unknown[]): Promise<unknown> }).emitWithAck(event, ...args);
}
