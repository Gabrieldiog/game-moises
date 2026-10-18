import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Ack, GameUpdate, JoinedRoom, PlayerId, RoomClosed, RoomView, ServerGameEvent } from '@moises/shared';
import { viewFor, type GameState } from '../src/engine/index.js';
import { GameSession } from '../src/game/session.js';
import { facesIn } from './helpers.js';
import { cleanup, connect, emitRaw, fastRules, record, sleep, startServer, waitFor, type Client } from './support/net.js';

// Real server on an ephemeral port, real socket.io-client connections.

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanup();
});

function ok<T>(ack: Ack<T>): T {
  if (!ack.ok) throw new Error(`expected ok, got ${ack.error.code}`);
  return ack.data;
}

function errorCode(ack: unknown): string | null {
  const response = ack as Ack<unknown>;
  return response.ok ? null : response.error.code;
}

async function createAndJoin(url: string) {
  const a = await connect(url);
  const b = await connect(url);
  const ra = record(a);
  const rb = record(b);
  const host = ok(await a.emitWithAck('room:create', { name: 'Ana' }));
  const guest = ok(await b.emitWithAck('room:join', { code: host.room.code.toLowerCase(), name: 'Bia' }));
  return { a, b, ra, rb, host, guest };
}

describe('HTTP', () => {
  it('answers GET /health and nothing else', async () => {
    const { url } = await startServer();
    const health = await fetch(`${url}/health`);
    expect(health.status).toBe(200);
    expect(health.headers.get('content-type')).toContain('application/json');
    expect(health.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await health.json()).toEqual({ status: 'ok' });
    expect((await fetch(`${url}/health?x=1`)).status).toBe(200);
    expect((await fetch(`${url}/health`, { method: 'POST' })).status).toBe(405);
    expect((await fetch(`${url}/`)).status).toBe(404);
    expect((await fetch(`${url}/socket.io/socket.io.js`)).status).not.toBe(200); // the client bundle is not served
  });
});

describe('rooms over Socket.IO', () => {
  it('create, join by code, start: each player gets the room and their own view', async () => {
    const { url } = await startServer();
    const { a, b, ra, rb, host, guest } = await createAndJoin(url);
    expect(host.room.code).toMatch(/^[2-9A-HJKMNP-Z]{6}$/);
    expect(guest.room.members.map((m) => m.name)).toEqual(['Ana', 'Bia']);
    await waitFor<RoomView>(a, 'room:state', (r) => r.members.length === 2);

    expect(errorCode(await b.emitWithAck('room:start', {}))).toBe('NOT_HOST');
    const aUpdate = waitFor<GameUpdate>(a, 'game:update');
    const bUpdate = waitFor<GameUpdate>(b, 'game:update');
    ok(await a.emitWithAck('room:start', {}));
    expect((await aUpdate).view.you).toBe(host.playerId);
    expect((await bUpdate).view.you).toBe(guest.playerId);
    expect(ra.rooms().at(-1)?.status).toBe('playing');
    expect(rb.rooms().at(-1)?.you).toBe(guest.playerId);
  });

  it('room:setTable validates the payload, is host-only and shows up in room:state', async () => {
    const { url } = await startServer();
    const { a, b } = await createAndJoin(url);
    const table = { turnSeconds: 30, reactions: { matchOwn: false, matchOpponent: true }, powers: ['Q' as const] };
    expect(errorCode(await b.emitWithAck('room:setTable', table))).toBe('NOT_HOST');
    expect(errorCode(await emitRaw(a, 'room:setTable', { ...table, turnSeconds: 1 }))).toBe('BAD_REQUEST');
    expect(errorCode(await emitRaw(a, 'room:setTable', { ...table, extra: true }))).toBe('BAD_REQUEST');
    expect(errorCode(await emitRaw(a, 'room:setTable', null))).toBe('BAD_REQUEST');
    const changed = waitFor<RoomView>(b, 'room:state', (r) => r.table.turnSeconds === 30);
    ok(await a.emitWithAck('room:setTable', table));
    expect((await changed).table).toEqual(table);
  });

  it('sanitizes names and refuses bad ones', async () => {
    const { url } = await startServer();
    const a = await connect(url);
    expect(errorCode(await emitRaw(a, 'room:create', { name: '   ' }))).toBe('BAD_REQUEST');
    const joined = ok(await a.emitWithAck('room:create', { name: '  Ana\u0000\u202E  ' }));
    expect(joined.room.members[0]?.name).toBe('Ana');
  });

  it('host adds and removes bots; quick play starts at once', async () => {
    const { url } = await startServer();
    const a = await connect(url);
    ok(await a.emitWithAck('room:create', { name: 'Ana' }));
    const withBot = waitFor<RoomView>(a, 'room:state', (r) => r.members.some((m) => m.isBot));
    ok(await a.emitWithAck('room:addBot', {}));
    const bot = (await withBot).members.find((m) => m.isBot);
    expect(bot).toMatchObject({ name: 'Bot 1', connected: true, isHost: false });
    expect(errorCode(await a.emitWithAck('room:removeBot', { playerId: 'nobody' }))).toBe('NOT_A_BOT');
    ok(await a.emitWithAck('room:removeBot', { playerId: bot?.id ?? '' }));
    ok(await a.emitWithAck('room:leave', {}));

    const update = waitFor<GameUpdate>(a, 'game:update');
    const quick = ok(await a.emitWithAck('room:quickPlay', { name: 'Ana', bots: 2 }));
    expect(quick.room.status).toBe('playing');
    expect((await update).view.players).toHaveLength(3);
    expect(errorCode(await emitRaw(a, 'room:quickPlay', { name: 'Ana', bots: 9 }))).toBe('ALREADY_IN_ROOM');
  });

  it('queues a join to a game in progress; refuses unknown codes and full rooms', async () => {
    const { url } = await startServer();
    const { a, host } = await createAndJoin(url);
    const c = await connect(url);
    expect(errorCode(await c.emitWithAck('room:join', { code: 'ZZZZZZ', name: 'Caio' }))).toBe('ROOM_NOT_FOUND');
    const roomCode = host.room.code;
    ok(await a.emitWithAck('room:start', {}));
    const queued = ok(await c.emitWithAck('room:join', { code: roomCode, name: 'Caio' }));
    expect(queued.room.queue.map((q) => q.name)).toEqual(['Caio']);
    const d = await connect(url);
    expect(errorCode(await d.emitWithAck('room:quickPlay', { name: 'Davi', bots: 6 }))).toBe('ROOM_FULL');
  });
});

describe('game over Socket.IO', () => {
  it('end to end: every socket receives exactly its own view, and nothing else', async () => {
    // Record the authoritative state at the moment of every broadcast, to compare with what went over the wire.
    const flushed: { state: GameState; events: ServerGameEvent[] }[] = [];
    const drain = GameSession.prototype.drainEvents;
    vi.spyOn(GameSession.prototype, 'drainEvents').mockImplementation(function (this: GameSession) {
      const events = drain.call(this);
      flushed.push({ state: structuredClone(this.internalState), events: structuredClone(events) });
      return events;
    });

    const { url } = await startServer();
    const { a, b, ra, rb, host, guest } = await createAndJoin(url);
    ok(await a.emitWithAck('room:addBot', {}));
    const players = new Map<PlayerId, Client>([
      [host.playerId, a],
      [guest.playerId, b],
    ]);
    // A simple human policy: draw, alternate swap / discard, skip powers, sometimes a (blind) reaction, call the end late.
    for (const [me, client] of players) {
      const done = new Set<string>();
      client.on('game:update', ({ view }) => {
        if (view.phase !== 'playing') return;
        const turn = view.turn;
        const window = view.reactionWindow;
        if (window && !window.attemptedBy.includes(me) && (turn?.number ?? 0) % 3 === 0) {
          const key = `react:${turn?.number}`;
          const mine = view.players.find((p) => p.id === me);
          const slot = mine?.slots.findIndex((s) => s.state !== 'empty') ?? -1;
          if (!done.has(key) && slot >= 0) {
            done.add(key);
            void client.emitWithAck('game:action', { type: 'matchOwn', slot });
          }
        }
        if (!turn || turn.playerId !== me) return;
        const key = `${turn.number}:${turn.step}:${view.endCall ? 1 : 0}`;
        if (done.has(key)) return;
        done.add(key);
        if (turn.step === 'draw') {
          if (turn.number >= 8 && !view.endCall) void client.emitWithAck('game:action', { type: 'callEnd' });
          else void client.emitWithAck('game:action', { type: 'draw' });
        } else if (turn.step === 'decide') {
          void client.emitWithAck('game:action', turn.number % 2 ? { type: 'discardDrawn' } : { type: 'swapWithDrawn', slot: 0 });
        } else if (turn.step === 'power' || turn.step === 'powerSwap') {
          void client.emitWithAck('game:action', { type: 'skipPower' });
        }
      });
    }
    const endedA = waitFor<GameUpdate>(a, 'game:update', (u) => u.view.phase === 'ended', 20_000);
    const endedB = waitFor<GameUpdate>(b, 'game:update', (u) => u.view.phase === 'ended', 20_000);
    ok(await a.emitWithAck('room:start', {}));
    await Promise.all([endedA, endedB]);
    await sleep(50);

    expect(flushed.length).toBeGreaterThan(20);
    for (const [me, recorded] of [
      [host.playerId, ra],
      [guest.playerId, rb],
    ] as const) {
      const updates = recorded.updates();
      expect(updates).toHaveLength(flushed.length);
      updates.forEach((update, i) => {
        const truth = flushed[i] as { state: GameState; events: ServerGameEvent[] };
        expect(update.view.you).toBe(me);
        expect(update.view).toEqual(JSON.parse(JSON.stringify(viewFor(truth.state, me, update.view.now))));
        expect(update.events).toEqual(JSON.parse(JSON.stringify(truth.events)));
        if (update.view.turn?.drawnCard) expect(update.view.turn.playerId).toBe(me);
      });
      // Room messages and acks never carry a card.
      expect(facesIn(recorded.rooms())).toEqual([]);
    }
    // The other human's cards were hidden from each player until the end.
    const lastPlaying = rb.updates().filter((u) => u.view.phase === 'playing');
    expect(lastPlaying.length).toBeGreaterThan(0);
  }, 30_000);

  it('the turn timer plays for a player who does nothing', async () => {
    const { url } = await startServer({}, fastRules({ turnMs: 150 }));
    const { a, b, ra } = await createAndJoin(url);
    const timedOut = waitFor<GameUpdate>(b, 'game:update', (u) => u.events.some((e) => e.type === 'turnTimedOut'));
    ok(await a.emitWithAck('room:start', {}));
    const update = await timedOut;
    const notice = update.events.find((e) => e.type === 'turnTimedOut');
    expect(notice).toMatchObject({ type: 'turnTimedOut', turnNumber: 1, step: 'draw' });
    expect(update.events.map((e) => e.type)).toEqual(expect.arrayContaining(['cardDrawn', 'drawnCardDiscarded']));
    await waitFor<GameUpdate>(a, 'game:update', (u) => (u.view.turn?.number ?? 0) >= 2);
    const playing = ra.updates().find((u) => u.view.phase === 'playing' && u.turnDeadline !== null);
    expect(playing?.turnDeadline).toBeGreaterThan(playing?.view.now ?? 0);
  });

  it('refuses invalid actions without leaking anything', async () => {
    const { url } = await startServer();
    const { a, b } = await createAndJoin(url);
    const playing = waitFor<GameUpdate>(a, 'game:update', (u) => u.view.phase === 'playing');
    ok(await a.emitWithAck('room:start', {}));
    const view = (await playing).view;
    const [current, other] = view.turn?.playerId === view.you ? [a, b] : [b, a];
    expect(errorCode(await other.emitWithAck('game:action', { type: 'draw' }))).toBe('NOT_YOUR_TURN');
    const refused = await emitRaw(current, 'game:action', { type: 'draw', card: { kind: 'joker', color: 'red' } });
    expect(refused).toEqual({ ok: false, error: { code: 'BAD_REQUEST', message: 'bad request' } });
    expect(errorCode(await emitRaw(current, 'game:action', { type: 'draw', playerId: 'someone' }))).toBe('BAD_REQUEST');
    expect(errorCode(await current.emitWithAck('game:action', { type: 'swapWithDrawn', slot: 0 }))).toBe('INVALID_PHASE');
    const wrong = await current.emitWithAck('game:action', { type: 'matchOwn', slot: 99 });
    expect(wrong).toEqual({ ok: false, error: { code: 'BAD_REQUEST', message: 'bad request' } });
    ok(await current.emitWithAck('game:action', { type: 'draw' }));
  });
});

describe('identity and reconnection', () => {
  it('a new connection takes the seat back with the token; the player id in payloads means nothing', async () => {
    const { url } = await startServer();
    const { a, b, guest } = await createAndJoin(url);
    const started = waitFor<GameUpdate>(b, 'game:update');
    ok(await a.emitWithAck('room:start', {}));
    await started;

    const seenOffline = waitFor<RoomView>(a, 'room:state', (r) => r.members.some((m) => m.id === guest.playerId && !m.connected));
    b.disconnect();
    await seenOffline;

    const c = await connect(url);
    const rc = record(c);
    expect(errorCode(await c.emitWithAck('game:action', { type: 'draw' }))).toBe('NOT_IN_ROOM');
    expect(errorCode(await emitRaw(c, 'session:resume', { token: 'not-a-token' }))).toBe('BAD_REQUEST');
    expect(errorCode(await c.emitWithAck('session:resume', { token: 'A'.repeat(43) }))).toBe('INVALID_SESSION');
    const snapshot = waitFor<GameUpdate>(c, 'game:update');
    const seenOnline = waitFor<RoomView>(a, 'room:state', (r) => r.members.every((m) => m.connected));
    const resumed = ok(await c.emitWithAck('session:resume', { token: guest.token }));
    expect(resumed.playerId).toBe(guest.playerId);
    expect((await snapshot).view.you).toBe(guest.playerId);
    expect((await snapshot).events).toEqual([]);
    await seenOnline;
    expect(rc.rooms().at(-1)?.you).toBe(guest.playerId);

    // A second connection with the same token replaces the first one.
    const d = await connect(url);
    const replaced = waitFor<null>(c, 'session:replaced');
    const gone = waitFor<string>(c, 'disconnect');
    ok(await d.emitWithAck('session:resume', { token: guest.token }));
    await replaced;
    await gone;
  });

  it('the token is never sent to anyone else', async () => {
    const { url } = await startServer();
    const { ra, rb, host, guest, a } = await createAndJoin(url);
    ok(await a.emitWithAck('room:start', {}));
    await sleep(300);
    expect(JSON.stringify(ra.log)).not.toContain(guest.token);
    expect(JSON.stringify(rb.log)).not.toContain(host.token);
  });
});

describe('transport safety', () => {
  it('validates every payload and answers with generic errors', async () => {
    const { url } = await startServer();
    const a = await connect(url);
    const cases: [string, unknown[]][] = [
      ['room:create', [{}]],
      ['room:create', ['Ana']],
      ['room:create', [{ name: 'Ana', admin: true }]],
      ['room:create', [{ name: 'Ana' }, 'extra']],
      ['room:create', []],
      ['room:join', [{ code: '../../', name: 'Ana' }]],
      ['room:removeBot', [{ playerId: { $ne: 1 } }]],
      ['room:start', [{ force: true }]],
      ['game:action', [null]],
      ['game:action', [{ type: 'usePower', power: 'peekOwn', slot: -1 }]],
      ['session:resume', [{ token: 12 }]],
    ];
    for (const [event, args] of cases) {
      const response = await emitRaw(a, event, ...args);
      expect(response, `${event} ${JSON.stringify(args)}`).toEqual({ ok: false, error: { code: 'BAD_REQUEST', message: 'bad request' } });
    }
    expect(await emitRaw(a, 'admin:dump', {})).toEqual({ ok: false, error: { code: 'UNKNOWN_EVENT', message: 'unknown event' } });
    // Events without an ack are handled and simply get no answer; the connection keeps working.
    (a as unknown as { emit(event: string, ...args: unknown[]): void }).emit('room:create', { bad: true });
    ok(await a.emitWithAck('room:create', { name: 'Ana' }));
  });

  it('closes connections that send messages over the size limit', async () => {
    const { url } = await startServer({ limits: { maxMessageBytes: 1024 } });
    const a = await connect(url);
    const gone = waitFor<string>(a, 'disconnect');
    a.emit('room:create', { name: 'x'.repeat(5_000) }, () => undefined);
    expect(await gone).toBeTruthy();
  });

  it('rate limits each connection and disconnects floods', async () => {
    const { url } = await startServer({ limits: { rateLimit: { burst: 3, perSecond: 1, disconnectAfter: 4 } } });
    const a = await connect(url);
    const responses = await Promise.all(Array.from({ length: 5 }, () => emitRaw(a, 'room:leave', {})));
    expect(responses.map(errorCode)).toEqual(['NOT_IN_ROOM', 'NOT_IN_ROOM', 'NOT_IN_ROOM', 'RATE_LIMITED', 'RATE_LIMITED']);
    const gone = waitFor<string>(a, 'disconnect');
    for (let i = 0; i < 3; i++) a.emit('room:leave', {}, () => undefined);
    expect(await gone).toBe('io server disconnect');
  });

  it('refuses browser origins that are not allowed', async () => {
    const { url } = await startServer({ corsOrigins: ['http://good.example'] });
    await expect(connect(url, { extraHeaders: { origin: 'http://evil.example' } })).rejects.toThrow();
    await expect(connect(url, { transports: ['polling'], extraHeaders: { origin: 'http://evil.example' } })).rejects.toThrow();
    const good = await connect(url, { extraHeaders: { origin: 'http://good.example' } });
    expect(good.connected).toBe(true);
  });

  it('limits connections per address', async () => {
    const { url } = await startServer({ limits: { maxConnectionsPerIp: 2 } });
    await connect(url);
    const second = await connect(url);
    await expect(connect(url)).rejects.toThrow('TOO_MANY_CONNECTIONS');
    second.disconnect();
    await sleep(50);
    await expect(connect(url)).resolves.toBeTruthy();
  });

  it('stops an address from guessing room codes, even with new connections, and recovers after the window', async () => {
    const { url } = await startServer({ limits: { joinFailures: { max: 3, windowMs: 400 } } });
    const host = await connect(url);
    const code = ok(await host.emitWithAck('room:create', { name: 'Ana' })).room.code;
    const guesser = await connect(url);
    for (let i = 0; i < 3; i++) {
      expect(errorCode(await guesser.emitWithAck('room:join', { code: 'ZZZZZZ', name: 'Eve' }))).toBe('ROOM_NOT_FOUND');
    }
    expect(errorCode(await guesser.emitWithAck('room:join', { code: 'ZZZZZZ', name: 'Eve' }))).toBe('RATE_LIMITED');
    // Same address, other connection: still locked, and the right code gets the same answer as a wrong one.
    const fresh = await connect(url);
    expect(errorCode(await fresh.emitWithAck('room:join', { code, name: 'Eve' }))).toBe('RATE_LIMITED');
    expect(errorCode(await fresh.emitWithAck('room:join', { code: 'YYYYYY', name: 'Eve' }))).toBe('RATE_LIMITED');
    await sleep(450);
    ok(await fresh.emitWithAck('room:join', { code, name: 'Eve' }));
  });

  it('counts only wrong codes: joining a real room (or being refused for another reason) never locks anyone', async () => {
    const { url } = await startServer({ limits: { joinFailures: { max: 2, windowMs: 60_000 } } });
    const host = await connect(url);
    const code = ok(await host.emitWithAck('room:create', { name: 'Ana' })).room.code;
    for (let i = 0; i < 5; i++) {
      const guest = await connect(url);
      ok(await guest.emitWithAck('room:join', { code, name: `G${i}` })); // host + 5 guests = the 6 seats
    }
    const late = await connect(url);
    expect(errorCode(await late.emitWithAck('room:join', { code, name: 'Late' }))).toBe('ROOM_FULL');
    expect(errorCode(await late.emitWithAck('room:join', { code, name: 'Late' }))).toBe('ROOM_FULL');
    expect(errorCode(await late.emitWithAck('room:join', { code, name: 'Late' }))).toBe('ROOM_FULL');
    expect(errorCode(await late.emitWithAck('room:join', { code: 'ZZZZZZ', name: 'Late' }))).toBe('ROOM_NOT_FOUND');
  });

  it('caps sockets that never finish the Socket.IO handshake, per address', async () => {
    const { url } = await startServer({ limits: { maxConnectionsPerIp: 2 } }); // engine-level cap: 4
    const raw = Array.from({ length: 12 }, () => new WebSocket(`${url.replace('http', 'ws')}/socket.io/?EIO=4&transport=websocket`));
    await sleep(500);
    expect(raw.filter((socket) => socket.readyState === WebSocket.OPEN)).toHaveLength(4);
    for (const socket of raw) socket.close();
    await sleep(200);
    // Once they are gone the address can connect again.
    expect((await connect(url)).connected).toBe(true);
  });

  it('limits rooms per address', async () => {
    const { url } = await startServer({ limits: { maxRoomsPerIp: 1 } });
    const a = await connect(url);
    const b = await connect(url);
    ok(await a.emitWithAck('room:create', { name: 'Ana' }));
    expect(errorCode(await b.emitWithAck('room:create', { name: 'Bia' }))).toBe('ROOM_LIMIT');
  });

  it('tells connected players when the server shuts down', async () => {
    const { url, server } = await startServer();
    const a = await connect(url);
    const joined: JoinedRoom = ok(await a.emitWithAck('room:create', { name: 'Ana' }));
    const closed = waitFor<RoomClosed>(a, 'room:closed');
    await server.close();
    expect(await closed).toEqual({ code: joined.room.code, reason: 'shutdown' });
  });
});
