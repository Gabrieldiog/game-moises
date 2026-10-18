import { describe, expect, it } from 'vitest';
import { nextDeadline } from '../src/engine/index.js';
import { c, facesIn, key, playing, visibleSlots, type TestGame } from './helpers.js';

const G1 = ['2S', '3S', '4S', '5S'];
const G2 = ['2H', '3H', '4H', '5H'];
const G3 = ['2D', '3D', '4D', '5D'];

/** p1 draws `card`, discards it and the reaction window closes: power step. */
function withPower(card: string, grids: string[][] = [G1, G2, G3]): TestGame {
  const game = playing({ grids, draws: [card] });
  game.act('p1', { type: 'draw' }).act('p1', { type: 'discardDrawn' }).closeWindow();
  return game;
}

function onlyP1Sees(game: TestGame, expected: Record<string, Record<number, string>>) {
  expect(visibleSlots(game.view('p1'))).toEqual(expected);
  for (const viewer of ['p2', 'p3', 'spectator']) {
    const shown = visibleSlots(game.view(viewer));
    for (const slots of Object.values(shown)) expect(slots).toEqual({});
  }
}

describe('power availability', () => {
  it.each(['7H', '8C', '9S', '10D', 'JH', 'QS', 'KS', 'KC'])('%s gives a power step after the window', (card) => {
    const game = withPower(card);
    expect(game.state.turn?.step).toBe('power');
    expect(game.lastEvents.at(-1)).toMatchObject({ type: 'powerAvailable', playerId: 'p1' });
    expect(game.view('p2').turn?.pendingPower).toBe(game.state.turn?.pendingPower);
  });

  it.each(['AH', '2C', '3C', '4C', '5C', '6S', 'KH', 'KD', 'JKR', 'JKB'])('%s has no power: next turn', (card) => {
    const game = withPower(card);
    expect(game.current).toBe('p2');
    expect(game.fail('p1', { type: 'usePower', power: 'peekOwn', slot: 0 })).toBe('NOT_YOUR_TURN');
  });

  it('the power must be the one of the discarded card', () => {
    const game = withPower('9S');
    expect(game.fail('p1', { type: 'usePower', power: 'peekOwn', slot: 0 })).toBe('POWER_MISMATCH');
    expect(game.fail('p1', { type: 'usePower', power: 'blindSwap', ownSlot: 0, target: { playerId: 'p2', slot: 0 } })).toBe('POWER_MISMATCH');
  });

  it('only the current player can use it', () => {
    const game = withPower('7H');
    expect(game.fail('p2', { type: 'usePower', power: 'peekOwn', slot: 0 })).toBe('NOT_YOUR_TURN');
  });

  it('is optional: skipPower ends the turn', () => {
    const game = withPower('QS');
    game.act('p1', { type: 'skipPower' });
    expect(game.lastEvents[0]).toEqual({ type: 'powerSkipped', by: 'p1', power: 'blindSwap', reason: 'player' });
    expect(game.current).toBe('p2');
    expect(game.grid('p1').map((card) => card && key(card))).toEqual(G1.map((code) => key(c(code))));
  });

  it('skipPower outside a power step is refused', () => {
    const game = playing({ grids: [G1, G2] });
    expect(game.fail('p1', { type: 'skipPower' })).toBe('INVALID_PHASE');
    expect(game.fail('p1', { type: 'powerSwap', ownSlot: 0, target: { playerId: 'p2', slot: 0 } })).toBe('INVALID_PHASE');
  });

  it('is skipped automatically when it has no possible target', () => {
    const game = playing({ grids: [G1, G2], draws: ['9C'] });
    const s = structuredClone(game.state);
    const p2 = s.players[1];
    if (!p2) throw new Error('setup');
    s.discardPile.push(...(p2.grid.filter(Boolean) as never[]));
    p2.grid = [null, null, null, null];
    game.state = s;
    game.act('p1', { type: 'draw' }).act('p1', { type: 'discardDrawn' }).closeWindow();
    expect(game.lastEvents).toContainEqual({ type: 'powerSkipped', by: 'p1', power: 'peekOpponent', reason: 'unusable' });
    expect(game.current).toBe('p2');
  });
});

describe('7 / 8: see one of your cards', () => {
  it.each(['7H', '8S'])('%s shows the chosen card to its owner only, for revealMs', (card) => {
    const game = withPower(card);
    game.act('p1', { type: 'usePower', power: 'peekOwn', slot: 1 });
    expect(game.lastEvents[0]).toEqual({ type: 'powerUsed', by: 'p1', power: 'peekOwn', ownSlot: 1, targets: [] });
    expect(facesIn(game.lastEvents[0])).toEqual([]);
    expect(game.current).toBe('p2');
    onlyP1Sees(game, { p1: { 1: '3:spades' }, p2: {}, p3: {} });
    expect(game.view('p1').players[0]?.slots[1]).toMatchObject({ until: game.now + 3000 });
    expect(nextDeadline(game.state)).toBe(game.now + 3000);

    game.advance(2999);
    expect(visibleSlots(game.view('p1')).p1).toEqual({ 1: '3:spades' });
    game.advance(1);
    expect(visibleSlots(game.view('p1')).p1).toEqual({});
    expect(game.state.reveals).toEqual([]);
  });

  it('validates the slot', () => {
    const game = withPower('7H');
    expect(game.fail('p1', { type: 'usePower', power: 'peekOwn', slot: 4 })).toBe('INVALID_SLOT');
  });
});

describe('9 / 10: see an opponent card', () => {
  it.each(['9S', '10H'])('%s shows the opponent card to the user only', (card) => {
    const game = withPower(card);
    game.act('p1', { type: 'usePower', power: 'peekOpponent', target: { playerId: 'p3', slot: 2 } });
    onlyP1Sees(game, { p1: {}, p2: {}, p3: { 2: '4:diamonds' } });
    expect(game.current).toBe('p2');
  });

  it('refuses yourself, unknown players and bad slots', () => {
    const game = withPower('9S');
    const use = (playerId: string, slot: number) => ({ type: 'usePower', power: 'peekOpponent', target: { playerId, slot } });
    expect(game.fail('p1', use('p1', 0))).toBe('INVALID_TARGET');
    expect(game.fail('p1', use('ghost', 0))).toBe('INVALID_TARGET');
    expect(game.fail('p1', use('p2', 7))).toBe('INVALID_SLOT');
  });
});

describe('Q: blind swap', () => {
  it('swaps one of yours with an opponent card, nobody sees anything', () => {
    const game = withPower('QS');
    game.act('p1', { type: 'usePower', power: 'blindSwap', ownSlot: 0, target: { playerId: 'p2', slot: 3 } });
    expect(game.grid('p1')[0]).toEqual(c('5H'));
    expect(game.grid('p2')[3]).toEqual(c('2S'));
    expect(game.state.reveals).toEqual([]);
    for (const viewer of ['p1', 'p2', 'p3']) {
      for (const slots of Object.values(visibleSlots(game.view(viewer)))) expect(slots).toEqual({});
    }
    expect(game.current).toBe('p2');
  });

  it('validates both positions', () => {
    const game = withPower('QH');
    const use = (ownSlot: number, playerId: string, slot: number) => ({
      type: 'usePower',
      power: 'blindSwap',
      ownSlot,
      target: { playerId, slot },
    });
    expect(game.fail('p1', use(5, 'p2', 0))).toBe('INVALID_SLOT');
    expect(game.fail('p1', use(0, 'p1', 1))).toBe('INVALID_TARGET');
    expect(game.fail('p1', use(0, 'p2', 9))).toBe('INVALID_SLOT');
  });
});

describe('J: see an opponent card, then maybe swap', () => {
  it('shows the card, then swaps it with one of yours (the given card stays unseen)', () => {
    const game = withPower('JH');
    game.act('p1', { type: 'usePower', power: 'peekAndSwap', target: { playerId: 'p2', slot: 0 } });
    expect(game.state.turn?.step).toBe('powerSwap');
    expect(game.view('p3').turn?.peeked).toEqual([{ playerId: 'p2', slot: 0 }]);
    onlyP1Sees(game, { p1: {}, p2: { 0: '2:hearts' }, p3: {} });

    game.act('p1', { type: 'powerSwap', ownSlot: 3, target: { playerId: 'p2', slot: 0 } });
    expect(game.grid('p1')[3]).toEqual(c('2H'));
    expect(game.grid('p2')[0]).toEqual(c('5S'));
    // p1 keeps seeing the card he looked at, now in his own grid; nobody sees the 5S he gave.
    onlyP1Sees(game, { p1: { 3: '2:hearts' }, p2: {}, p3: {} });
    expect(game.current).toBe('p2');
  });

  it('the swap is optional', () => {
    const game = withPower('JH');
    game.act('p1', { type: 'usePower', power: 'peekAndSwap', target: { playerId: 'p2', slot: 0 } });
    game.act('p1', { type: 'skipPower' });
    expect(game.grid('p2')[0]).toEqual(c('2H'));
    expect(game.current).toBe('p2');
  });

  it('can only swap the card that was looked at', () => {
    const game = withPower('JH');
    game.act('p1', { type: 'usePower', power: 'peekAndSwap', target: { playerId: 'p2', slot: 0 } });
    expect(game.fail('p1', { type: 'powerSwap', ownSlot: 0, target: { playerId: 'p2', slot: 1 } })).toBe('TARGET_NOT_PEEKED');
    expect(game.fail('p1', { type: 'powerSwap', ownSlot: 0, target: { playerId: 'p3', slot: 0 } })).toBe('TARGET_NOT_PEEKED');
    expect(game.fail('p1', { type: 'powerSwap', ownSlot: 8, target: { playerId: 'p2', slot: 0 } })).toBe('INVALID_SLOT');
    expect(game.fail('p2', { type: 'powerSwap', ownSlot: 0, target: { playerId: 'p2', slot: 0 } })).toBe('NOT_YOUR_TURN');
  });

  it('can still decide after the card turned face down again', () => {
    const game = withPower('JH');
    game.act('p1', { type: 'usePower', power: 'peekAndSwap', target: { playerId: 'p2', slot: 0 } });
    game.advance(10_000);
    expect(visibleSlots(game.view('p1')).p2).toEqual({});
    game.act('p1', { type: 'powerSwap', ownSlot: 0, target: { playerId: 'p2', slot: 0 } });
    expect(game.grid('p1')[0]).toEqual(c('2H'));
  });
});

describe('black K: see two opponent cards, then maybe swap one', () => {
  it('shows two cards (different opponents allowed) and swaps one of them', () => {
    const game = withPower('KS');
    game.act('p1', {
      type: 'usePower',
      power: 'peekManyAndSwap',
      targets: [
        { playerId: 'p2', slot: 1 },
        { playerId: 'p3', slot: 3 },
      ],
    });
    onlyP1Sees(game, { p1: {}, p2: { 1: '3:hearts' }, p3: { 3: '5:diamonds' } });
    game.act('p1', { type: 'powerSwap', ownSlot: 2, target: { playerId: 'p3', slot: 3 } });
    expect(game.grid('p1')[2]).toEqual(c('5D'));
    expect(game.grid('p3')[3]).toEqual(c('4S'));
    expect(game.grid('p2')[1]).toEqual(c('3H'));
    onlyP1Sees(game, { p1: { 2: '5:diamonds' }, p2: { 1: '3:hearts' }, p3: {} });
  });

  it('two cards of the same opponent are fine', () => {
    const game = withPower('KC', [G1, G2]);
    game.act('p1', {
      type: 'usePower',
      power: 'peekManyAndSwap',
      targets: [
        { playerId: 'p2', slot: 0 },
        { playerId: 'p2', slot: 3 },
      ],
    });
    expect(visibleSlots(game.view('p1')).p2).toEqual({ 0: '2:hearts', 3: '5:hearts' });
  });

  it('needs exactly two different cards', () => {
    const game = withPower('KS');
    const use = (targets: { playerId: string; slot: number }[]) => ({ type: 'usePower', power: 'peekManyAndSwap', targets });
    expect(game.fail('p1', use([{ playerId: 'p2', slot: 0 }]))).toBe('WRONG_TARGET_COUNT');
    expect(
      game.fail('p1', use([{ playerId: 'p2', slot: 0 }, { playerId: 'p2', slot: 1 }, { playerId: 'p3', slot: 1 }])),
    ).toBe('WRONG_TARGET_COUNT');
    expect(game.fail('p1', use([{ playerId: 'p2', slot: 0 }, { playerId: 'p2', slot: 0 }]))).toBe('DUPLICATE_TARGET');
    expect(game.fail('p1', use([{ playerId: 'p2', slot: 0 }, { playerId: 'p1', slot: 0 }]))).toBe('INVALID_TARGET');
  });

  it('needs only one card when opponents have just one', () => {
    const game = playing({ grids: [G1, G2], draws: ['KS'] });
    const s = structuredClone(game.state);
    const p2 = s.players[1];
    if (!p2) throw new Error('setup');
    s.discardPile.push(...(p2.grid.slice(1) as never[]));
    p2.grid = [p2.grid[0] ?? null, null, null, null];
    game.state = s;
    game.act('p1', { type: 'draw' }).act('p1', { type: 'discardDrawn' }).closeWindow();
    expect(game.fail('p1', { type: 'usePower', power: 'peekManyAndSwap', targets: [{ playerId: 'p2', slot: 0 }, { playerId: 'p2', slot: 1 }] })).toBe('WRONG_TARGET_COUNT');
    expect(game.fail('p1', { type: 'usePower', power: 'peekManyAndSwap', targets: [{ playerId: 'p2', slot: 1 }] })).toBe('EMPTY_SLOT');
    game.act('p1', { type: 'usePower', power: 'peekManyAndSwap', targets: [{ playerId: 'p2', slot: 0 }] });
    expect(game.state.turn?.step).toBe('powerSwap');
  });

  it('can only swap one of the peeked cards', () => {
    const game = withPower('KS');
    game.act('p1', {
      type: 'usePower',
      power: 'peekManyAndSwap',
      targets: [
        { playerId: 'p2', slot: 1 },
        { playerId: 'p3', slot: 3 },
      ],
    });
    expect(game.fail('p1', { type: 'powerSwap', ownSlot: 0, target: { playerId: 'p2', slot: 2 } })).toBe('TARGET_NOT_PEEKED');
  });
});
