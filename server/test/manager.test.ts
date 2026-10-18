import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JoinedRoom, ServerGameEvent } from '@moises/shared';
import type { ServerConfig } from '../src/config/env.js';
import { DEFAULT_RULES, type RulesConfig } from '../src/config/rules.js';
import { GameSession } from '../src/game/session.js';
import { RoomManager, type Outcome } from '../src/rooms/manager.js';
import { FakeClock, FakeTransport, testConfig } from './support/fakes.js';

const IP = '10.0.0.1';
const RULES = DEFAULT_RULES;
const T = RULES.timings;

function setup(config: ServerConfig = testConfig(), rules: RulesConfig = RULES) {
  const clock = new FakeClock();
  const transport = new FakeTransport();
  let seq = 0;
  const rooms = new RoomManager({
    config,
    rules,
    transport,
    deps: { now: () => clock.now, scheduler: clock.scheduler, random: () => 0.5, roomCode: () => `ROOM${(seq++).toString().padStart(2, '0')}` },
  });
  return { clock, transport, rooms };
}

function data<T>(outcome: Outcome<T>): T {
  if (!outcome.ok) throw new Error(`expected success, got ${outcome.code}`);
  return outcome.data;
}

function code(outcome: Outcome<unknown>): string | null {
  return outcome.ok ? null : outcome.code;
}

/** Two humans in a lobby: s1 (host) and s2. */
function lobby(config?: ServerConfig) {
  const env = setup(config);
  const host = data(env.rooms.createRoom('s1', IP, 'Ana'));
  const guest = data(env.rooms.joinRoom('s2', host.room.code, 'Bia'));
  env.rooms.flush();
  return { ...env, host, guest, roomCode: host.room.code };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('creating and joining rooms', () => {
  it('creates a room with the creator as host and a secret token', () => {
    const { rooms, transport } = setup();
    const joined = data(rooms.createRoom('s1', IP, 'Ana'));
    expect(joined.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(joined.room).toMatchObject({ code: 'ROOM00', status: 'lobby', you: joined.playerId, hostId: joined.playerId });
    expect(joined.room.members).toEqual([{ id: joined.playerId, name: 'Ana', isBot: false, isHost: true, connected: true }]);
    expect(joined.room.settings).toEqual({ minPlayers: 2, maxPlayers: 6, turnMs: T.turnMs });
    rooms.flush();
    expect(transport.last('s1', 'room:state')?.members).toHaveLength(1);
    expect(JSON.stringify(transport.sent.get('s1'))).not.toContain(joined.token);
  });

  it('lets others join by code and tells everyone', () => {
    const { rooms, transport, host, guest } = lobby();
    expect(guest.playerId).not.toBe(host.playerId);
    expect(guest.token).not.toBe(host.token);
    expect(transport.last('s1', 'room:state')?.members.map((m) => m.name)).toEqual(['Ana', 'Bia']);
    expect(transport.last('s2', 'room:state')?.you).toBe(guest.playerId);
    expect(transport.last('s1', 'room:state')?.you).toBe(host.playerId);
    expect(rooms.roomCount).toBe(1);
  });

  it('refuses unknown codes, a second room for the same connection and full rooms', () => {
    const { rooms, roomCode } = lobby();
    expect(code(rooms.joinRoom('s3', 'NOPE00', 'Caio'))).toBe('ROOM_NOT_FOUND');
    expect(code(rooms.joinRoom('s1', roomCode, 'Ana'))).toBe('ALREADY_IN_ROOM');
    expect(code(rooms.createRoom('s2', IP, 'Bia'))).toBe('ALREADY_IN_ROOM');
    for (let i = 0; i < 4; i++) data(rooms.addBot('s1'));
    expect(code(rooms.joinRoom('s3', roomCode, 'Caio'))).toBe('ROOM_FULL');
    expect(code(rooms.addBot('s1'))).toBe('ROOM_FULL');
  });

  it('limits rooms per address and in total', () => {
    const { rooms } = setup(testConfig({ limits: { maxRoomsPerIp: 1, maxRooms: 2 } }));
    data(rooms.createRoom('s1', IP, 'A'));
    expect(code(rooms.createRoom('s2', IP, 'B'))).toBe('ROOM_LIMIT');
    expect(code(rooms.quickPlay('s2', IP, 'B', 1))).toBe('ROOM_LIMIT');
    data(rooms.createRoom('s3', '10.0.0.2', 'C'));
    expect(code(rooms.createRoom('s4', '10.0.0.3', 'D'))).toBe('ROOM_LIMIT');
    data(rooms.leave('s1')); // last human leaves: the room closes and frees the slot
    data(rooms.createRoom('s2', IP, 'B'));
  });
});

describe('host controls', () => {
  it('adds and removes bots; only the host may', () => {
    const { rooms, transport } = lobby();
    expect(code(rooms.addBot('s2'))).toBe('NOT_HOST');
    data(rooms.addBot('s1'));
    data(rooms.addBot('s1'));
    rooms.flush();
    const members = transport.last('s2', 'room:state')?.members ?? [];
    expect(members.filter((m) => m.isBot).map((m) => m.name)).toEqual(['Bot 1', 'Bot 2']);
    const bot = members.find((m) => m.isBot);
    const human = members.find((m) => !m.isBot && !m.isHost);
    expect(code(rooms.removeBot('s2', bot?.id ?? ''))).toBe('NOT_HOST');
    expect(code(rooms.removeBot('s1', human?.id ?? ''))).toBe('NOT_A_BOT');
    expect(code(rooms.removeBot('s1', '__proto__'))).toBe('NOT_A_BOT');
    data(rooms.removeBot('s1', bot?.id ?? ''));
    rooms.flush();
    expect(transport.last('s2', 'room:state')?.members.filter((m) => m.isBot).map((m) => m.name)).toEqual(['Bot 2']);
    data(rooms.addBot('s1'));
    rooms.flush();
    expect(transport.last('s2', 'room:state')?.members.filter((m) => m.isBot).map((m) => m.name)).toEqual(['Bot 2', 'Bot 1']);
  });

  it('starts only with enough players, and only the host', () => {
    const { rooms } = setup();
    data(rooms.createRoom('s1', IP, 'Ana'));
    expect(code(rooms.start('s1'))).toBe('NOT_ENOUGH_PLAYERS');
    expect(code(rooms.start('s9'))).toBe('NOT_IN_ROOM');
    data(rooms.addBot('s1'));
    data(rooms.start('s1'));
    expect(code(rooms.start('s1'))).toBe('GAME_IN_PROGRESS');
  });

  it('sends each player their own view when the game starts', () => {
    const { rooms, transport, host, guest, roomCode } = lobby();
    expect(code(rooms.start('s2'))).toBe('NOT_HOST');
    data(rooms.start('s1'));
    rooms.flush();
    expect(transport.last('s1', 'room:state')?.status).toBe('playing');
    expect(transport.last('s1', 'game:update')?.view.you).toBe(host.playerId);
    expect(transport.last('s2', 'game:update')?.view.you).toBe(guest.playerId);
    expect(code(rooms.joinRoom('s3', roomCode, 'Caio'))).toBe('ROOM_IN_GAME');
    expect(code(rooms.addBot('s1'))).toBe('GAME_IN_PROGRESS');
    expect(code(rooms.removeBot('s1', 'x'))).toBe('GAME_IN_PROGRESS');
  });
});

describe('playing through the manager', () => {
  function started() {
    const env = lobby();
    data(env.rooms.start('s1'));
    env.rooms.flush();
    env.clock.advance(T.arrangeMs);
    env.clock.advance(T.initialPeekMs);
    const session = env.rooms.inspect(env.roomCode)?.session as GameSession;
    const current = session.internalState.turn?.playerId;
    const [currentSocket, otherSocket] = current === env.host.playerId ? ['s1', 's2'] : ['s2', 's1'];
    return { ...env, session, currentSocket, otherSocket };
  }

  it('drives the phases with one timer per room', () => {
    const env = lobby();
    data(env.rooms.start('s1'));
    env.rooms.flush();
    expect(env.clock.pendingTimers).toBe(1);
    env.clock.advance(T.arrangeMs);
    expect(env.transport.last('s1', 'game:update')?.view.phase).toBe('initialPeek');
    expect(env.clock.pendingTimers).toBe(1);
    env.clock.advance(T.initialPeekMs);
    const update = env.transport.last('s2', 'game:update');
    expect(update?.view.phase).toBe('playing');
    expect(update?.turnDeadline).toBe(env.clock.now + T.turnMs);
  });

  it('applies actions for the bound player only and refuses the rest', () => {
    const { rooms, transport, currentSocket, otherSocket, session } = started();
    expect(code(rooms.act(otherSocket, { type: 'draw' }))).toBe('NOT_YOUR_TURN');
    expect(code(rooms.act('nobody', { type: 'draw' }))).toBe('NOT_IN_ROOM');
    transport.clear();
    data(rooms.act(currentSocket, { type: 'draw' }));
    rooms.flush();
    const mine = transport.last(currentSocket, 'game:update');
    const theirs = transport.last(otherSocket, 'game:update');
    expect(mine?.view.turn?.drawnCard).toEqual(session.internalState.turn?.drawnCard);
    expect(theirs?.view.turn?.drawnCard).toBeNull();
    expect(theirs?.view.turn?.hasDrawnCard).toBe(true);
    expect(mine?.events).toEqual([{ type: 'cardDrawn', playerId: session.internalState.turn?.playerId }]);
  });

  it('refuses game actions in the lobby', () => {
    const { rooms } = lobby();
    expect(code(rooms.act('s1', { type: 'draw' }))).toBe('NO_GAME');
  });

  it('covers a player who does not act with the turn timer', () => {
    const { clock, transport, currentSocket, session } = started();
    const player = session.internalState.turn?.playerId;
    clock.advance(T.turnMs);
    const events: ServerGameEvent[] = transport.of(currentSocket).flatMap((m) => (m.type === 'game:update' ? m.data.events : []));
    expect(events).toContainEqual(expect.objectContaining({ type: 'turnTimedOut', playerId: player, step: 'draw' }));
    clock.advance(T.reactionWindowMs);
    expect(session.internalState.turn?.playerId).not.toBe(player);
  });

  it('plays a whole game against bots with "jogar contra bots"', () => {
    const { rooms, clock, transport } = setup();
    expect(code(rooms.quickPlay('s0', IP, 'Ana', RULES.players.max))).toBe('ROOM_FULL');
    const joined = data(rooms.quickPlay('s1', IP, 'Ana', 3));
    rooms.flush();
    expect(joined.room.status).toBe('playing');
    expect(joined.room.members.filter((m) => m.isBot)).toHaveLength(3);
    expect(transport.last('s1', 'game:update')?.view.players).toHaveLength(4);
    // The human never acts: the turn timer plays for them, bots play on their own.
    for (let i = 0; i < 2000 && rooms.inspect(joined.room.code)?.status === 'playing'; i++) clock.advance(1000);
    expect(rooms.inspect(joined.room.code)?.status).toBe('ended');
    expect(transport.last('s1', 'room:state')?.status).toBe('ended');
    expect(transport.last('s1', 'game:update')?.view.result).not.toBeNull();
    expect(clock.pendingTimers).toBe(0);
  });
});

describe('sessions and reconnection', () => {
  it('keeps the seat when a connection drops and gives it back with the token', () => {
    const { rooms, transport, host, guest } = lobby();
    data(rooms.start('s1'));
    rooms.flush();
    rooms.disconnect('s2');
    rooms.flush();
    expect(transport.last('s1', 'room:state')?.members.find((m) => m.id === guest.playerId)?.connected).toBe(false);
    expect(code(rooms.act('s2', { type: 'draw' }))).toBe('NOT_IN_ROOM');

    transport.clear();
    const resumed = data(rooms.resume('s3', guest.token));
    rooms.flush();
    expect(resumed.playerId).toBe(guest.playerId);
    expect(transport.last('s3', 'room:state')?.you).toBe(guest.playerId);
    const snapshot = transport.last('s3', 'game:update');
    expect(snapshot?.view.you).toBe(guest.playerId);
    expect(snapshot?.events).toEqual([]);
    expect(transport.last('s1', 'room:state')?.members.every((m) => m.connected)).toBe(true);
    expect(host.token).not.toBe(guest.token);
  });

  it('refuses unknown tokens and moves the seat to the newest connection', () => {
    const { rooms, transport, guest } = lobby();
    expect(code(rooms.resume('s3', 'x'.repeat(43)))).toBe('INVALID_SESSION');
    data(rooms.resume('s3', guest.token)); // s2 is still connected: it gets replaced
    expect(transport.of('s2').some((m) => m.type === 'session:replaced')).toBe(true);
    expect(code(rooms.leave('s2'))).toBe('NOT_IN_ROOM');
    expect(code(rooms.resume('s1', guest.token))).toBe('ALREADY_IN_ROOM'); // s1 is someone else
    data(rooms.resume('s3', guest.token)); // same connection again: fine
  });

  it('a player who leaves loses the token; the host role moves on', () => {
    const { rooms, transport, host, guest } = lobby();
    data(rooms.leave('s1'));
    rooms.flush();
    expect(code(rooms.resume('s9', host.token))).toBe('INVALID_SESSION');
    const room = transport.last('s2', 'room:state');
    expect(room?.hostId).toBe(guest.playerId);
    expect(room?.members.map((m) => m.id)).toEqual([guest.playerId]);
  });

  it('leaving during a game keeps the seat (covered by the timer) until the game ends', () => {
    const { rooms, transport, host, roomCode } = lobby();
    data(rooms.start('s1'));
    data(rooms.leave('s1'));
    rooms.flush();
    const members = transport.last('s2', 'room:state')?.members ?? [];
    expect(members.find((m) => m.id === host.playerId)).toMatchObject({ connected: false });
    expect(rooms.inspect(roomCode)?.members.find((m) => m.id === host.playerId)?.left).toBe(true);
    expect(code(rooms.resume('s9', host.token))).toBe('INVALID_SESSION');
  });

  it('closes the room when the last human leaves', () => {
    const { rooms } = setup();
    const joined = data(rooms.quickPlay('s1', IP, 'Ana', 2));
    expect(rooms.inspect(joined.room.code)).not.toBeNull();
    data(rooms.leave('s1'));
    expect(rooms.inspect(joined.room.code)).toBeNull();
    expect(rooms.roomCount).toBe(0);
  });
});

describe('cleanup', () => {
  const config = testConfig({ rooms: { idleTtlMs: 60_000, emptyTtlMs: 30_000, lobbyReconnectGraceMs: 10_000 } });

  it('closes idle rooms and tells who is connected', () => {
    const { rooms, clock, transport, roomCode } = lobby(config);
    clock.advance(59_000);
    rooms.sweep();
    expect(rooms.inspect(roomCode)).not.toBeNull();
    clock.advance(1_000);
    rooms.sweep();
    expect(rooms.inspect(roomCode)).toBeNull();
    expect(transport.last('s1', 'room:closed')).toEqual({ code: roomCode, reason: 'idle' });
    expect(transport.last('s2', 'room:closed')).toEqual({ code: roomCode, reason: 'idle' });
    expect(code(rooms.act('s1', { type: 'draw' }))).toBe('NOT_IN_ROOM');
  });

  it('closes a running game nobody is connected to', () => {
    const { rooms, clock, roomCode, guest } = lobby(config);
    data(rooms.start('s1'));
    rooms.disconnect('s1');
    rooms.disconnect('s2');
    clock.advance(29_000);
    rooms.sweep();
    expect(rooms.inspect(roomCode)?.status).toBe('playing');
    clock.advance(1_000);
    rooms.sweep();
    expect(rooms.inspect(roomCode)).toBeNull();
    expect(clock.pendingTimers).toBe(0);
    expect(code(rooms.resume('s3', guest.token))).toBe('INVALID_SESSION');
  });

  it('frees lobby seats of people who did not come back', () => {
    const { rooms, clock, transport, roomCode, guest } = lobby(config);
    rooms.disconnect('s1'); // the host
    clock.advance(10_000);
    rooms.sweep();
    const room = rooms.inspect(roomCode);
    expect(room?.members.map((m) => m.id)).toEqual([guest.playerId]);
    expect(room?.hostId).toBe(guest.playerId);
    expect(transport.last('s2', 'room:state')?.hostId).toBe(guest.playerId);
  });

  it('closes the room when an unexpected error happens in the game', () => {
    const { rooms, transport, roomCode } = lobby();
    data(rooms.start('s1'));
    vi.spyOn(GameSession.prototype, 'act').mockImplementation(() => {
      throw new Error('boom');
    });
    expect(code(rooms.act('s1', { type: 'draw' }))).toBe('INTERNAL_ERROR');
    expect(rooms.inspect(roomCode)).toBeNull();
    expect(transport.last('s2', 'room:closed')).toEqual({ code: roomCode, reason: 'error' });
  });
});

describe('room view', () => {
  it('never contains a token or a card', () => {
    const { rooms, transport, host, guest } = lobby();
    data(rooms.start('s1'));
    rooms.flush();
    const roomStates = [...transport.sent.values()].flat().filter((m) => m.type === 'room:state');
    const text = JSON.stringify(roomStates);
    expect(text).not.toContain(host.token);
    expect(text).not.toContain(guest.token);
    expect(text).not.toMatch(/"kind"|"rank"|"suit"/);
  });

  it('keeps the seat order of joining for the game', () => {
    const { rooms, host, guest, roomCode } = lobby();
    data(rooms.addBot('s1'));
    data(rooms.start('s1'));
    const order = rooms.inspect(roomCode)?.session?.internalState.players.map((p) => p.id);
    expect(order?.slice(0, 2)).toEqual([host.playerId, guest.playerId]);
    const joined: JoinedRoom = host;
    expect(joined.room.code).toBe(roomCode);
  });
});
