import { describe, expect, it } from 'vitest';
import { RANKS, SUITS, cardColor, suitColor } from '../src/index.js';

describe('cards', () => {
  it('has 13 ranks and 4 suits', () => {
    expect(RANKS).toHaveLength(13);
    expect(SUITS).toHaveLength(4);
  });

  it('hearts and diamonds are red, spades and clubs are black', () => {
    expect(suitColor('hearts')).toBe('red');
    expect(suitColor('diamonds')).toBe('red');
    expect(suitColor('spades')).toBe('black');
    expect(suitColor('clubs')).toBe('black');
  });

  it('a joker has its own color', () => {
    expect(cardColor({ kind: 'joker', color: 'red' })).toBe('red');
    expect(cardColor({ kind: 'joker', color: 'black' })).toBe('black');
    expect(cardColor({ kind: 'standard', rank: 'K', suit: 'diamonds' })).toBe('red');
  });
});
