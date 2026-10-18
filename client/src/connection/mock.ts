import { parseAction, type Action, type GameView } from '@moises/shared';
import {
  DEMO_NAMES,
  DEMO_SCRIPT,
  DEMO_SERVER,
  buildScenario,
  type ScenarioId,
} from '../demo/fixtures';
import type {
  ConnectionEvent,
  ConnectionListener,
  ConnectionStatus,
  CreateRoomRequest,
  GameConnection,
  JoinRoomRequest,
  RoomSeat,
  RoomView,
} from './types';

// Local stand-in for the game server: answers lobby requests with fake rooms
// and plays back fixture GameViews. It never decides a real game outcome; the
// little "script" in DEMO_SCRIPT only moves between fixtures so the demo feels
// alive. Replaced by the Socket.IO implementation when the server is ready.

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

const BOT_NAMES = ['Bot Zé', 'Bot Cida', 'Bot Tonho', 'Bot Neide', 'Bot Juca'] as const;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export class MockConnection implements GameConnection {
  readonly kind = 'mock' as const;
  private status: ConnectionStatus = 'idle';
  private readonly listeners = new Set<ConnectionListener>();
  private room: RoomView | null = null;
  private yourName = DEMO_NAMES[0] as string;
  private scenario: ScenarioId | null = null;
  private names: readonly string[] | undefined;
  private players: number;
  private timer: Timer | null = null;
  private readonly sent: Action[] = [];
  private readonly now: () => number;

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

  createRoom({ name, mode }: CreateRoomRequest): void {
    if (!this.checkName(name)) return;
    this.yourName = name.trim();
    this.setRoom({
      code: randomCode(),
      mode,
      seats: [{ id: 's0', name: this.yourName, isBot: false, isHost: true, isYou: true }],
    });
  }

  joinRoom({ code, name }: JoinRoomRequest): void {
    if (!this.checkName(name)) return;
    const clean = code.trim().toUpperCase();
    if (clean === '') {
      this.emit({ type: 'error', error: { code: 'ROOM_NOT_FOUND', message: 'empty room code' } });
      return;
    }
    this.yourName = name.trim();
    this.setRoom({
      code: clean,
      mode: 'online',
      seats: [
        { id: 's1', name: DEMO_NAMES[1], isBot: false, isHost: true, isYou: false },
        { id: 's0', name: this.yourName, isBot: false, isHost: false, isYou: true },
      ],
    });
  }

  addBot(): void {
    const room = this.room;
    if (!room || !room.canAddBot) {
      this.emit({ type: 'error', error: { code: 'ROOM_FULL', message: 'no free seat' } });
      return;
    }
    const used = new Set(room.seats.map((s) => s.name));
    const name = BOT_NAMES.find((b) => !used.has(b)) ?? `Bot ${room.seats.length}`;
    this.setRoom({
      ...room,
      seats: [...room.seats, { id: `bot${room.seats.length}`, name, isBot: true, isHost: false, isYou: false }],
    });
  }

  removeBot(botId: string): void {
    const room = this.room;
    if (!room) return;
    this.setRoom({ ...room, seats: room.seats.filter((s) => !(s.isBot && s.id === botId)) });
  }

  startGame(): void {
    const room = this.room;
    if (!room || !room.canStart) {
      this.emit({ type: 'error', error: { code: 'NOT_HOST', message: 'cannot start' } });
      return;
    }
    // You sit first in the fixtures; the others keep the room order.
    const others = room.seats.filter((s) => !s.isYou).map((s) => s.name);
    this.loadScenario('arrumacao', room.seats.length, [this.yourName, ...others]);
  }

  leaveRoom(): void {
    this.clearTimer();
    this.scenario = null;
    this.room = null;
    this.emit({ type: 'room', room: null });
  }

  send(action: Action): void {
    // Sanity check of our own message shape (the real server validates again).
    const parsed = parseAction(action);
    if (!parsed.ok) {
      this.emit({ type: 'error', error: { code: 'INVALID_ACTION', message: parsed.issues.join('; ') } });
      return;
    }
    this.sent.push(parsed.action);
    if (this.options.autoAdvance === false || !this.scenario) return;
    const next = DEMO_SCRIPT[this.scenario]?.onAction?.[parsed.action.type];
    if (next) this.loadScenario(next, this.players, this.names);
  }

  // --- demo controls ------------------------------------------------------------

  /** Shows a fixture scene (used by the demo panel and by startGame). */
  loadScenario(id: ScenarioId, players: number, names?: readonly string[]): GameView {
    this.clearTimer();
    this.scenario = id;
    this.players = players;
    this.names = names;
    const view = buildScenario(id, {
      players,
      now: this.now(), // the mock "server" clock is the local clock
      ...(names ? { names } : {}),
      ...(this.options.timeScale ? { timeScale: this.options.timeScale } : {}),
    });
    this.emit({ type: 'view', view });
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

  private checkName(name: string): boolean {
    if (name.trim() !== '') return true;
    this.emit({ type: 'error', error: { code: 'INVALID_NAME', message: 'empty name' } });
    return false;
  }

  private setRoom(room: Omit<RoomView, 'minPlayers' | 'maxPlayers' | 'canStart' | 'canAddBot'>): void {
    const you = room.seats.find((s: RoomSeat) => s.isYou);
    const isHost = you?.isHost ?? false;
    const full = room.seats.length >= DEMO_SERVER.players.max;
    this.room = {
      ...room,
      minPlayers: DEMO_SERVER.players.min,
      maxPlayers: DEMO_SERVER.players.max,
      canStart: isHost && room.seats.length >= DEMO_SERVER.players.min,
      canAddBot: isHost && !full,
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

function randomCode(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}
