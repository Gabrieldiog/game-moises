// Power kinds. Which card grants which power is a rule and lives in the server
// configuration; the client only needs the names to build `usePower` actions.
export const POWER_KINDS = [
  /** See one of your own cards. */
  'peekOwn',
  /** See one card of an opponent. */
  'peekOpponent',
  /** Swap one of your cards with one of an opponent, without seeing either. */
  'blindSwap',
  /** See one opponent card, then optionally swap it with one of yours. */
  'peekAndSwap',
  /** See several opponent cards, then optionally swap one of them with one of yours. */
  'peekManyAndSwap',
] as const;

export type PowerKind = (typeof POWER_KINDS)[number];
