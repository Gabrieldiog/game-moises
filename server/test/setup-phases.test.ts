import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, type RulesConfig } from '../src/config/rules.js';
import { nextDeadline, tick } from '../src/engine/index.js';
import { T0, facesIn, key, newGame, visibleSlots } from './helpers.js';

// Example from REGRAS.md: top [2, 3], bottom [K, 4].
const EXAMPLE = ['2S', '3S', 'KS', '4S'];
const OTHER = ['5H', '6H', '7H', '8H'];

describe('arrangement phase (5 s, blind)', () => {
  it('swaps two positions of your own grid without showing anything', () => {
    const game = newGame({ grids: [EXAMPLE, OTHER] });
    game.act('p1', { type: 'arrange', fromSlot: 2, toSlot: 0 }); // K <-> 2
    expect(game.grid('p1').map((card) => card && key(card))).toEqual(['K:spades', '3:spades', '2:spades', '4:spades']);
    expect(game.grid('p2').map((card) => card && key(card))).toEqual(['5:hearts', '6:hearts', '7:hearts', '8:hearts']);
    expect(game.lastEvents).toEqual([{ type: 'cardsArranged', playerId: 'p1', fromSlot: 2, toSlot: 0 }]);
    for (const viewer of ['p1', 'p2']) {
      expect(facesIn(game.view(viewer))).toEqual([]);
    }
  });

  it('lets every player arrange at the same time, many times', () => {
    const game = newGame({ grids: [EXAMPLE, OTHER] });
    game.act('p2', { type: 'arrange', fromSlot: 0, toSlot: 1 });
    game.act('p1', { type: 'arrange', fromSlot: 0, toSlot: 3 });
    game.act('p1', { type: 'arrange', fromSlot: 0, toSlot: 3 });
    expect(game.grid('p1').map((card) => card && key(card))).toEqual(['2:spades', '3:spades', 'K:spades', '4:spades']);
    expect(game.grid('p2').map((card) => card && key(card))).toEqual(['6:hearts', '5:hearts', '7:hearts', '8:hearts']);
  });

  it('validates the slots', () => {
    const game = newGame({ grids: [EXAMPLE, OTHER] });
    expect(game.fail('p1', { type: 'arrange', fromSlot: 0, toSlot: 4 })).toBe('INVALID_SLOT');
    expect(game.fail('p1', { type: 'arrange', fromSlot: 1, toSlot: 1 })).toBe('SAME_SLOT');
    expect(game.fail('p1', { type: 'arrange', fromSlot: -1, toSlot: 1 })).toBe('INVALID_ACTION');
  });

  it('refuses arrangement once the 5 s are over', () => {
    const game = newGame({ grids: [EXAMPLE, OTHER] });
    expect(game.fail('p1', { type: 'arrange', fromSlot: 0, toSlot: 1 }, T0 + 5000)).toBe('INVALID_PHASE');
    game.act('p1', { type: 'arrange', fromSlot: 0, toSlot: 1 }); // still at T0
    game.advanceTo(T0 + 4999);
    game.act('p1', { type: 'arrange', fromSlot: 0, toSlot: 1 });
  });

  it('refuses turn actions and reactions during arrangement', () => {
    const game = newGame({ grids: [EXAMPLE, OTHER] });
    expect(game.fail('p1', { type: 'draw' })).toBe('INVALID_PHASE');
    expect(game.fail('p1', { type: 'callEnd' })).toBe('INVALID_PHASE');
    expect(game.fail('p2', { type: 'matchOwn', slot: 0 })).toBe('INVALID_PHASE');
  });
});

describe('phase timing (tick)', () => {
  it('moves arrange -> initialPeek -> playing at the deadlines', () => {
    const game = newGame({ grids: [EXAMPLE, OTHER] });
    expect(nextDeadline(game.state)).toBe(T0 + 5000);

    const before = game.state;
    expect(tick(before, T0 + 4999).state).toBe(before); // nothing due: same object

    game.advanceTo(T0 + 5000);
    expect(game.state.phase).toBe('initialPeek');
    expect(game.state.phaseDeadline).toBe(T0 + 10_000);
    expect(game.lastEvents).toEqual([{ type: 'phaseChanged', phase: 'initialPeek', deadline: T0 + 10_000 }]);

    game.advanceTo(T0 + 10_000);
    expect(game.state.phase).toBe('playing');
    expect(game.state.turn).toMatchObject({ playerId: 'p1', step: 'draw', number: 1 });
    expect(game.lastEvents).toEqual([
      { type: 'phaseChanged', phase: 'playing', deadline: null },
      { type: 'turnStarted', playerId: 'p1', turnNumber: 1 },
    ]);
    expect(nextDeadline(game.state)).toBeNull();
  });

  it('still gives the full peek when the server ticks late', () => {
    const game = newGame({ grids: [EXAMPLE, OTHER] });
    game.advanceTo(T0 + 60_000);
    expect(game.state.phase).toBe('initialPeek');
    expect(game.state.phaseDeadline).toBe(T0 + 65_000);
  });

  it('uses the timings from the config', () => {
    const rules = structuredClone(DEFAULT_RULES) as RulesConfig;
    rules.timings.arrangeMs = 1000;
    rules.timings.initialPeekMs = 2000;
    const game = newGame({ grids: [EXAMPLE, OTHER], rules });
    expect(game.state.phaseDeadline).toBe(T0 + 1000);
    game.advanceTo(T0 + 1000);
    expect(game.state.phaseDeadline).toBe(T0 + 3000);
  });
});

describe('initial peek (5 s, bottom row only, owner only)', () => {
  it('shows each player only their own slots 2 and 3, after arrangement', () => {
    const game = newGame({ grids: [EXAMPLE, OTHER] });
    game.act('p1', { type: 'arrange', fromSlot: 2, toSlot: 0 }); // top [K, 3], bottom [2, 4]
    game.advanceTo(T0 + 5000);

    const p1 = game.view('p1');
    expect(visibleSlots(p1)).toEqual({ p1: { 2: '2:spades', 3: '4:spades' }, p2: {} });
    expect(p1.players[0]?.slots[2]).toEqual({ state: 'visible', card: { kind: 'standard', rank: '2', suit: 'spades' }, until: T0 + 10_000 });
    expect(p1.players[0]?.slots[0]).toEqual({ state: 'hidden' });
    expect(facesIn(p1).sort()).toEqual(['2:spades', '4:spades']);

    const p2 = game.view('p2');
    expect(visibleSlots(p2)).toEqual({ p1: {}, p2: { 2: '7:hearts', 3: '8:hearts' } });
    expect(facesIn(p2).sort()).toEqual(['7:hearts', '8:hearts']);

    expect(facesIn(game.view('spectator'))).toEqual([]);
  });

  it('cannot arrange during the peek', () => {
    const game = newGame({ grids: [EXAMPLE, OTHER] }).advanceTo(T0 + 5000);
    expect(game.fail('p1', { type: 'arrange', fromSlot: 0, toSlot: 2 })).toBe('INVALID_PHASE');
  });

  it('hides everything again when the peek ends, even before the server ticks', () => {
    const game = newGame({ grids: [EXAMPLE, OTHER] }).advanceTo(T0 + 5000);
    const peekState = game.state;
    // viewFor applies the deadline itself.
    game.now = T0 + 10_000;
    expect(game.state).toBe(peekState);
    expect(facesIn(game.view('p1'))).toEqual([]);
    game.advanceTo(T0 + 10_000);
    expect(facesIn(game.view('p1'))).toEqual([]);
    expect(facesIn(game.view('p2'))).toEqual([]);
  });

  it('peek positions come from the config', () => {
    const rules = structuredClone(DEFAULT_RULES) as RulesConfig;
    rules.grid.initialPeekSlots = [0];
    const game = newGame({ grids: [EXAMPLE, OTHER], rules }).advanceTo(T0 + 5000);
    expect(visibleSlots(game.view('p1'))).toEqual({ p1: { 0: '2:spades' }, p2: {} });
  });
});
