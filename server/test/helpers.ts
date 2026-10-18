import { expect } from 'vitest';
import type { Card, ErrorCode, GameEvent, GameView, PlayerId, Rank, Suit } from '@moises/shared';
import { DEFAULT_RULES, type RulesConfig } from '../src/config/rules.js';
import {
  applyAction,
  buildDeck,
  createGame,
  tick,
  viewFor,
  type GameState,
} from '../src/engine/index.js';

export const T0 = 1_000_000;
export const SEED = 'test-seed-0123456789';

const SUIT_BY_LETTER: Record<string, Suit> = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' };

/** Card shorthand: '7H', '10S', 'KD', 'AC', and 'JKR' / 'JKB' for the red / black joker. */
export function c(code: string): Card {
  if (code === 'JKR') return { kind: 'joker', color: 'red' };
  if (code === 'JKB') return { kind: 'joker', color: 'black' };
  const suit = SUIT_BY_LETTER[code.slice(-1)];
  const rank = code.slice(0, -1) as Rank;
  if (!suit || !['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'].includes(rank)) {
    throw new Error(`bad card code ${code}`);
  }
  return { kind: 'standard', rank, suit };
}

export function key(card: Card): string {
  return card.kind === 'joker' ? `joker:${card.color}` : `${card.rank}:${card.suit}`;
}

/**
 * A full 54-card deck ordered so that round-robin dealing gives each player
 * `grids[p]`, followed by `draws` (in draw order), then every other card.
 */
export function stackDeck(grids: readonly Card[][], draws: readonly Card[] = [], rules: RulesConfig = DEFAULT_RULES): Card[] {
  const size = rules.grid.initialSize;
  const ordered: Card[] = [];
  for (let round = 0; round < size; round++) {
    for (const grid of grids) {
      const card = grid[round];
      if (!card) throw new Error('stackDeck: every grid needs exactly initialSize cards');
      ordered.push(card);
    }
  }
  ordered.push(...draws);
  const used = new Set(ordered.map(key));
  if (used.size !== ordered.length) throw new Error('stackDeck: repeated card');
  return [...ordered, ...buildDeck(rules).filter((card) => !used.has(key(card)))];
}

export interface SetupOptions {
  /** One grid (4 card codes) per player, in seat order. */
  grids: string[][];
  /** Next cards of the draw pile, in order. */
  draws?: string[];
  /** First player (default: the first seat). */
  first?: PlayerId;
  rules?: RulesConfig;
}

export const IDS = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'] as const;

/** A fresh game, created at T0 and stopped at the arrangement phase. */
export function newGame(options: SetupOptions): TestGame {
  const rules = options.rules ?? DEFAULT_RULES;
  const ids = IDS.slice(0, options.grids.length);
  const created = createGame({
    players: ids.map((id) => ({ id, name: id.toUpperCase() })),
    seed: SEED,
    now: T0,
    rules,
    deck: stackDeck(options.grids.map((grid) => grid.map(c)), (options.draws ?? []).map(c), rules),
    firstPlayerId: options.first ?? (ids[0] as string),
  });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.message}`);
  return new TestGame(created.state, T0);
}

/** A game already past arrangement and initial peek: first player's turn, step "draw". */
export function playing(options: SetupOptions): TestGame {
  const game = newGame(options);
  game.advanceTo(game.state.phaseDeadline as number); // -> initialPeek
  game.advanceTo(game.state.phaseDeadline as number); // -> playing
  expect(game.state.phase).toBe('playing');
  return game;
}

/** Small driver around the pure engine, for readable scenario tests. */
export class TestGame {
  lastEvents: GameEvent[] = [];

  constructor(
    public state: GameState,
    public now: number,
  ) {}

  get rules(): RulesConfig {
    return this.state.rules;
  }

  /** Applies an action that must succeed. */
  act(playerId: PlayerId, action: unknown): this {
    const result = applyAction(this.state, playerId, action, this.now);
    if (!result.ok) {
      throw new Error(`expected ${JSON.stringify(action)} by ${playerId} to succeed, got ${result.error.code}: ${result.error.message}`);
    }
    this.state = result.state;
    this.lastEvents = result.events;
    return this;
  }

  /** Applies an action that must fail; checks the state is untouched and returns the error code. */
  fail(playerId: unknown, action: unknown, now: unknown = this.now): ErrorCode {
    const before = structuredClone(this.state);
    const result = applyAction(this.state, playerId, action, now);
    expect(result.ok, `expected ${JSON.stringify(action)} to fail`).toBe(false);
    expect(this.state).toEqual(before);
    if (result.ok) throw new Error('unreachable');
    expect('state' in result).toBe(false);
    return result.error.code;
  }

  advance(ms: number): this {
    return this.advanceTo(this.now + ms);
  }

  advanceTo(now: number): this {
    this.now = now;
    const result = tick(this.state, now);
    this.state = result.state;
    this.lastEvents = result.events;
    return this;
  }

  /** Lets the open reaction window run out. */
  closeWindow(): this {
    const reaction = this.state.reaction;
    if (!reaction) throw new Error('no reaction window open');
    return this.advanceTo(reaction.deadline);
  }

  view(playerId: PlayerId): GameView {
    return viewFor(this.state, playerId, this.now);
  }

  grid(playerId: PlayerId): (Card | null)[] {
    const player = this.state.players.find((p) => p.id === playerId);
    if (!player) throw new Error(`no player ${playerId}`);
    return player.grid;
  }

  get current(): PlayerId | undefined {
    return this.state.turn?.playerId;
  }

  /** Draw, discard and let the window (and any power) pass. */
  drawAndDiscard(playerId: PlayerId): this {
    this.act(playerId, { type: 'draw' }).act(playerId, { type: 'discardDrawn' }).closeWindow();
    if (this.state.turn?.step === 'power') this.act(playerId, { type: 'skipPower' });
    return this;
  }
}

/** Every card face found anywhere inside a JSON-like value. */
export function facesIn(value: unknown): string[] {
  const found: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node === null || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    if (record['kind'] === 'joker' && typeof record['color'] === 'string') {
      found.push(`joker:${record['color']}`);
    } else if (record['kind'] === 'standard' && typeof record['rank'] === 'string') {
      found.push(`${record['rank']}:${String(record['suit'])}`);
    }
    Object.values(record).forEach(walk);
  };
  walk(JSON.parse(JSON.stringify(value)));
  return found;
}

/** Faces of the grid slots shown as visible in a view, by player id. */
export function visibleSlots(view: GameView): Record<PlayerId, Record<number, string>> {
  const out: Record<PlayerId, Record<number, string>> = {};
  for (const player of view.players) {
    const shown: Record<number, string> = {};
    player.slots.forEach((slot, index) => {
      if (slot.state === 'visible') shown[index] = key(slot.card);
    });
    out[player.id] = shown;
  }
  return out;
}

export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/** Every card in the state, wherever it is. */
export function allCardsInState(state: GameState): string[] {
  const cards: Card[] = [...state.drawPile, ...state.discardPile];
  for (const player of state.players) for (const slot of player.grid) if (slot) cards.push(slot);
  if (state.turn?.drawnCard) cards.push(state.turn.drawnCard);
  return cards.map(key);
}
