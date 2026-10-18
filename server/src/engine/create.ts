import { z } from 'zod';
import { PlayerIdSchema, PlayerNameSchema, type Card, type GameEvent } from '@moises/shared';
import { DEFAULT_RULES, RulesConfigSchema, type RulesConfig } from '../config/rules.js';
import { buildDeck, cardKey, isCard } from './cards.js';
import { isValidTime } from './internal.js';
import { MAX_SEED_LENGTH, MIN_SEED_LENGTH, createRng, randomInt, shuffle } from './rng.js';
import type { GameState, PlayerState } from './types.js';

export interface NewPlayer {
  readonly id: string;
  readonly name: string;
}

export interface CreateGameOptions {
  /** In seat (turn) order. */
  readonly players: readonly NewPlayer[];
  /** Secret seed for shuffling. Production: generateSeed(). */
  readonly seed: string;
  readonly now: number;
  readonly rules?: RulesConfig;
  /** Fixed deck order instead of shuffling (index 0 is dealt first). For tests and replays only. */
  readonly deck?: readonly Card[];
  /** Fixed first player instead of a random draw. For tests and replays only. */
  readonly firstPlayerId?: string;
}

export type CreateGameErrorCode = 'INVALID_RULES' | 'INVALID_PLAYERS' | 'INVALID_SEED' | 'INVALID_TIME' | 'INVALID_DECK';

export type CreateGameResult =
  | { readonly ok: true; readonly state: GameState; readonly events: GameEvent[] }
  | { readonly ok: false; readonly error: { readonly code: CreateGameErrorCode; readonly message: string } };

const PlayersSchema = z.array(z.strictObject({ id: PlayerIdSchema, name: PlayerNameSchema }));
const SeedSchema = z.string().min(MIN_SEED_LENGTH).max(MAX_SEED_LENGTH);

function fail(code: CreateGameErrorCode, message: string): CreateGameResult {
  return { ok: false, error: { code, message } };
}

/** Shuffles, deals and starts the arrangement phase. Validates every option. */
export function createGame(options: CreateGameOptions): CreateGameResult {
  const rulesParsed = RulesConfigSchema.safeParse(options.rules ?? DEFAULT_RULES);
  if (!rulesParsed.success) return fail('INVALID_RULES', rulesParsed.error.message);
  const rules = rulesParsed.data;

  if (!isValidTime(options.now)) return fail('INVALID_TIME', 'now must be a finite, non-negative number');

  const seed = SeedSchema.safeParse(options.seed);
  if (!seed.success) {
    return fail('INVALID_SEED', `seed must be a string of ${MIN_SEED_LENGTH}-${MAX_SEED_LENGTH} characters`);
  }

  const playersParsed = PlayersSchema.safeParse(options.players);
  if (!playersParsed.success) return fail('INVALID_PLAYERS', playersParsed.error.message);
  const players = playersParsed.data;
  if (players.length < rules.players.min || players.length > rules.players.max) {
    return fail('INVALID_PLAYERS', `a game needs ${rules.players.min}-${rules.players.max} players`);
  }
  if (new Set(players.map((p) => p.id)).size !== players.length) {
    return fail('INVALID_PLAYERS', 'player ids must be unique');
  }
  if (options.firstPlayerId !== undefined && !players.some((p) => p.id === options.firstPlayerId)) {
    return fail('INVALID_PLAYERS', 'firstPlayerId is not one of the players');
  }

  let rng = createRng(seed.data);
  const canonical = buildDeck(rules);
  let deck: Card[];
  if (options.deck !== undefined) {
    const checked = checkFixedDeck(options.deck, canonical);
    if (typeof checked === 'string') return fail('INVALID_DECK', checked);
    deck = checked;
  } else {
    [deck, rng] = shuffle(canonical, rng);
  }

  // Deal one card at a time, round-robin, like at a real table.
  const grids: Card[][] = players.map(() => []);
  let next = 0;
  for (let round = 0; round < rules.grid.initialSize; round++) {
    for (const grid of grids) grid.push(deck[next++] as Card);
  }

  let firstPlayerId = options.firstPlayerId;
  if (firstPlayerId === undefined) {
    let index: number;
    [index, rng] = randomInt(rng, players.length);
    firstPlayerId = (players[index] as NewPlayer).id;
  }

  const phaseDeadline = options.now + rules.timings.arrangeMs;
  const state: GameState = {
    schemaVersion: 1,
    rules: structuredClone(rules),
    rng,
    phase: 'arrange',
    phaseDeadline,
    players: players.map((p, i): PlayerState => ({ id: p.id, name: p.name, grid: grids[i] as Card[] })),
    drawPile: deck.slice(next),
    discardPile: [],
    firstPlayerId,
    turnCount: 0,
    turn: null,
    reaction: null,
    reveals: [],
    endCall: null,
    result: null,
  };
  return { ok: true, state, events: [{ type: 'phaseChanged', phase: 'arrange', deadline: phaseDeadline }] };
}

/** The fixed deck must be exactly a permutation of the full deck. Returns a clean copy or an error message. */
function checkFixedDeck(input: readonly unknown[], canonical: readonly Card[]): Card[] | string {
  if (!Array.isArray(input) || input.length !== canonical.length) {
    return `deck must have exactly ${canonical.length} cards`;
  }
  const expected = new Set(canonical.map(cardKey));
  const seen = new Set<string>();
  const out: Card[] = [];
  for (const item of input) {
    if (!isCard(item)) return 'deck contains an invalid card';
    const key = cardKey(item);
    if (!expected.has(key) || seen.has(key)) return `deck card ${key} is unexpected or repeated`;
    seen.add(key);
    out.push(structuredClone(item));
  }
  return out;
}
