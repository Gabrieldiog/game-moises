import type {
  Action,
  Card,
  GameError,
  GameEvent,
  GameResult,
  GameView,
  PlayerId,
  ServerGameEvent,
  TurnStep,
} from '@moises/shared';
import type { RulesConfig } from '../config/rules.js';
import { Bot, type BotTuning } from '../bots/index.js';
import { applyAction, createGame, nextDeadline, tick, viewFor, type GameState } from '../engine/index.js';
import { botKnowledge } from './bot-knowledge.js';

// One running game: the pure engine plus what the engine deliberately leaves
// out, all driven by explicit time (no timers here, so it is fully testable):
// - the turn timer (rules.timings.turnMs) and the minimal auto-play on timeout;
// - the bots, which decide from their own view and act after a short delay.
// The room owns the single real timer and calls advance() at nextWakeAt().

export interface SessionPlayer {
  readonly id: PlayerId;
  readonly name: string;
  readonly isBot: boolean;
}

export interface GameSessionOptions {
  /** In seat order. */
  readonly players: readonly SessionPlayer[];
  readonly rules: RulesConfig;
  /** Secret shuffle seed (generateSeed() in production). */
  readonly seed: string;
  readonly now: number;
  /** Uniform [0, 1): bot delays and tie-breaks only (nothing secret depends on it). */
  readonly random: () => number;
  readonly botDelayMs: { readonly min: number; readonly max: number };
  readonly botTuning?: BotTuning;
  /** Fixed deck / first player, for tests only. */
  readonly deck?: readonly Card[];
  readonly firstPlayerId?: PlayerId;
}

export interface SessionStats {
  /** Times the turn timer ran out. */
  timeouts: number;
  /** Bot moves refused by the engine (a bot bug; the turn timer covers it). */
  botRejected: number;
  botActions: number;
}

/** Steps where the game waits for the current player (the reaction step waits for everyone, with its own deadline). */
const PLAYER_STEPS: ReadonlySet<TurnStep> = new Set<TurnStep>(['draw', 'decide', 'power', 'powerSwap']);

/** Keeps a bot's reaction this far ahead of the window's end. */
const REACTION_MARGIN_MS = 50;

/** Safety net against a loop that does not progress (would be a bug). */
const MAX_STEPS_PER_ADVANCE = 10_000;

interface BotSeat {
  readonly bot: Bot;
  wakeAt: number | null;
}

interface TurnClock {
  readonly key: string;
  readonly deadline: number;
}

export class GameSession {
  private state: GameState;
  private readonly bots = new Map<PlayerId, BotSeat>();
  private clock: TurnClock | null = null;
  /** Turn number that timed out: its remaining steps are played at once. */
  private autoTurn: number | null = null;
  private outbox: ServerGameEvent[] = [];
  private readonly random: () => number;
  private readonly botTuning: BotTuning | undefined;
  private readonly botDelay: { readonly min: number; readonly max: number };
  readonly stats: SessionStats = { timeouts: 0, botRejected: 0, botActions: 0 };
  /** Increases on every change, so the room knows when to send updates. */
  version = 0;

  constructor(options: GameSessionOptions) {
    const created = createGame({
      players: options.players.map((p) => ({ id: p.id, name: p.name })),
      seed: options.seed,
      now: options.now,
      rules: options.rules,
      ...(options.deck ? { deck: options.deck } : {}),
      ...(options.firstPlayerId ? { firstPlayerId: options.firstPlayerId } : {}),
    });
    if (!created.ok) throw new Error(`GameSession: ${created.error.code}: ${created.error.message}`);
    this.state = created.state;
    this.random = options.random;
    this.botTuning = options.botTuning;
    this.botDelay = options.botDelayMs;
    const knowledge = botKnowledge(created.state.rules);
    for (const player of options.players) {
      if (player.isBot) this.bots.set(player.id, { bot: new Bot(player.id, knowledge, options.random, options.botTuning), wakeAt: null });
    }
    this.commit(created.state, created.events, options.now);
  }

  get phase(): GameState['phase'] {
    return this.state.phase;
  }

  get result(): GameResult | null {
    return this.state.result;
  }

  get turnDeadline(): number | null {
    return this.clock?.deadline ?? null;
  }

  /** The authoritative state, for tests and diagnostics only. Never send it to a client. */
  get internalState(): GameState {
    return this.state;
  }

  /** The bot playing a seat (tests). */
  botFor(playerId: PlayerId): Bot | undefined {
    return this.bots.get(playerId)?.bot;
  }

  /**
   * A human left: the same seat is played by a bot from now on. The bot starts
   * with what that seat can see now (its own view), nothing more. Returns false
   * if the player is unknown, already a bot, or the game is over.
   */
  replaceWithBot(playerId: PlayerId, now: number): boolean {
    if (this.state.phase === 'ended' || this.bots.has(playerId)) return false;
    if (!this.state.players.some((p) => p.id === playerId)) return false;
    const knowledge = botKnowledge(this.state.rules);
    this.bots.set(playerId, { bot: new Bot(playerId, knowledge, this.random, this.botTuning), wakeAt: null });
    this.version += 1;
    this.notifyBots([], now);
    return true;
  }

  /** What one player may see now. */
  viewFor(playerId: PlayerId, now: number): GameView {
    return viewFor(this.state, playerId, now);
  }

  /** Public events since the last call. */
  drainEvents(): ServerGameEvent[] {
    const events = this.outbox;
    this.outbox = [];
    return events;
  }

  /** A human's move. Everything due before `now` happens first; the engine validates the move. */
  act(playerId: PlayerId, action: Action, now: number): { ok: true } | { ok: false; error: GameError } {
    this.advance(now);
    const result = applyAction(this.state, playerId, action, now);
    if (!result.ok) return { ok: false, error: result.error };
    this.commit(result.state, result.events, now);
    this.advance(now);
    return { ok: true };
  }

  /** Earliest time something happens on its own: engine deadline, turn timeout or bot move. */
  nextWakeAt(): number | null {
    if (this.state.phase === 'ended') return null;
    const candidates: number[] = [];
    const engine = nextDeadline(this.state);
    if (engine !== null) candidates.push(engine);
    if (this.clock) candidates.push(this.clock.deadline);
    for (const seat of this.bots.values()) if (seat.wakeAt !== null) candidates.push(seat.wakeAt);
    return candidates.length === 0 ? null : Math.min(...candidates);
  }

  /** Runs everything due at `now`, in order: engine deadlines, then the turn timer, then bots. */
  advance(now: number): void {
    for (let steps = 0; steps < MAX_STEPS_PER_ADVANCE; steps++) {
      if (!this.step(now)) return;
    }
    throw new Error('GameSession.advance: no progress after many steps');
  }

  private step(now: number): boolean {
    if (this.state.phase === 'ended') return false;
    const engineDeadline = nextDeadline(this.state);
    if (engineDeadline !== null && engineDeadline <= now) {
      const ticked = tick(this.state, now);
      if (ticked.state !== this.state) {
        this.commit(ticked.state, ticked.events, now);
        return true;
      }
    }
    if (this.clock && this.clock.deadline <= now) {
      this.timeout(now);
      return true;
    }
    let due: [PlayerId, BotSeat] | null = null;
    for (const entry of this.bots) {
      const wakeAt = entry[1].wakeAt;
      if (wakeAt !== null && wakeAt <= now && (!due || wakeAt < (due[1].wakeAt as number))) due = entry;
    }
    if (due) {
      this.runBot(due[0], due[1], now);
      return true;
    }
    return false;
  }

  /** The current player ran out of time: play the minimum for them (draw, discard, skip the power). */
  private timeout(now: number): void {
    const turn = this.state.turn;
    this.clock = null;
    if (!turn) return;
    if (this.autoTurn !== turn.number) {
      this.autoTurn = turn.number;
      this.stats.timeouts += 1;
      this.outbox.push({ type: 'turnTimedOut', playerId: turn.playerId, turnNumber: turn.number, step: turn.step });
      this.version += 1;
    }
    const action = minimalAction(turn.step);
    if (!action) return;
    const result = applyAction(this.state, turn.playerId, action, now);
    if (!result.ok) throw new Error(`GameSession: auto-play refused (${result.error.code})`);
    this.commit(result.state, result.events, now);
  }

  private runBot(playerId: PlayerId, seat: BotSeat, now: number): void {
    seat.wakeAt = null;
    const action = seat.bot.decide(viewFor(this.state, playerId, now));
    if (!action) return;
    const result = applyAction(this.state, playerId, action, now);
    if (!result.ok) {
      this.stats.botRejected += 1;
      return; // the turn timer will cover the bot if it is stuck
    }
    this.stats.botActions += 1;
    this.commit(result.state, result.events, now);
  }

  private commit(state: GameState, events: readonly GameEvent[], now: number): void {
    this.state = state;
    this.version += 1;
    this.outbox.push(...events);
    this.syncClock(now);
    this.notifyBots(events, now);
  }

  /** Each step that waits for the current player gets its own turnMs (immediate if the turn timed out). */
  private syncClock(now: number): void {
    const turn = this.state.turn;
    if (this.state.phase !== 'playing' || !turn || !PLAYER_STEPS.has(turn.step)) {
      this.clock = null;
      return;
    }
    const key = `${turn.number}:${turn.step}`;
    if (this.clock?.key === key) return;
    const deadline = this.autoTurn === turn.number ? now : now + this.state.rules.timings.turnMs;
    this.clock = { key, deadline };
  }

  private notifyBots(events: readonly GameEvent[], now: number): void {
    for (const [playerId, seat] of this.bots) {
      const view = viewFor(this.state, playerId, now);
      seat.bot.observe(view, events);
      if (this.state.phase === 'ended' || seat.bot.decide(view) === null) {
        seat.wakeAt = null;
      } else if (seat.wakeAt === null) {
        seat.wakeAt = now + this.botDelayFor(view, now);
      }
    }
  }

  private botDelayFor(view: GameView, now: number): number {
    const { min, max } = this.botDelay;
    const delay = Math.round(min + this.random() * (max - min));
    const window = view.reactionWindow;
    if (window && !window.attemptedBy.includes(view.you ?? '')) {
      // A reaction must land before the window closes.
      return Math.max(0, Math.min(delay, window.deadline - now - REACTION_MARGIN_MS));
    }
    return delay;
  }
}

function minimalAction(step: TurnStep): Action | null {
  switch (step) {
    case 'draw':
      return { type: 'draw' };
    case 'decide':
      return { type: 'discardDrawn' };
    case 'power':
    case 'powerSwap':
      return { type: 'skipPower' };
    case 'reaction':
      return null;
  }
}
