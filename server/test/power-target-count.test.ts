import { describe, expect, it } from 'vitest';
import type { PlayerId, PowerKind, SlotRef } from '@moises/shared';
import { DEFAULT_RULES, parseRules } from '../src/config/rules.js';
import { applyAction } from '../src/engine/index.js';
import { newGame, playing, type TestGame } from './helpers.js';

const G1 = ['2S', '3S', '4S', '5S'];
const G2 = ['2H', '3H', '4H', '5H'];
const G3 = ['2D', '3D', '4D', '5D'];
const G4 = ['2C', '3C', '4C', '5C'];

/** p1 draws `card`, discards it and the reaction window closes: power step. */
function withPower(card: string, grids: string[][] = [G1, G2, G3], rules = DEFAULT_RULES): TestGame {
  const game = playing({ grids, draws: [card], rules });
  game.act('p1', { type: 'draw' }).act('p1', { type: 'discardDrawn' }).closeWindow();
  return game;
}

/** The first `n` occupied opponent cards of `me`, in seat order. */
function opponentRefs(game: TestGame, me: PlayerId, n: number): SlotRef[] {
  const refs: SlotRef[] = [];
  for (const player of game.state.players) {
    if (player.id === me) continue;
    player.grid.forEach((slot, index) => {
      if (slot) refs.push({ playerId: player.id, slot: index });
    });
  }
  return refs.slice(0, n);
}

/**
 * Builds a `usePower` action of `power` that names `n` opponent cards (single-pick powers ignore n).
 * When the table has fewer than `n` opponent cards the list is padded with refs that point nowhere,
 * which is what a client that ignores the count would send; the count check comes before those refs are looked at.
 */
function usePowerAction(game: TestGame, power: PowerKind, n: number): unknown {
  const targets = opponentRefs(game, 'p1', n);
  for (let extra = 0; targets.length < n; extra++) targets.push({ playerId: 'p2', slot: extra % 4 });
  const [target] = targets;
  switch (power) {
    case 'peekOwn':
      return { type: 'usePower', power, slot: 0 };
    case 'peekOpponent':
    case 'peekAndSwap':
      return { type: 'usePower', power, target };
    case 'blindSwap':
      return { type: 'usePower', power, ownSlot: 0, target };
    case 'peekManyAndSwap':
      return { type: 'usePower', power, targets };
  }
}

/** Whether the engine accepts `action` from `playerId` right now (pure: the game is not touched). */
function accepted(game: TestGame, playerId: PlayerId, action: unknown): { ok: boolean; code?: string } {
  const result = applyAction(game.state, playerId, action, game.now);
  return result.ok ? { ok: true } : { ok: false, code: result.error.code };
}

describe('TurnView.powerTargetCount', () => {
  it.each(['KS', 'KC'])('black K (%s): the rule value (2), same for every viewer, and the engine accepts exactly that', (card) => {
    const game = withPower(card);
    const expected = DEFAULT_RULES.powers.peekManyCount;
    expect(expected).toBe(2);
    for (const viewer of ['p1', 'p2', 'p3', 'spectator']) {
      expect(game.view(viewer).turn).toMatchObject({
        playerId: 'p1',
        step: 'power',
        pendingPower: 'peekManyAndSwap',
        powerTargetCount: expected,
      });
    }
    const count = game.view('p1').turn?.powerTargetCount as number;
    expect(accepted(game, 'p1', usePowerAction(game, 'peekManyAndSwap', count))).toEqual({ ok: true });
    for (const wrong of [1, count + 1, count + 2]) {
      expect(accepted(game, 'p1', usePowerAction(game, 'peekManyAndSwap', wrong))).toEqual({
        ok: false,
        code: 'WRONG_TARGET_COUNT',
      });
    }
  });

  it('black K: limited to the opponent cards on the table (1 left -> 1)', () => {
    const game = playing({ grids: [G1, G2], draws: ['KS'] });
    const s = structuredClone(game.state);
    const p2 = s.players[1];
    if (!p2) throw new Error('setup');
    s.discardPile.push(...(p2.grid.slice(1) as never[]));
    p2.grid = [p2.grid[0] ?? null, null, null, null];
    game.state = s;
    game.act('p1', { type: 'draw' }).act('p1', { type: 'discardDrawn' }).closeWindow();

    const turn = game.view('p1').turn;
    expect(turn).toMatchObject({ step: 'power', pendingPower: 'peekManyAndSwap', powerTargetCount: 1 });
    expect(accepted(game, 'p1', usePowerAction(game, 'peekManyAndSwap', 1))).toEqual({ ok: true });
    expect(accepted(game, 'p1', usePowerAction(game, 'peekManyAndSwap', 2)).code).toBe('WRONG_TARGET_COUNT');
  });

  it('black K: a card count that changes between views changes the value (opponent cards are counted live)', () => {
    // Two opponents with 4 cards each (8) -> min(2, 8) = 2; with one card left in total -> 1.
    const game = withPower('KS', [G1, G2, G3]);
    expect(game.view('p1').turn?.powerTargetCount).toBe(2);
    const s = structuredClone(game.state);
    for (const player of s.players) {
      if (player.id === 'p1') continue;
      player.grid = player.grid.map((slot, index) => (player.id === 'p2' && index === 0 ? slot : null));
    }
    game.state = s;
    expect(game.view('p1').turn?.powerTargetCount).toBe(1);
    expect(accepted(game, 'p1', usePowerAction(game, 'peekManyAndSwap', 1))).toEqual({ ok: true });
  });

  it('black K with other rules (peekManyCount 3, four players) follows the rules, not a constant', () => {
    const rules = parseRules({ ...DEFAULT_RULES, powers: { peekManyCount: 3 } });
    const game = withPower('KS', [G1, G2, G3, G4], rules);
    expect(game.view('p2').turn?.powerTargetCount).toBe(3);
    expect(accepted(game, 'p1', usePowerAction(game, 'peekManyAndSwap', 3))).toEqual({ ok: true });
    expect(accepted(game, 'p1', usePowerAction(game, 'peekManyAndSwap', 2)).code).toBe('WRONG_TARGET_COUNT');
    expect(accepted(game, 'p1', usePowerAction(game, 'peekManyAndSwap', 4)).code).toBe('WRONG_TARGET_COUNT');
  });

  it.each<[string, PowerKind]>([
    ['JH', 'peekAndSwap'],
    ['JS', 'peekAndSwap'],
    ['7H', 'peekOwn'],
    ['8C', 'peekOwn'],
    ['9S', 'peekOpponent'],
    ['10D', 'peekOpponent'],
    ['QS', 'blindSwap'],
    ['QH', 'blindSwap'],
  ])('%s (%s): one pick, and the engine accepts it', (card, power) => {
    const game = withPower(card);
    for (const viewer of ['p1', 'p2', 'spectator']) {
      expect(game.view(viewer).turn).toMatchObject({ step: 'power', pendingPower: power, powerTargetCount: 1 });
    }
    expect(accepted(game, 'p1', usePowerAction(game, power, 1))).toEqual({ ok: true });
  });

  it('J: asking for more than one card is not a thing (peekAndSwap has no list of targets)', () => {
    const game = withPower('JH');
    const action = { type: 'usePower', power: 'peekAndSwap', targets: opponentRefs(game, 'p1', 2) };
    expect(accepted(game, 'p1', action).ok).toBe(false);
  });

  it('is null when there is no pending power: draw step, decide step, keep, and cards without power', () => {
    const game = playing({ grids: [G1, G2, G3], draws: ['KS', '6D'] });
    expect(game.view('p1').turn).toMatchObject({ step: 'draw', pendingPower: null, powerTargetCount: null });
    game.act('p1', { type: 'draw' });
    for (const viewer of ['p1', 'p2']) {
      expect(game.view(viewer).turn).toMatchObject({ step: 'decide', pendingPower: null, powerTargetCount: null });
    }
    // keeping a power card swaps it into the grid and never activates the power
    game.act('p1', { type: 'swapWithDrawn', slot: 0 });
    expect(game.view('p2').turn).toMatchObject({ playerId: 'p1', step: 'reaction', pendingPower: null, powerTargetCount: null });
    game.closeWindow();
    expect(game.view('p2').turn).toMatchObject({ playerId: 'p2', step: 'draw', pendingPower: null, powerTargetCount: null });
  });

  it.each(['KH', 'KD', 'AH', '6S', 'JKR', 'JKB'])('%s discarded: no power, no count', (card) => {
    const game = playing({ grids: [G1, G2, G3], draws: [card] });
    game.act('p1', { type: 'draw' }).act('p1', { type: 'discardDrawn' });
    // reaction window open
    expect(game.view('p2').turn).toMatchObject({ step: 'reaction', pendingPower: null, powerTargetCount: null });
    game.closeWindow();
    expect(game.view('p2').turn).toMatchObject({ playerId: 'p2', step: 'draw', pendingPower: null, powerTargetCount: null });
  });

  it('is null when there is no turn at all (arrange phase, ended game)', () => {
    const arranging = newGame({ grids: [G1, G2] });
    expect(arranging.state.phase).toBe('arrange');
    expect(arranging.view('p1').turn).toBeNull();

    const game = playing({ grids: [G1, G2] });
    game.act('p1', { type: 'callEnd' });
    game.drawAndDiscard('p1');
    game.drawAndDiscard('p2');
    expect(game.state.phase).toBe('ended');
    expect(game.view('p1').turn).toBeNull();
  });

  it('follows pendingPower while the reaction window is open (public information, provisional until step "power")', () => {
    const game = playing({ grids: [G1, G2, G3], draws: ['KS'] });
    game.act('p1', { type: 'draw' }).act('p1', { type: 'discardDrawn' });
    expect(game.view('p2').turn).toMatchObject({ step: 'reaction', pendingPower: 'peekManyAndSwap', powerTargetCount: 2 });
    game.closeWindow();
    expect(game.view('p2').turn).toMatchObject({ step: 'power', pendingPower: 'peekManyAndSwap', powerTargetCount: 2 });
  });

  it('black K with no opponent cards left: the power is skipped, so the view never offers a count', () => {
    const game = playing({ grids: [G1, G2], draws: ['KS'] });
    const s = structuredClone(game.state);
    const p2 = s.players[1];
    if (!p2) throw new Error('setup');
    s.discardPile.push(...(p2.grid.filter(Boolean) as never[]));
    p2.grid = [null, null, null, null];
    game.state = s;
    game.act('p1', { type: 'draw' }).act('p1', { type: 'discardDrawn' }).closeWindow();
    expect(game.view('p1').turn).toMatchObject({ playerId: 'p2', pendingPower: null, powerTargetCount: null });
  });
});
