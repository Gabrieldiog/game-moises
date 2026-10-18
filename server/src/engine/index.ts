// Public API of the game engine. Pure and deterministic: no timers, no
// Date.now(), no Math.random(). Time comes in as `now`; randomness comes from
// the seed stored in the state.
export { applyAction } from './apply.js';
export { buildDeck, cardPower, cardValue, sameRank } from './cards.js';
export { createGame, type CreateGameErrorCode, type CreateGameOptions, type CreateGameResult, type NewPlayer } from './create.js';
export { computeResult, scoreGrid } from './internal.js';
export { generateSeed, MIN_SEED_LENGTH } from './rng.js';
export { nextDeadline, tick } from './tick.js';
export type { EngineResult, GameState, PlayerState, Reveal, TickResult, TurnState } from './types.js';
export { viewFor } from './view.js';
