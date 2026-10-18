// Small vocabulary shared by views, events and the engine.

export type PlayerId = string;

/** arrange -> initialPeek -> playing -> ended */
export const GAME_PHASES = ['arrange', 'initialPeek', 'playing', 'ended'] as const;
export type GamePhase = (typeof GAME_PHASES)[number];

/**
 * Steps inside the current player's turn:
 * - draw: must draw.
 * - decide: holds the drawn card; swap it into the grid or discard it.
 * - reaction: a card was discarded; the reaction window is open for everyone.
 * - power: the discarded drawn card has a power; use it or skip it.
 * - powerSwap: after peeking (J / black K), optionally swap one peeked card.
 * At any step of their own turn the current player may also call the end ("Estou foda").
 */
export const TURN_STEPS = ['draw', 'decide', 'reaction', 'power', 'powerSwap'] as const;
export type TurnStep = (typeof TURN_STEPS)[number];

export const REACTION_KINDS = ['matchOwn', 'matchOpponent'] as const;
export type ReactionKind = (typeof REACTION_KINDS)[number];

/** called: the current player said "Estou foda"; noCards: a player ran out of cards. */
export type EndReason = 'called' | 'noCards';

/** endCalled: the final round finished; deckExhausted: no card left to draw anywhere. */
export type GameOverReason = 'endCalled' | 'deckExhausted';

export interface PlayerScore {
  readonly playerId: PlayerId;
  readonly total: number;
}

export interface GameResult {
  readonly reason: GameOverReason;
  /** In seat order. */
  readonly scores: readonly PlayerScore[];
  /** Everyone tied with the lowest total wins. */
  readonly winners: readonly PlayerId[];
}
