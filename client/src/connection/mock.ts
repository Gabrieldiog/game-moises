import {
  ROOM_CODE_ALPHABET,
  parseAction,
  type Action,
  type GameView,
  type RoomMemberView,
  type RoomView,
  type SetTableSettingsPayload,
  type TableSettingsView,
} from '@moises/shared';
import {
  DEMO_NAMES,
  DEMO_SCRIPT,
  DEMO_SERVER,
  buildScenario,
  scenarioTurnDeadline,
  type ScenarioId,
} from '../demo/fixtures';
import type {
  ConnectionError,
  ConnectionEvent,
  ConnectionListener,
  ConnectionStatus,
  GameConnection,
  RequestName,
  RequestResult,
} from './types';
import { checkBots, checkCode, checkName, checkTable } from './validate';

// Local stand-in for the game server, used ONLY by the demo mode (no
// VITE_SERVER_URL, or ?demo=...). It answers lobby requests with fake rooms in
// the official RoomView shape and plays back fixture GameViews. It never
// decides a real game outcome; the little "script" in DEMO_SCRIPT only moves
// between fixtures so the demo feels alive.

type Timer = ReturnType<typeof setTimeout>;

export interface MockOptions {
  /** Start straight at a scene (demo mode) instead of the lobby. */
  readonly scenario?: ScenarioId;
  readonly players?: number;
  /** Multiplies the demo durations. */
  readonly timeScale?: number;
  /** Follow DEMO_SCRIPT (deadlines and actions move to the next scene). Default true. */
  readonly autoAdvance?: boolean;
  /** Clock used to stamp views (tests pass a fake one). */
  readonly now?: () => number;
}

const YOU = 's0';
const OK: RequestResult = { ok: true };

export class MockConnection implements GameConnection {
  readonly kind = 'mock' as const;
  private status: ConnectionStatus = 'idle';
  private readonly listeners = new Set<ConnectionListener>();
  private room: RoomView | null = null;
  private scenario: ScenarioId | null = null;
  private names: readonly string[] | undefined;
  private players: number;
  private timer: Timer | null = null;
  private readonly sent: Action[] = [];
  private readonly now: () => number;
  private botSeq = 0;
  private table: TableSettingsView = DEMO_SERVER.table;

  constructor(private readonly options: MockOptions = {}) {
    this.players = options.players ?? DEMO_SERVER.players.min;
    this.now = options.now ?? Date.now;
  }

  // --- GameConnection ---------------------------------------------------------

  getStatus(): ConnectionStatus {
    return this.status;
  }

  connect(): void {
    if (this.status === 'connected' || this.status === 'connecting') return;
    this.setStatus('connecting');
    queueMicrotask(() => {
      this.setStatus('connected');
      if (this.options.scenario) this.loadScenario(this.options.scenario, this.players);
    });
  }

  disconnect(): void {
    this.clearTimer();
    this.setStatus('disconnected');
  }

  subscribe(listener: ConnectionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  createRoom(name: string): Promise<RequestResult> {
    const checked = checkName(name, 'room:create');
    if (!checked.ok) return this.refuse(checked.error);
    this.setRoom(randomCode(), 'lobby', YOU, [member(YOU, checked.value, false)]);
    return Promise.resolve(OK);
  }

  joinRoom(code: string, name: string): Promise<RequestResult> {
    const checkedName = checkName(name, 'room:join');
    if (!checkedName.ok) return this.refuse(checkedName.error);
    const checkedCode = checkCode(code);
    if (!checkedCode.ok) return this.refuse(checkedCode.error);
    this.setRoom(checkedCode.value, 'lobby', 's1', [member('s1', DEMO_NAMES[1], false), member(YOU, checkedName.value, false)]);
    return Promise.resolve(OK);
  }

  quickPlay(name: string, bots: number): Promise<RequestResult> {
    const checkedName = checkName(name, 'room:quickPlay');
    if (!checkedName.ok) return this.refuse(checkedName.error);
    const checkedBots = checkBots(bots);
    if (!checkedBots.ok) return this.refuse(checkedBots.error);
    if (1 + checkedBots.value > DEMO_SERVER.players.max) return this.refuse(error('ROOM_FULL', 'room:quickPlay'));
    const members = [member(YOU, checkedName.value, false), ...Array.from({ length: checkedBots.value }, () => this.newBot())];
    this.setRoom(randomCode(), 'lobby', YOU, members);
    return this.startGame();
  }

  addBot(): Promise<RequestResult> {
    const room = this.room;
    if (!room) return this.refuse(error('NOT_IN_ROOM', 'room:addBot'));
    if (room.hostId !== YOU) return this.refuse(error('NOT_HOST', 'room:addBot'));
    if (room.members.length >= DEMO_SERVER.players.max) return this.refuse(error('ROOM_FULL', 'room:addBot'));
    this.setRoom(room.code, room.status, room.hostId, [...room.members, this.newBot()]);
    return Promise.resolve(OK);
  }

  removeBot(botId: string): Promise<RequestResult> {
    const room = this.room;
    if (!room) return this.refuse(error('NOT_IN_ROOM', 'room:removeBot'));
    if (!room.members.some((m) => m.id === botId && m.isBot)) return this.refuse(error('NOT_A_BOT', 'room:removeBot'));
    this.setRoom(room.code, room.status, room.hostId, room.members.filter((m) => m.id !== botId));
    return Promise.resolve(OK);
  }

  startGame(): Promise<RequestResult> {
    const room = this.room;
    if (!room) return this.refuse(error('NOT_IN_ROOM', 'room:start'));
    if (room.hostId !== YOU) return this.refuse(error('NOT_HOST', 'room:start'));
    if (room.members.length < DEMO_SERVER.players.min) return this.refuse(error('NOT_ENOUGH_PLAYERS', 'room:start'));
    this.setRoom(room.code, 'playing', room.hostId, room.members);
    // You sit first in the fixtures; the others keep the room order.
    const others = room.members.filter((m) => m.id !== YOU).map((m) => m.name);
    const you = room.members.find((m) => m.id === YOU)?.name ?? DEMO_NAMES[0];
    this.loadScenario('arrumacao', room.members.length, [you, ...others]);
    return Promise.resolve(OK);
  }

  setTable(settings: SetTableSettingsPayload): Promise<RequestResult> {
    const room = this.room;
    if (!room) return this.refuse(error('NOT_IN_ROOM', 'room:setTable'));
    if (room.hostId !== YOU) return this.refuse(error('NOT_HOST', 'room:setTable'));
    if (room.status === 'playing') return this.refuse(error('GAME_IN_PROGRESS', 'room:setTable'));
    const checked = checkTable(settings);
    if (!checked.ok) return this.refuse(checked.error);
    const available = new Set<string>(DEMO_SERVER.table.powers);
    if (checked.value.powers.some((rank) => !available.has(rank))) return this.refuse(error('BAD_REQUEST', 'room:setTable'));
    this.table = {
      turnSeconds: checked.value.turnSeconds,
      reactions: { ...checked.value.reactions },
      powers: DEMO_SERVER.table.powers.filter((rank) => checked.value.powers.includes(rank)),
    };
    this.setRoom(room.code, room.status, room.hostId, room.members);
    return Promise.resolve(OK);
  }

  leaveRoom(): Promise<RequestResult> {
    this.clearTimer();
    this.table = DEMO_SERVER.table;
    this.scenario = null;
    this.room = null;
    this.emit({ type: 'room', room: null });
    return Promise.resolve(OK);
  }

  send(action: Action): Promise<RequestResult> {
    // Sanity check of our own message shape (the real server validates again).
    const parsed = parseAction(action);
    if (!parsed.ok) return this.refuse({ code: 'BAD_REQUEST', request: 'game:action', message: parsed.issues.join('; ') });
    this.sent.push(parsed.action);
    if (this.options.autoAdvance === false || !this.scenario) return Promise.resolve(OK);
    const a = parsed.action;
    const key = a.type === 'claimReaction' ? `claimReaction:${a.kind}` : a.type;
    const next = DEMO_SCRIPT[this.scenario]?.onAction?.[key];
    if (next) this.loadScenario(next, this.players, this.names);
    return Promise.resolve(OK);
  }

  // --- demo controls ------------------------------------------------------------

  /** Shows a fixture scene (used by the demo panel and by startGame). */
  loadScenario(id: ScenarioId, players: number, names?: readonly string[]): GameView {
    this.clearTimer();
    this.scenario = id;
    this.players = players;
    this.names = names;
    const timing = this.options.timeScale ? { timeScale: this.options.timeScale } : {};
    const view = buildScenario(id, {
      players,
      now: this.now(), // the mock "server" clock is the local clock
      ...(names ? { names } : {}),
      ...timing,
    });
    if (this.room && view.phase === 'ended' && this.room.status !== 'ended') {
      this.setRoom(this.room.code, 'ended', this.room.hostId, this.room.members);
    }
    this.emit({ type: 'update', update: { view, turnDeadline: scenarioTurnDeadline(view, timing), events: [] } });
    this.scheduleDeadline(id, view);
    return view;
  }

  currentScenario(): ScenarioId | null {
    return this.scenario;
  }

  sentActions(): readonly Action[] {
    return this.sent;
  }

  // --- internals ----------------------------------------------------------------

  private scheduleDeadline(id: ScenarioId, view: GameView): void {
    if (this.options.autoAdvance === false) return;
    const next = DEMO_SCRIPT[id]?.onDeadline;
    const deadline = view.phaseDeadline ?? view.reactionWindow?.deadline ?? null;
    if (!next || deadline === null) return;
    this.timer = setTimeout(() => this.loadScenario(next, this.players, this.names), Math.max(0, deadline - view.now));
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private newBot(): RoomMemberView {
    this.botSeq += 1;
    return member(`bot${this.botSeq}`, `Bot ${this.botSeq}`, true);
  }

  private refuse(err: ConnectionError): Promise<RequestResult> {
    this.emit({ type: 'error', error: err });
    return Promise.resolve({ ok: false, error: err });
  }

  private setRoom(code: string, status: RoomView['status'], hostId: string, members: readonly RoomMemberView[]): void {
    this.room = {
      code,
      status,
      you: YOU,
      hostId,
      members: members.map((m) => ({ ...m, isHost: m.id === hostId })),
      settings: {
        minPlayers: DEMO_SERVER.players.min,
        maxPlayers: DEMO_SERVER.players.max,
        turnMs: this.table.turnSeconds * 1000,
      },
      table: this.table,
      availablePowers: DEMO_SERVER.table.powers,
      queue: [],
    };
    this.emit({ type: 'room', room: this.room });
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    this.emit({ type: 'status', status });
  }

  private emit(event: ConnectionEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

function member(id: string, name: string, isBot: boolean): RoomMemberView {
  return { id, name, isBot, isHost: false, connected: true };
}

function error(code: ConnectionError['code'], request: RequestName): ConnectionError {
  return { code, request, message: code.toLowerCase().replaceAll('_', ' ') };
}

function randomCode(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ROOM_CODE_ALPHABET[b % ROOM_CODE_ALPHABET.length]).join('');
}
