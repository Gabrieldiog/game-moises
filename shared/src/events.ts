import type { SlotRef } from './actions.js';
import type { Card } from './cards.js';
import type { EndReason, GamePhase, GameResult, PlayerId, ReactionKind } from './game.js';
import type { PowerKind } from './powers.js';

// Public events: safe to broadcast to every player. They never contain a
// hidden card. The only faces they carry are cards that are face up for
// everyone at that moment (discards, the card revealed to all after a wrong
// reaction, and the final result). Private information reaches a player only
// through their own GameView.

export type GameEvent =
  | { readonly type: 'phaseChanged'; readonly phase: GamePhase; readonly deadline: number | null }
  | { readonly type: 'cardsArranged'; readonly playerId: PlayerId; readonly fromSlot: number; readonly toSlot: number }
  | { readonly type: 'turnStarted'; readonly playerId: PlayerId; readonly turnNumber: number }
  | { readonly type: 'cardDrawn'; readonly playerId: PlayerId }
  | { readonly type: 'deckReshuffled'; readonly drawPileCount: number }
  | {
      readonly type: 'drawnCardSwapped';
      readonly playerId: PlayerId;
      readonly slot: number;
      /** The card that left the grid, now face up on the discard pile. */
      readonly discarded: Card;
    }
  | { readonly type: 'drawnCardDiscarded'; readonly playerId: PlayerId; readonly card: Card }
  | { readonly type: 'reactionWindowOpened'; readonly card: Card; readonly openedBy: PlayerId; readonly deadline: number }
  | { readonly type: 'reactionWindowClosed'; readonly reason: 'timeout' | 'matched' | 'claimExpired' }
  | {
      readonly type: 'reactionSucceeded';
      readonly reaction: 'matchOwn';
      readonly playerId: PlayerId;
      readonly slot: number;
      readonly card: Card;
    }
  | {
      readonly type: 'reactionSucceeded';
      readonly reaction: 'matchOpponent';
      readonly playerId: PlayerId;
      readonly target: SlotRef;
      readonly giveSlot: number;
      readonly card: Card;
    }
  | {
      readonly type: 'reactionFailed';
      readonly reaction: 'matchOwn';
      readonly playerId: PlayerId;
      readonly slot: number;
      /** Wrong guess: nothing moves; the card the reactor tried to discard is shown to everyone for a while. */
      readonly revealed: Card;
    }
  | {
      readonly type: 'reactionFailed';
      readonly reaction: 'matchOpponent';
      readonly playerId: PlayerId;
      readonly target: SlotRef;
      readonly giveSlot: number;
      /** Wrong guess: nothing moves; the reactor's card at giveSlot is shown to everyone (never the target card). */
      readonly revealed: Card;
    }
  | { readonly type: 'powerAvailable'; readonly playerId: PlayerId; readonly power: PowerKind }
  | {
      readonly type: 'powerUsed';
      readonly by: PlayerId;
      readonly power: PowerKind;
      readonly ownSlot: number | null;
      readonly targets: readonly SlotRef[];
    }
  /** A position was looked at by `by` (never carries the face). One event per card seen. */
  | { readonly type: 'cardPeeked'; readonly by: PlayerId; readonly target: SlotRef }
  /** Two positions exchanged cards (Q blind, J/K after peeking). Never carries faces. */
  | { readonly type: 'cardsSwapped'; readonly by: PlayerId; readonly a: SlotRef; readonly b: SlotRef; readonly blind: boolean }
  | { readonly type: 'reactionClaimed'; readonly by: PlayerId; readonly kind: ReactionKind }
  /** Outcome of a reaction attempt (or of an expired claim: ok false, no slots). Positions only, no faces. */
  | {
      readonly type: 'reactionResolved';
      readonly by: PlayerId;
      readonly kind: ReactionKind;
      readonly ok: boolean;
      readonly slots: readonly SlotRef[];
    }
  | {
      readonly type: 'powerSkipped';
      readonly by: PlayerId;
      readonly power: PowerKind;
      /** player: declined by the player; unusable: no valid target existed. */
      readonly reason: 'player' | 'unusable';
    }
  | { readonly type: 'endCalled'; readonly playerId: PlayerId; readonly reason: EndReason }
  | { readonly type: 'gameEnded'; readonly result: GameResult };

export type GameEventType = GameEvent['type'];
