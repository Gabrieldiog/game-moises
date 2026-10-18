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
  /** Public: which positions were looked at (never their faces). */
  readonly peeked: readonly SlotRef[];
}

export interface ReactionWindowView {
  /** The face-up card that opened the window. */
  readonly card: Card;
  readonly openedBy: PlayerId;
  readonly deadline: number;
  readonly attemptedBy: readonly PlayerId[];
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
