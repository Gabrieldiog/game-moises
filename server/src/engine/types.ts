import type {
  Card,
  EndReason,
  GameError,
  GameEvent,
  GamePhase,
  GameResult,
  PlayerId,
  PowerKind,
  ReactionKind,
  SlotRef,
  TurnStep,
} from '@moises/shared';
import type { RulesConfig } from '../config/rules.js';
import type { RngState } from './rng.js';

// Full, authoritative game state. Server-only: it contains every hidden card
// and the RNG seed. Clients get GameView (see viewFor) instead.
// The state is plain JSON-compatible data; engine functions never mutate the
// state they receive and always return a new one.

/** A grid position: a face-down card, or empty (after a reaction). */
export type Slot = Card | null;

export interface PlayerState {
  readonly id: PlayerId;
  readonly name: string;
  grid: Slot[];
}

export interface TurnState {
  readonly playerId: PlayerId;
  readonly number: number;
  step: TurnStep;
  /** The card the current player is holding (step "decide"). */
  drawnCard: Card | null;
  /** Power of the drawn card that was discarded; usable once the reaction window closes. */
  pendingPower: PowerKind | null;
  /** Positions peeked with peekAndSwap / peekManyAndSwap, eligible for powerSwap. */
  peeked: SlotRef[];
}

export interface ReactionWindowState {
  /** The card that opened the window (what reactions must match). */
  readonly card: Card;
  readonly openedBy: PlayerId;
  /** Moves later when the window is claimed; goes back to `baseDeadline` (at least) when the claim is released. */
  deadline: number;
  readonly baseDeadline: number;
  /** The player who locked the window with claimReaction; only they may react until it resolves or expires. */
  claim: { readonly by: PlayerId; readonly kind: ReactionKind } | null;
  /** One entry per accepted attempt (right or wrong), in arrival order. */
  attempts: PlayerId[];
}

/** A card shown face up to some viewers until `expiresAt`. Follows the card while it stays in a grid. */
export interface Reveal {
  readonly card: Card;
  readonly viewers: 'all' | readonly PlayerId[];
  readonly expiresAt: number;
}

export interface EndCallState {
  readonly callerId: PlayerId;
  readonly reason: EndReason;
  /** Players who still have to finish their final turn. */
  pending: PlayerId[];
}

export interface GameState {
  readonly schemaVersion: 1;
  readonly rules: RulesConfig;
  rng: RngState;
  phase: GamePhase;
  /** Deadline of the arrange / initialPeek phase. */
  phaseDeadline: number | null;
  /** In seat (turn) order. */
  players: PlayerState[];
  /** Index 0 is the top of the draw pile. */
  drawPile: Card[];
  /** Last element is the top (face up) card. */
  discardPile: Card[];
  readonly firstPlayerId: PlayerId;
  turnCount: number;
  turn: TurnState | null;
  reaction: ReactionWindowState | null;
  reveals: Reveal[];
  endCall: EndCallState | null;
  result: GameResult | null;
}

export type EngineResult =
  | { readonly ok: true; readonly state: GameState; readonly events: GameEvent[] }
  | { readonly ok: false; readonly error: GameError };

export interface TickResult {
  readonly state: GameState;
  readonly events: GameEvent[];
}

/** Mutable working copy used inside one engine call. */
export interface Draft {
  readonly s: GameState;
  readonly now: number;
  readonly events: GameEvent[];
}
