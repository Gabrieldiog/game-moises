import { describe, expect, it } from 'vitest';
import type { RoomView } from '@moises/shared';
import { SocketConnection, type SocketLike } from './socket';
import { memoryTokenStore } from './token';
import type { ConnectionEvent } from './types';

// SocketConnection against a fake socket: only the protocol shape matters here
// (the real server is exercised by the server's integration tests).

const TOKEN = 'a'.repeat(43);

const ROOM: RoomView = {
  code: 'K7QX2M',
  status: 'lobby',
  you: 'p1',
  hostId: 'p1',
  members: [{ id: 'p1', name: 'Gi', isBot: false, isHost: true, connected: true }],
  settings: { minPlayers: 2, maxPlayers: 6, turnMs: 15_000 },
  table: { turnSeconds: 15, reactions: { matchOwn: true, matchOpponent: true }, powers: ['7', 'K'] },
  queue: [],
};

type Handler = (...args: never[]) => void;

class FakeSocket {
  connected = false;
  active = false;
  readonly handlers = new Map<string, Handler>();
  readonly sent: { event: string; payload: unknown }[] = [];
  answers: Record<string, unknown> = {};

  connect() {
    this.connected = true;
    this.active = true;
    this.fire('connect');
  }
  disconnect() {
    this.connected = false;
    this.active = false;
  }
  on(event: string, listener: Handler) {
    this.handlers.set(event, listener);
  }
  fire(event: string, ...args: unknown[]) {
    (this.handlers.get(event) as ((...a: unknown[]) => void) | undefined)?.(...args);
  }
  timeout() {
    return {
      emitWithAck: async (event: string, payload: unknown) => {
        this.sent.push({ event, payload });
        const answer = this.answers[event];
        if (answer === undefined) throw new Error('timeout');
        return answer;
      },
    };
  }
}

function setup(token: string | null = null) {
  const socket = new FakeSocket();
  const tokens = memoryTokenStore(token);
  const connection = new SocketConnection({ url: 'http://test', tokens, createSocket: () => socket as unknown as SocketLike });
  const events: ConnectionEvent[] = [];
  connection.subscribe((e) => events.push(e));
  return { socket, tokens, connection, events };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('SocketConnection', () => {
  it('creates a room, keeps the token and publishes the room', async () => {
    const { socket, tokens, connection, events } = setup();
    socket.answers['room:create'] = { ok: true, data: { playerId: 'p1', token: TOKEN, room: ROOM } };
    connection.connect();
    await flush();
    expect(connection.getStatus()).toBe('connected');
    expect((await connection.createRoom('  Gi  ')).ok).toBe(true);
    expect(socket.sent).toEqual([{ event: 'room:create', payload: { name: 'Gi' } }]);
    expect(tokens.current()).toBe(TOKEN);
    expect(events).toContainEqual({ type: 'room', room: ROOM });
  });

  it('resumes the saved seat on connect', async () => {
    const { socket, connection, events } = setup(TOKEN);
    socket.answers['session:resume'] = { ok: true, data: { playerId: 'p1', room: ROOM } };
    connection.connect();
    await flush();
    expect(socket.sent[0]).toEqual({ event: 'session:resume', payload: { token: TOKEN } });
    expect(events).toContainEqual({ type: 'room', room: ROOM });
  });

  it('forgets an expired seat', async () => {
    const { socket, tokens, connection, events } = setup(TOKEN);
    socket.answers['session:resume'] = { ok: false, error: { code: 'INVALID_SESSION', message: 'invalid session' } };
    connection.connect();
    await flush();
    expect(tokens.current()).toBeNull();
    expect(events).toContainEqual({ type: 'sessionLost' });
  });

  it('turns refusals into typed errors with the request name', async () => {
    const { socket, connection, events } = setup();
    socket.answers['room:join'] = { ok: false, error: { code: 'RATE_LIMITED', message: 'rate limited' } };
    connection.connect();
    await flush();
    const result = await connection.joinRoom(' k7qx2m ', 'Gi');
    expect(socket.sent.at(-1)).toEqual({ event: 'room:join', payload: { code: 'K7QX2M', name: 'Gi' } });
    expect(result).toEqual({ ok: false, error: { code: 'RATE_LIMITED', request: 'room:join', message: 'rate limited' } });
    expect(events.at(-1)).toEqual({ type: 'error', error: result.ok ? null : result.error });
  });

  it('checks table settings with the shared schema before sending', async () => {
    const { socket, connection } = setup();
    socket.answers['room:setTable'] = { ok: true, data: null };
    connection.connect();
    await flush();
    const bad = await connection.setTable({ turnSeconds: 99, reactions: { matchOwn: true, matchOpponent: true }, powers: [] });
    expect(bad).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST', request: 'room:setTable' } });
    const settings = { turnSeconds: 20, reactions: { matchOwn: false, matchOpponent: true }, powers: ['J' as const] };
    expect((await connection.setTable(settings)).ok).toBe(true);
    expect(socket.sent).toEqual([{ event: 'room:setTable', payload: settings }]);
  });

  it('does not send while offline', async () => {
    const { socket, connection } = setup();
    const result = await connection.addBot();
    expect(result).toMatchObject({ ok: false, error: { code: 'NOT_CONNECTED' } });
    expect(socket.sent).toEqual([]);
  });

  it('a timeout is reported as TIMEOUT', async () => {
    const { connection } = setup();
    connection.connect();
    await flush();
    expect(await connection.startGame()).toMatchObject({ ok: false, error: { code: 'TIMEOUT', request: 'room:start' } });
  });

  it('leaving forgets the seat; room:closed too', async () => {
    const { socket, tokens, connection, events } = setup(TOKEN);
    socket.answers['session:resume'] = { ok: true, data: { playerId: 'p1', room: ROOM } };
    socket.answers['room:leave'] = { ok: false, error: { code: 'NOT_IN_ROOM', message: 'not in room' } };
    connection.connect();
    await flush();
    expect((await connection.leaveRoom()).ok).toBe(true);
    expect(tokens.current()).toBeNull();
    expect(events.at(-1)).toEqual({ type: 'room', room: null });
    socket.fire('room:closed', { code: 'K7QX2M', reason: 'idle' });
    expect(events.at(-1)).toEqual({ type: 'roomClosed', info: { code: 'K7QX2M', reason: 'idle' } });
  });

  it('shows "replaced" when another tab takes the seat', async () => {
    const { socket, connection } = setup();
    connection.connect();
    await flush();
    socket.fire('session:replaced');
    socket.connected = false;
    socket.active = false;
    socket.fire('disconnect', 'io server disconnect');
    expect(connection.getStatus()).toBe('replaced');
  });

  it('reports server refusals of the connection once', () => {
    const { socket, events } = setup();
    socket.fire('connect_error', new Error('SERVER_FULL'));
    socket.fire('connect_error', new Error('SERVER_FULL'));
    expect(events.filter((e) => e.type === 'error')).toHaveLength(1);
  });
});
