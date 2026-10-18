import { describe, expect, it } from 'vitest';
import { c, facesIn, key, playing, visibleSlots, type TestGame } from './helpers.js';

const G1 = ['2S', '3S', '4S', '5S'];
const G2 = ['6H', '7H', '8H', '9H'];
const G3 = ['AD', '6D', 'KH', 'JKR'];

/** p1 draws and discards `card`: the reaction window is open. */
function windowOpenWith(card = '6C', grids: string[][] = [G1, G2, G3]): TestGame {
  const game = playing({ grids, draws: [card] });
  game.act('p1', { type: 'draw' }).act('p1', { type: 'discardDrawn' });
  expect(game.state.reaction?.card).toEqual(c(card));
  return game;
}

const codes = (game: TestGame, id: string) => game.grid(id).map((card) => card && key(card));

describe('matchOwn ("filha da putinha")', () => {
  it('right: your card goes to the discard, you have one card less, the window closes', () => {
    const game = windowOpenWith('6C');
    game.act('p2', { type: 'matchOwn', slot: 0 });
    expect(codes(game, 'p2')).toEqual([null, '7:hearts', '8:hearts', '9:hearts']);
    expect(game.state.discardPile.slice(-2)).toEqual([c('6C'), c('6H')]);
    expect(game.lastEvents).toEqual([
      { type: 'reactionSucceeded', reaction: 'matchOwn', playerId: 'p2', slot: 0, card: c('6H') },
      { type: 'reactionWindowClosed', reason: 'matched' },
      { type: 'turnStarted', playerId: 'p2', turnNumber: 2 },
    ]);
    expect(game.view('p3').players[1]).toMatchObject({ cardCount: 3, slots: [{ state: 'empty' }, { state: 'hidden' }, { state: 'hidden' }, { state: 'hidden' }] });
  });

  it('any suit counts', () => {
    const game = windowOpenWith('6C');
    game.act('p3', { type: 'matchOwn', slot: 1 }); // 6D
    expect(game.grid('p3')[1]).toBeNull();
  });

  it('red and black kings match; jokers match each other', () => {
    const kings = windowOpenWith('KS');
    kings.act('p3', { type: 'matchOwn', slot: 2 }); // KH
    expect(kings.grid('p3')[2]).toBeNull();

    const jokers = windowOpenWith('JKB');
    jokers.act('p3', { type: 'matchOwn', slot: 3 }); // JKR
    expect(jokers.grid('p3')[3]).toBeNull();
  });

  it('wrong: nothing moves, no penalty, and the card is shown to everyone for revealMs', () => {
    const game = windowOpenWith('6C');
    const pile = game.state.drawPile.length;
    game.act('p2', { type: 'matchOwn', slot: 1 }); // 7H is not a 6
    expect(codes(game, 'p2')).toEqual(['6:hearts', '7:hearts', '8:hearts', '9:hearts']);
    expect(game.grid('p2')).toHaveLength(4);
    expect(game.state.drawPile).toHaveLength(pile);
    expect(game.state.discardPile.at(-1)).toEqual(c('6C'));
    expect(game.lastEvents).toEqual([
      { type: 'reactionFailed', reaction: 'matchOwn', playerId: 'p2', slot: 1, revealed: c('7H') },
    ]);
    for (const viewer of ['p1', 'p2', 'p3', 'spectator']) {
      expect(visibleSlots(game.view(viewer))).toEqual({ p1: {}, p2: { 1: '7:hearts' }, p3: {} });
    }
    expect(game.state.reaction).not.toBeNull(); // a wrong reaction does not close the window
    game.advance(2999);
    expect(visibleSlots(game.view('p3')).p2).toEqual({ 1: '7:hearts' });
    game.advance(1);
    expect(visibleSlots(game.view('p3')).p2).toEqual({});
  });

  it('validates the slot', () => {
    const game = windowOpenWith('6C');
    expect(game.fail('p2', { type: 'matchOwn', slot: 4 })).toBe('INVALID_SLOT');
    expect(game.fail('p2', { type: 'matchOwn', slot: -1 })).toBe('INVALID_ACTION');
  });
});

describe('matchOpponent ("filho da puta")', () => {
  it('right: their card is discarded, yours takes its place; you have one less, they keep the same count', () => {
    const game = windowOpenWith('6C');
    game.act('p3', { type: 'matchOpponent', target: { playerId: 'p2', slot: 0 }, giveSlot: 0 });
    expect(codes(game, 'p2')).toEqual(['A:diamonds', '7:hearts', '8:hearts', '9:hearts']);
    expect(codes(game, 'p3')).toEqual([null, '6:diamonds', 'K:hearts', 'joker:red']);
    expect(game.state.discardPile.at(-1)).toEqual(c('6H'));
    expect(game.lastEvents[0]).toEqual({
      type: 'reactionSucceeded',
      reaction: 'matchOpponent',
      playerId: 'p3',
      target: { playerId: 'p2', slot: 0 },
      giveSlot: 0,
      card: c('6H'),
    });
    // Nobody sees the card that was handed over.
    for (const viewer of ['p1', 'p2', 'p3']) {
      expect(facesIn(game.view(viewer))).not.toContain('A:diamonds');
    }
    expect(facesIn(game.lastEvents)).not.toContain('A:diamonds');
  });

  it('can target the player who discarded', () => {
    const game = windowOpenWith('2C');
    game.act('p2', { type: 'matchOpponent', target: { playerId: 'p1', slot: 0 }, giveSlot: 3 });
    expect(game.grid('p1')[0]).toEqual(c('9H'));
    expect(game.grid('p2')[3]).toBeNull();
  });

  it('wrong: nothing moves, the card you would give is shown to everyone, theirs stays hidden', () => {
    const game = windowOpenWith('6C');
    game.act('p3', { type: 'matchOpponent', target: { playerId: 'p2', slot: 1 }, giveSlot: 2 }); // 7H is not a 6
    expect(codes(game, 'p2')).toEqual(['6:hearts', '7:hearts', '8:hearts', '9:hearts']);
    expect(codes(game, 'p3')).toEqual(['A:diamonds', '6:diamonds', 'K:hearts', 'joker:red']);
    expect(game.lastEvents).toEqual([
      {
        type: 'reactionFailed',
        reaction: 'matchOpponent',
        playerId: 'p3',
        target: { playerId: 'p2', slot: 1 },
        giveSlot: 2,
        revealed: c('KH'),
      },
    ]);
    for (const viewer of ['p1', 'p2', 'p3', 'spectator']) {
      const view = game.view(viewer);
      expect(visibleSlots(view)).toEqual({ p1: {}, p2: {}, p3: { 2: 'K:hearts' } });
      expect(facesIn(view)).not.toContain('7:hearts');
    }
    expect(game.state.reaction).not.toBeNull();
  });

  it('validates target and give slot', () => {
    const game = windowOpenWith('6C');
    const react = (playerId: string, slot: number, giveSlot: number) => ({
      type: 'matchOpponent',
      target: { playerId, slot },
      giveSlot,
    });
    expect(game.fail('p2', react('p2', 0, 1))).toBe('INVALID_TARGET');
    expect(game.fail('p2', react('ghost', 0, 1))).toBe('INVALID_TARGET');
    expect(game.fail('p2', react('p3', 4, 1))).toBe('INVALID_SLOT');
    expect(game.fail('p2', react('p3', 1, 4))).toBe('INVALID_SLOT');
  });

  it('refuses empty positions', () => {
    const game = windowOpenWith('6C');
    game.act('p2', { type: 'matchOwn', slot: 0 }); // p2 slot 0 is now empty
    game.drawAndDiscard('p2');
    // window of p3's turn: p3 discards 7C
    const s = structuredClone(game.state);
    s.drawPile.unshift(...s.drawPile.splice(s.drawPile.findIndex((card) => key(card) === '7:clubs'), 1));
    game.state = s;
    game.act('p3', { type: 'draw' }).act('p3', { type: 'discardDrawn' });
    expect(game.fail('p1', { type: 'matchOpponent', target: { playerId: 'p2', slot: 0 }, giveSlot: 0 })).toBe('EMPTY_SLOT');
    expect(game.fail('p2', { type: 'matchOwn', slot: 0 })).toBe('EMPTY_SLOT');
    expect(game.fail('p2', { type: 'matchOpponent', target: { playerId: 'p1', slot: 0 }, giveSlot: 0 })).toBe('EMPTY_SLOT');
  });
});

describe('reaction window', () => {
  it('only the first right reaction counts', () => {
    const game = windowOpenWith('6C');
    game.act('p2', { type: 'matchOwn', slot: 0 });
    expect(game.fail('p3', { type: 'matchOwn', slot: 1 })).toBe('REACTION_WINDOW_CLOSED');
    expect(game.fail('p3', { type: 'matchOpponent', target: { playerId: 'p1', slot: 0 }, giveSlot: 1 })).toBe('REACTION_WINDOW_CLOSED');
    expect(game.grid('p3')[1]).toEqual(c('6D'));
  });

  it('a wrong reaction does not block a later right one', () => {
    const game = windowOpenWith('6C');
    game.act('p2', { type: 'matchOwn', slot: 2 }); // wrong
    game.act('p3', { type: 'matchOwn', slot: 1 }); // right
    expect(game.grid('p3')[1]).toBeNull();
    expect(game.state.reaction).toBeNull();
  });

  it('two attempts per player per window (default); the third is refused', () => {
    const game = windowOpenWith('6C');
    game.act('p2', { type: 'matchOwn', slot: 2 }); // wrong
    game.act('p2', { type: 'matchOwn', slot: 3 }); // wrong again (second and last attempt)
    expect(game.fail('p2', { type: 'matchOwn', slot: 0 })).toBe('REACTION_ALREADY_ATTEMPTED');
    expect(game.view('p1').reactionWindow).toMatchObject({ attemptedBy: ['p2'], attemptsPerPlayer: 2, yourAttemptsLeft: 2 });
    expect(game.view('p2').reactionWindow?.yourAttemptsLeft).toBe(0);
  });

  it('a right reaction still closes the window for everyone', () => {
    const game = windowOpenWith('6C');
    game.act('p2', { type: 'matchOwn', slot: 2 }); // wrong
    game.act('p2', { type: 'matchOwn', slot: 0 }); // right (6)
    expect(game.state.reaction).toBeNull();
  });

  it('accepts a reaction until just before the deadline, refuses it at the deadline', () => {
    const late = windowOpenWith('6C');
    const deadline = late.state.reaction?.deadline as number;
    expect(late.fail('p2', { type: 'matchOwn', slot: 0 }, deadline)).toBe('REACTION_WINDOW_CLOSED');
    expect(late.fail('p2', { type: 'matchOwn', slot: 0 }, deadline + 10_000)).toBe('REACTION_WINDOW_CLOSED');

    const inTime = windowOpenWith('6C');
    inTime.advanceTo(deadline - 1);
    inTime.act('p2', { type: 'matchOwn', slot: 0 });
    expect(inTime.grid('p2')[0]).toBeNull();
  });

  it('no window, no reaction', () => {
    const game = playing({ grids: [G1, G2, G3], draws: ['6C'] });
    expect(game.fail('p2', { type: 'matchOwn', slot: 0 })).toBe('REACTION_WINDOW_CLOSED');
    game.act('p1', { type: 'draw' });
    expect(game.fail('p2', { type: 'matchOwn', slot: 0 })).toBe('REACTION_WINDOW_CLOSED');
  });

  it('a swap also opens a window, on the card that left the grid (and grants no power)', () => {
    const game = playing({ grids: [G1, ['2H', '7H', '8H', '9H'], G3], draws: ['QC'] });
    game.act('p1', { type: 'draw' }).act('p1', { type: 'swapWithDrawn', slot: 0 }); // 2S discarded, QC kept
    expect(game.state.reaction?.card).toEqual(c('2S'));
    game.act('p2', { type: 'matchOwn', slot: 0 }); // 2H
    expect(game.grid('p2')[0]).toBeNull();
    expect(game.current).toBe('p2'); // no power step for p1
  });

  it('the discarder can react to their own discard, and still use the power afterwards', () => {
    const game = windowOpenWith('5C'); // 5C has no power
    game.act('p1', { type: 'matchOwn', slot: 3 }); // own 5S
    expect(game.grid('p1')[3]).toBeNull();
    expect(game.current).toBe('p2');

    const withPower = windowOpenWith('7C', [['7S', '3S', '4S', '5S'], G2, G3]);
    withPower.act('p1', { type: 'matchOwn', slot: 0 });
    expect(withPower.state.turn).toMatchObject({ playerId: 'p1', step: 'power', pendingPower: 'peekOwn' });
  });
});
