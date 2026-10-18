// Error codes returned by the server when an action is refused. The client
// maps them to user-facing (Portuguese) messages.
export const ERROR_CODES = [
  /** The payload does not match the action schema. */
  'INVALID_ACTION',
  /** The server clock value passed to the engine is not a valid time. */
  'INVALID_TIME',
  /** The acting player is not in this game. */
  'UNKNOWN_PLAYER',
  /** The game is over. */
  'GAME_OVER',
  /** The action is not allowed in the current phase or turn step. */
  'INVALID_PHASE',
  /** Turn action sent by someone who is not the current player. */
  'NOT_YOUR_TURN',
  /** Slot index outside the player's grid. */
  'INVALID_SLOT',
  /** The slot exists but has no card. */
  'EMPTY_SLOT',
  /** Both slots of an arrangement are the same. */
  'SAME_SLOT',
  /** Target player is unknown or is not an opponent. */
  'INVALID_TARGET',
  /** The power in the message is not the power of the discarded card. */
  'POWER_MISMATCH',
  /** Wrong number of targets for the power. */
  'WRONG_TARGET_COUNT',
  /** The same position was named twice. */
  'DUPLICATE_TARGET',
  /** The swap target is not one of the cards just peeked. */
  'TARGET_NOT_PEEKED',
  /** A reaction arrived while no reaction window is open (or after it closed). */
  'REACTION_WINDOW_CLOSED',
  /** The player already used their reaction attempts in this window. */
  'REACTION_ALREADY_ATTEMPTED',
  /** Another player already claimed this reaction window (or you tried to claim again). */
  'REACTION_CLAIMED',
  /** This reaction kind (matchOwn / matchOpponent) is switched off in this table's settings. */
  'REACTION_DISABLED',
  /** Someone already said "Estou foda" (or the end was triggered). */
  'END_ALREADY_CALLED',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface GameError {
  readonly code: ErrorCode;
  /** Developer-facing detail (English). Not meant to be shown as-is to players. */
  readonly message: string;
}
