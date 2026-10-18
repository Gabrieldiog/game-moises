import type { SlotRef } from './actions.js';
import type { Card } from './cards.js';
import type { EndReason, GamePhase, GameResult, PlayerId, TurnStep } from './game.js';
import type { PowerKind } from './powers.js';

// What ONE player is allowed to see. Built by the server for each viewer; a
// hidden card is represented only as { state: 'hidden' } and its face is never
// included anywhere in the view.

export type SlotView =
  | { readonly state: 'empty' }
  | { readonly state: 'hidden' }
  | {
      readonly state: 'visible';
      readonly card: Card;
      /** Server time (ms) when the card turns face down again; null = stays visible (end of game). */
      readonly until: number | null;
    };

/** One seat at the table, as seen by the viewer. */
export interface PlayerView {
  readonly id: PlayerId;
  readonly name: string;
  readonly isYou: boolean;
  readonly cardCount: number;
  /** Grid positions in order. Layout is two columns: [0][1] / [2][3] / ... */
  readonly slots: readonly SlotView[];
}

export interface TurnView {
  readonly playerId: PlayerId;
  readonly number: number;
  readonly step: TurnStep;
  readonly hasDrawnCard: boolean;
  /** Only set for the player who drew it. */
  readonly drawnCard: Card | null;
  /** Public: the discarded card is face up, so its power is known to everyone. */
  readonly pendingPower: PowerKind | null;
  /**
   * How many cards the player must pick in the `usePower` of `pendingPower`:
   * the length of `targets` for peekManyAndSwap (the server rule, limited to
   * the opponent cards still on the table), 1 for the single-pick powers; null
   * when there is no pending power. Public (derived from public card counts).
   * It is only final at step 'power': during the reaction window the table can
   * still change.
   */
  readonly powerTargetCount: number | null;
  /** Public: which positions were looked at (never their faces). */
  readonly peeked: readonly SlotRef[];
}

export interface ReactionWindowView {
  /** The face-up card that opened the window. */
  readonly card: Card;
  readonly openedBy: PlayerId;
  readonly deadline: number;
  /** Players who tried at least once in this window. */
  readonly attemptedBy: readonly PlayerId[];
  /** Attempts each player gets per window (rule, default 2); a right one closes the window. */
  readonly attemptsPerPlayer: number;
  /** Attempts the viewer still has in this window; null for a spectator. */
  readonly yourAttemptsLeft: number | null;
}

export interface EndCallView {
  readonly callerId: PlayerId;
  readonly reason: EndReason;
  /** Players who still have their final turn to play. */
  readonly pending: readonly PlayerId[];
}

export interface GameView {
  /** Server clock when the view was built, to compute countdowns. */
  readonly now: number;
  readonly phase: GamePhase;
  /** End of the arrange / initialPeek phase; null otherwise. */
  readonly phaseDeadline: number | null;
  /** The viewer's id, or null for a spectator. */
  readonly you: PlayerId | null;
  /** In seat (turn) order. */
  readonly players: readonly PlayerView[];
  readonly turn: TurnView | null;
  readonly reactionWindow: ReactionWindowView | null;
  readonly discardTop: Card | null;
  readonly discardCount: number;
  readonly drawPileCount: number;
  readonly endCall: EndCallView | null;
  readonly result: GameResult | null;
}
