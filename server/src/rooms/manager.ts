import {
  RANKS,
  type Action,
  type GameUpdate,
  type JoinedRoom,
  type PlayerId,
  type Rank,
  type ResumedSession,
  type RoomClosed,
  type RoomClosedReason,
  type RoomStatus,
  type RoomView,
  type ServerErrorCode,
  type SetTableSettingsPayload,
  type TableSettingsView,
} from '@moises/shared';
import type { ServerConfig } from '../config/env.js';
import { type RulesConfig } from '../config/rules.js';
import { generateSeed } from '../engine/index.js';
import { GameSession } from '../game/session.js';
import { hashToken, newPlayerId, newRoomCode, newSessionToken } from '../util/ids.js';
import { silentLogger, type Logger } from '../util/log.js';

// Rooms, seats and sessions. Knows nothing about sockets: it identifies a
// connection only by its server-generated socket id and talks back through a
// Transport. Every lookup uses Maps; ids sent by clients are only ever used as
// Map keys or compared, never as object property names.
//
// Identity: the player a connection controls comes only from the binding made
// here (create / join / resume). Nothing in a payload can select a player.

export interface Transport {
  roomState(socketId: string, room: RoomView): void;
  gameUpdate(socketId: string, update: GameUpdate): void;
  roomClosed(socketId: string, info: RoomClosed): void;
  /** Another connection resumed this player's session. */
  sessionReplaced(socketId: string): void;
}

export interface Scheduler {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface RoomManagerDeps {
  now(): number;
  /** Bot timing and tie-breaks. */
  random(): number;
  /** Secret shuffle seed for each new game. */
  seed(): string;
  roomCode(length: number): string;
  playerId(): string;
  token(): string;
  readonly scheduler: Scheduler;
}

export const DEFAULT_DEPS: RoomManagerDeps = {
  now: () => Date.now(),
  random: () => Math.random(),
  seed: generateSeed,
  roomCode: (length) => newRoomCode(length),
  playerId: newPlayerId,
  token: newSessionToken,
  scheduler: {
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  },
};

export type Outcome<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly code: ServerErrorCode };

interface Member {
  readonly id: PlayerId;
  readonly name: string;
  /** Becomes true when a human leaves during a game (a bot takes the seat). */
  isBot: boolean;
  /** SHA-256 of the session token (humans). The raw token is never stored. */
  tokenHash: string | null;
  socketId: string | null;
  disconnectedAt: number | null;
  /** Joined while a game was running: waits for the next game (spectates meanwhile). */
  queued: boolean;
}

interface Room {
  readonly code: string;
  readonly creatorIp: string;
  /** Insertion order is the seat order. */
  readonly members: Map<PlayerId, Member>;
  hostId: PlayerId;
  /** Table settings chosen by the host; the rules of the next game. */
  table: TableSettings;
  session: GameSession | null;
  lastActivityAt: number;
  /** Since when no human is connected (null while someone is). */
  noHumanSince: number | null;
  timer: unknown;
  /** Session version already sent to clients. */
  sentVersion: number;
  lastStatus: RoomStatus;
}

interface TableSettings {
  turnMs: number;
  matchOwn: boolean;
  matchOpponent: boolean;
  /** Ranks whose power is on. */
  powers: ReadonlySet<Rank>;
}

interface Binding {
  readonly roomCode: string;
  readonly playerId: PlayerId;
}

export interface RoomManagerOptions {
  readonly config: ServerConfig;
  readonly rules: RulesConfig;
  readonly transport: Transport;
  readonly logger?: Logger;
  readonly deps?: Partial<RoomManagerDeps>;
}

/** Read-only snapshot of a room, for tests and diagnostics. */
export interface RoomInspection {
  readonly code: string;
  readonly status: RoomStatus;
  readonly hostId: PlayerId;
  readonly members: readonly Readonly<Omit<Member, 'tokenHash'>>[];
  readonly session: GameSession | null;
}

const MAX_CODE_ATTEMPTS = 100;

function ok<T>(data: T): Outcome<T> {
  return { ok: true, data };
}

function fail<T = never>(code: ServerErrorCode): Outcome<T> {
  return { ok: false, code };
}

export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  /** tokenHash -> seat. */
  private readonly sessions = new Map<string, Binding>();
  /** socket id -> seat. The only source of "who is this connection". */
  private readonly bindings = new Map<string, Binding>();
  private readonly roomsByIp = new Map<string, number>();
  /** Rooms with changes not yet sent; true = the room info (not only the game) changed. */
  private readonly dirty = new Map<Room, boolean>();
  /** Connections that need a full game snapshot on the next flush. */
  private readonly snapshots = new Set<string>();
  private readonly config: ServerConfig;
  private readonly rules: RulesConfig;
  private readonly transport: Transport;
  private readonly logger: Logger;
  private readonly deps: RoomManagerDeps;

  constructor(options: RoomManagerOptions) {
    this.config = options.config;
    this.rules = options.rules;
    this.transport = options.transport;
    this.logger = options.logger ?? silentLogger;
    this.deps = { ...DEFAULT_DEPS, ...options.deps };
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  // --- requests ------------------------------------------------------------------

  createRoom(socketId: string, ip: string, name: string): Outcome<JoinedRoom> {
    if (this.bindings.has(socketId)) return fail('ALREADY_IN_ROOM');
    const limit = this.checkRoomLimit(ip);
    if (limit) return fail(limit);
    const room = this.newRoom(ip);
    const { member, token } = this.addHuman(room, name);
    room.hostId = member.id;
    this.bind(socketId, room, member);
    this.markDirty(room, true);
    return ok({ playerId: member.id, token, room: this.roomView(room, member.id) });
  }

  /** "Jogar contra bots": a new room with `bots` bots, started at once. */
  quickPlay(socketId: string, ip: string, name: string, bots: number): Outcome<JoinedRoom> {
    if (this.bindings.has(socketId)) return fail('ALREADY_IN_ROOM');
    if (bots < 1 || 1 + bots > this.rules.players.max) return fail('ROOM_FULL');
    if (1 + bots < this.rules.players.min) return fail('NOT_ENOUGH_PLAYERS');
    const limit = this.checkRoomLimit(ip);
    if (limit) return fail(limit);
    const room = this.newRoom(ip);
    const { member, token } = this.addHuman(room, name);
    room.hostId = member.id;
    for (let i = 0; i < bots; i++) this.addBotMember(room);
    this.bind(socketId, room, member);
    this.startGame(room);
    return ok({ playerId: member.id, token, room: this.roomView(room, member.id) });
  }

  joinRoom(socketId: string, code: string, name: string): Outcome<JoinedRoom> {
    if (this.bindings.has(socketId)) return fail('ALREADY_IN_ROOM');
    const room = this.rooms.get(code);
    if (!room) return fail('ROOM_NOT_FOUND');
    const playing = this.status(room) === 'playing';
    // Mid-game arrivals wait in the queue (as many as there are seats) for the next game.
    if (playing ? this.queue(room).length >= this.rules.players.max : this.seated(room).length >= this.rules.players.max) {
      return fail('ROOM_FULL');
    }
    const { member, token } = this.addHuman(room, name);
    member.queued = playing;
    this.bind(socketId, room, member);
    this.touch(room);
    this.markDirty(room, true);
    return ok({ playerId: member.id, token, room: this.roomView(room, member.id) });
  }

  /** Reconnection: the token is the only proof of identity. */
  resume(socketId: string, token: string): Outcome<ResumedSession> {
    const seat = this.sessions.get(hashToken(token));
    if (!seat) return fail('INVALID_SESSION');
    const room = this.rooms.get(seat.roomCode);
    const member = room?.members.get(seat.playerId);
    if (!room || !member) {
      this.sessions.delete(hashToken(token));
      return fail('INVALID_SESSION');
    }
    const current = this.bindings.get(socketId);
    if (current) {
      if (current.roomCode !== room.code || current.playerId !== member.id) return fail('ALREADY_IN_ROOM');
    } else {
      if (member.socketId !== null && member.socketId !== socketId) {
        // One connection per player: the newest wins.
        this.bindings.delete(member.socketId);
        this.transport.sessionReplaced(member.socketId);
      }
      this.bind(socketId, room, member);
    }
    this.touch(room);
    this.markDirty(room, true);
    this.snapshots.add(socketId);
    return ok({ playerId: member.id, room: this.roomView(room, member.id) });
  }

  leave(socketId: string): Outcome<null> {
    const found = this.lookup(socketId);
    if (!found) return fail('NOT_IN_ROOM');
    const { room, member } = found;
    this.bindings.delete(socketId);
    if (member.tokenHash) this.sessions.delete(member.tokenHash);
    member.tokenHash = null;
    member.socketId = null;
    if (this.status(room) === 'playing' && !member.queued) {
      // The seat stays and a bot plays it from now on.
      member.isBot = true;
      member.disconnectedAt = null;
      const session = room.session;
      if (session && this.guard(room, () => session.replaceWithBot(member.id, this.deps.now())) === null) {
        return ok(null); // room closed by guard
      }
      this.logger.info('human replaced by bot', { room: room.code });
    } else {
      room.members.delete(member.id);
    }
    this.markDirty(room, true);
    this.afterHumanGone(room);
    if (this.rooms.get(room.code) === room) this.afterGameChange(room);
    return ok(null);
  }

  addBot(socketId: string): Outcome<null> {
    const host = this.hostContext(socketId);
    if (!host.ok) return host;
    const room = host.data;
    if (this.status(room) === 'playing') return fail('GAME_IN_PROGRESS');
    if (this.seated(room).length >= this.rules.players.max) return fail('ROOM_FULL');
    this.addBotMember(room);
    this.markDirty(room, true);
    return ok(null);
  }

  removeBot(socketId: string, botId: PlayerId): Outcome<null> {
    const host = this.hostContext(socketId);
    if (!host.ok) return host;
    const room = host.data;
    if (this.status(room) === 'playing') return fail('GAME_IN_PROGRESS');
    const target = room.members.get(botId);
    if (!target || !target.isBot || target.queued) return fail('NOT_A_BOT');
    room.members.delete(botId);
    this.markDirty(room, true);
    return ok(null);
  }

  start(socketId: string): Outcome<null> {
    const host = this.hostContext(socketId);
    if (!host.ok) return host;
    const room = host.data;
    if (this.status(room) === 'playing') return fail('GAME_IN_PROGRESS');
    this.promoteQueue(room);
    const seated = this.seated(room).length;
    if (seated < this.rules.players.min) return fail('NOT_ENOUGH_PLAYERS');
    if (seated > this.rules.players.max) return fail('ROOM_FULL');
    this.startGame(room);
    return ok(null);
  }

  /** The host sets the table settings (lobby or between games). Validated by TableSettingsSchema before; checked against the rules here. */
  setTable(socketId: string, settings: SetTableSettingsPayload): Outcome<null> {
    const host = this.hostContext(socketId);
    if (!host.ok) return host;
    const room = host.data;
    if (this.status(room) === 'playing') return fail('GAME_IN_PROGRESS');
    const available = new Set(this.basePowerRanks());
    if (settings.powers.some((rank) => !available.has(rank))) return fail('BAD_REQUEST');
    room.table = {
      turnMs: settings.turnSeconds * 1000,
      matchOwn: settings.reactions.matchOwn,
      matchOpponent: settings.reactions.matchOpponent,
      powers: new Set(settings.powers),
    };
    this.markDirty(room, true);
    return ok(null);
  }

  /** A game action from the player bound to this connection. */
  act(socketId: string, action: Action): Outcome<null> {
    const found = this.lookup(socketId);
    if (!found) return fail('NOT_IN_ROOM');
    const { room, member } = found;
    this.touch(room);
    const session = room.session;
    if (!session) return fail('NO_GAME');
    const result = this.guard(room, () => session.act(member.id, action, this.deps.now()));
    if (!result) return fail('INTERNAL_ERROR');
    this.afterGameChange(room);
    return result.ok ? ok(null) : fail(result.error.code);
  }

  /** The connection dropped. The seat stays (reconnect with the token). */
  disconnect(socketId: string): void {
    const found = this.lookup(socketId);
    this.bindings.delete(socketId);
    this.snapshots.delete(socketId);
    if (!found) return;
    const { room, member } = found;
    if (member.socketId !== socketId) return;
    member.socketId = null;
    member.disconnectedAt = this.deps.now();
    this.updatePresence(room);
    this.markDirty(room, true);
  }

  /** Periodic cleanup: idle rooms, rooms without connected humans, lobby seats of people who never came back. */
  sweep(): void {
    const now = this.deps.now();
    const { idleTtlMs, emptyTtlMs, lobbyReconnectGraceMs } = this.config.rooms;
    for (const room of [...this.rooms.values()]) {
      if (now - room.lastActivityAt >= idleTtlMs) {
        this.closeRoom(room, 'idle');
        continue;
      }
      if (room.noHumanSince !== null && now - room.noHumanSince >= emptyTtlMs) {
        this.closeRoom(room, 'empty');
        continue;
      }
      if (this.status(room) === 'playing') continue;
      let removed = false;
      for (const member of [...room.members.values()]) {
        if (member.isBot || member.socketId !== null || member.disconnectedAt === null) continue;
        if (now - member.disconnectedAt < lobbyReconnectGraceMs) continue;
        if (member.tokenHash) this.sessions.delete(member.tokenHash);
        room.members.delete(member.id);
        removed = true;
      }
      if (removed) {
        this.markDirty(room, true);
        this.afterHumanGone(room);
      }
    }
    this.flush();
  }

  /** Sends pending room and game updates. Called after each request has been answered and after timers. */
  flush(): void {
    const now = this.deps.now();
    for (const [room, roomChanged] of this.dirty) {
      if (this.rooms.get(room.code) !== room) continue;
      this.flushRoom(room, roomChanged, now);
    }
    this.dirty.clear();
    this.snapshots.clear();
  }

  /** Closes every room (server shutdown). */
  closeAll(reason: RoomClosedReason): void {
    for (const room of [...this.rooms.values()]) this.closeRoom(room, reason);
  }

  /** Test and diagnostics helper. Never expose it to clients. */
  inspect(code: string): RoomInspection | null {
    const room = this.rooms.get(code);
    if (!room) return null;
    return {
      code: room.code,
      status: this.status(room),
      hostId: room.hostId,
      members: [...room.members.values()].map(({ tokenHash: _hidden, ...member }) => ({ ...member })),
      session: room.session,
    };
  }

  // --- internals ------------------------------------------------------------------------

  private status(room: Room): RoomStatus {
    if (!room.session) return 'lobby';
    return room.session.phase === 'ended' ? 'ended' : 'playing';
  }

  private seated(room: Room): Member[] {
    return [...room.members.values()].filter((m) => !m.queued);
  }

  private queue(room: Room): Member[] {
    return [...room.members.values()].filter((m) => m.queued);
  }

  /** Waiting players take the free seats, in arrival order (the rest keep waiting). */
  private promoteQueue(room: Room): void {
    let free = this.rules.players.max - this.seated(room).length;
    for (const member of this.queue(room)) {
      if (free <= 0) break;
      member.queued = false;
      free -= 1;
      this.dirty.set(room, true);
    }
  }

  private basePowerRanks(): Rank[] {
    return RANKS.filter((rank) => this.rules.cards.powers[rank] !== undefined);
  }

  private defaultTable(): TableSettings {
    return {
      turnMs: this.rules.timings.turnMs,
      matchOwn: this.rules.reactions.matchOwn,
      matchOpponent: this.rules.reactions.matchOpponent,
      powers: new Set(this.basePowerRanks()),
    };
  }

  /** The rules of a game at this table: the server rules with the host's table settings applied. */
  private tableRules(room: Room): RulesConfig {
    const { table } = room;
    const powers: RulesConfig['cards']['powers'] = {};
    for (const rank of RANKS) {
      const power = this.rules.cards.powers[rank];
      if (power !== undefined && table.powers.has(rank)) powers[rank] = power;
    }
    return {
      ...this.rules,
      cards: { ...this.rules.cards, powers },
      reactions: { ...this.rules.reactions, matchOwn: table.matchOwn, matchOpponent: table.matchOpponent },
      timings: { ...this.rules.timings, turnMs: table.turnMs },
    };
  }

  private lookup(socketId: string): { room: Room; member: Member } | null {
    const binding = this.bindings.get(socketId);
    if (!binding) return null;
    const room = this.rooms.get(binding.roomCode);
    const member = room?.members.get(binding.playerId);
    if (!room || !member) {
      this.bindings.delete(socketId);
      return null;
    }
    return { room, member };
  }

  private hostContext(socketId: string): Outcome<Room> {
    const found = this.lookup(socketId);
    if (!found) return fail('NOT_IN_ROOM');
    this.touch(found.room);
    if (found.room.hostId !== found.member.id) return fail('NOT_HOST');
    return ok(found.room);
  }

  private checkRoomLimit(ip: string): ServerErrorCode | null {
    if (this.rooms.size >= this.config.limits.maxRooms) return 'ROOM_LIMIT';
    if ((this.roomsByIp.get(ip) ?? 0) >= this.config.limits.maxRoomsPerIp) return 'ROOM_LIMIT';
    return null;
  }

  private newRoom(ip: string): Room {
    let code = '';
    for (let attempt = 0; ; attempt++) {
      if (attempt >= MAX_CODE_ATTEMPTS) throw new Error('could not find a free room code');
      code = this.deps.roomCode(this.config.rooms.codeLength);
      if (!this.rooms.has(code)) break;
    }
    const now = this.deps.now();
    const room: Room = {
      code,
      creatorIp: ip,
      members: new Map(),
      hostId: '',
      table: this.defaultTable(),
      session: null,
      lastActivityAt: now,
      noHumanSince: null,
      timer: null,
      sentVersion: -1,
      lastStatus: 'lobby',
    };
    this.rooms.set(code, room);
    this.roomsByIp.set(ip, (this.roomsByIp.get(ip) ?? 0) + 1);
    this.logger.info('room created', { room: code, rooms: this.rooms.size });
    return room;
  }

  private uniquePlayerId(room: Room): PlayerId {
    for (;;) {
      const id = this.deps.playerId();
      if (!room.members.has(id)) return id;
    }
  }

  private addHuman(room: Room, name: string): { member: Member; token: string } {
    const token = this.deps.token();
    const member: Member = {
      id: this.uniquePlayerId(room),
      name,
      isBot: false,
      tokenHash: hashToken(token),
      socketId: null,
      disconnectedAt: null,
      queued: false,
    };
    room.members.set(member.id, member);
    this.sessions.set(member.tokenHash as string, { roomCode: room.code, playerId: member.id });
    return { member, token };
  }

  private addBotMember(room: Room): Member {
    const used = new Set([...room.members.values()].filter((m) => m.isBot).map((m) => m.name));
    let n = 1;
    while (used.has(`Bot ${n}`)) n += 1;
    const member: Member = {
      id: this.uniquePlayerId(room),
      name: `Bot ${n}`,
      isBot: true,
      tokenHash: null,
      socketId: null,
      disconnectedAt: null,
      queued: false,
    };
    room.members.set(member.id, member);
    return member;
  }

  private bind(socketId: string, room: Room, member: Member): void {
    this.bindings.set(socketId, { roomCode: room.code, playerId: member.id });
    member.socketId = socketId;
    member.disconnectedAt = null;
    room.noHumanSince = null;
  }

  private touch(room: Room): void {
    room.lastActivityAt = this.deps.now();
  }

  private updatePresence(room: Room): void {
    const anyone = [...room.members.values()].some((m) => !m.isBot && m.socketId !== null);
    if (anyone) room.noHumanSince = null;
    else room.noHumanSince ??= this.deps.now();
  }

  /** After a human left or lost the seat: move the host, or close the room when no human is seated. */
  private afterHumanGone(room: Room): void {
    const humans = [...room.members.values()].filter((m) => !m.isBot);
    if (humans.length === 0) {
      this.closeRoom(room, 'empty');
      return;
    }
    if (!humans.some((m) => m.id === room.hostId)) {
      room.hostId = ((humans.find((m) => !m.queued) ?? humans[0]) as Member).id;
    }
    this.updatePresence(room);
  }

  private startGame(room: Room): void {
    const players = this.seated(room).map((m) => ({ id: m.id, name: m.name, isBot: m.isBot }));
    room.session = new GameSession({
      players,
      rules: this.tableRules(room),
      seed: this.deps.seed(),
      now: this.deps.now(),
      random: () => this.deps.random(),
      botDelayMs: { min: this.config.bots.minDelayMs, max: this.config.bots.maxDelayMs },
    });
    room.sentVersion = -1;
    this.touch(room);
    this.logger.info('game started', { room: room.code, players: players.length });
    this.afterGameChange(room);
  }

  /** Runs `work`; on an unexpected failure the room is closed (its state can no longer be trusted). */
  private guard<T>(room: Room, work: () => T): T | null {
    try {
      return work();
    } catch (error) {
      this.logger.error('game session failed; closing room', { room: room.code, error });
      this.closeRoom(room, 'error');
      return null;
    }
  }

  private afterGameChange(room: Room): void {
    if (this.rooms.get(room.code) !== room) return;
    const status = this.status(room);
    if (status !== room.lastStatus) {
      if (status === 'ended') {
        this.logger.info('game ended', { room: room.code });
        this.promoteQueue(room);
      }
      this.dirty.set(room, true);
    }
    if (!this.dirty.has(room)) this.dirty.set(room, false);
    this.schedule(room);
  }

  /** One timer per room, always set to the session's next wake-up. */
  private schedule(room: Room): void {
    const { scheduler } = this.deps;
    if (room.timer !== null) {
      scheduler.clearTimeout(room.timer);
      room.timer = null;
    }
    const at = room.session?.nextWakeAt() ?? null;
    if (at === null) return;
    const delay = Math.max(0, at - this.deps.now());
    room.timer = scheduler.setTimeout(() => this.onTimer(room), delay);
  }

  private onTimer(room: Room): void {
    room.timer = null;
    const session = room.session;
    if (this.rooms.get(room.code) !== room || !session) return;
    if (this.guard(room, () => (session.advance(this.deps.now()), true)) === null) return;
    this.afterGameChange(room);
    this.flush();
  }

  private markDirty(room: Room, roomChanged: boolean): void {
    this.dirty.set(room, roomChanged || this.dirty.get(room) === true);
  }

  private flushRoom(room: Room, roomChanged: boolean, now: number): void {
    const status = this.status(room);
    const statusChanged = status !== room.lastStatus;
    room.lastStatus = status;
    const session = room.session;
    let events: GameUpdate['events'] | null = null;
    if (session && session.version !== room.sentVersion) {
      events = session.drainEvents();
      room.sentVersion = session.version;
    }
    for (const member of room.members.values()) {
      const socketId = member.socketId;
      if (socketId === null) continue;
      if (roomChanged || statusChanged) this.transport.roomState(socketId, this.roomView(room, member.id));
      if (session && (events !== null || this.snapshots.has(socketId))) {
        this.transport.gameUpdate(socketId, {
          view: session.viewFor(member.id, now),
          turnDeadline: session.turnDeadline,
          events: events ?? [],
        });
      }
    }
  }

  private roomView(room: Room, you: PlayerId): RoomView {
    return {
      code: room.code,
      status: this.status(room),
      you,
      hostId: room.hostId,
      members: this.seated(room).map((m) => ({
        id: m.id,
        name: m.name,
        isBot: m.isBot,
        isHost: m.id === room.hostId,
        connected: m.isBot || m.socketId !== null,
      })),
      settings: {
        minPlayers: this.rules.players.min,
        maxPlayers: this.rules.players.max,
        turnMs: room.table.turnMs,
      },
      table: this.tableView(room),
      queue: this.queue(room).map((m) => ({ id: m.id, name: m.name, connected: m.socketId !== null })),
    };
  }

  private tableView(room: Room): TableSettingsView {
    const { table } = room;
    return {
      turnSeconds: table.turnMs / 1000,
      reactions: { matchOwn: table.matchOwn, matchOpponent: table.matchOpponent },
      powers: RANKS.filter((rank) => table.powers.has(rank)),
    };
  }

  private closeRoom(room: Room, reason: RoomClosedReason): void {
    if (this.rooms.get(room.code) !== room) return;
    if (room.timer !== null) {
      this.deps.scheduler.clearTimeout(room.timer);
      room.timer = null;
    }
    for (const member of room.members.values()) {
      if (member.tokenHash) this.sessions.delete(member.tokenHash);
      if (member.socketId !== null) {
        this.bindings.delete(member.socketId);
        this.snapshots.delete(member.socketId);
        this.transport.roomClosed(member.socketId, { code: room.code, reason });
        member.socketId = null;
      }
    }
    this.rooms.delete(room.code);
    this.dirty.delete(room);
    const count = (this.roomsByIp.get(room.creatorIp) ?? 1) - 1;
    if (count <= 0) this.roomsByIp.delete(room.creatorIp);
    else this.roomsByIp.set(room.creatorIp, count);
    this.logger.info('room closed', { room: room.code, reason, rooms: this.rooms.size });
  }
}
