import { describe, expect, it } from 'vitest';
import type { PowerKind } from '@moises/shared';
import { DEFAULT_RULES, type RulesConfig } from '../src/config/rules.js';
import { buildDeck, cardPower, cardValue, sameRank } from '../src/engine/index.js';
import { c, key } from './helpers.js';

const rules = DEFAULT_RULES;

describe('deck', () => {
  const deck = buildDeck(rules);

  it('has 54 distinct cards: 52 standard + red and black joker', () => {
    expect(deck).toHaveLength(54);
    expect(new Set(deck.map(key)).size).toBe(54);
    expect(deck.filter((card) => card.kind === 'standard')).toHaveLength(52);
    expect(deck.filter((card) => card.kind === 'joker').map(key).sort()).toEqual(['joker:black', 'joker:red']);
    for (const suit of ['spades', 'hearts', 'diamonds', 'clubs']) {
      expect(deck.filter((card) => card.kind === 'standard' && card.suit === suit)).toHaveLength(13);
    }
  });

  it('sums to 336 points (4 x (1..12) + 2 x 13 - 2 x 1 + 0)', () => {
    expect(deck.reduce((sum, card) => sum + cardValue(card, rules), 0)).toBe(336);
  });
});

describe('card values', () => {
  it.each([
    ['AS', 1],
    ['AH', 1],
    ['2C', 2],
    ['5D', 5],
    ['9H', 9],
    ['10S', 10],
    ['JC', 11],
    ['QH', 12],
    ['KS', 13],
    ['KC', 13],
    ['KH', -1],
    ['KD', -1],
    ['JKR', 0],
    ['JKB', 0],
  ])('%s = %i', (code, value) => {
    expect(cardValue(c(code), rules)).toBe(value);
  });

  it('every face from 2 to 10 is worth its number, in every suit', () => {
    for (const suit of ['S', 'H', 'D', 'C']) {
      for (let n = 2; n <= 10; n++) expect(cardValue(c(`${n}${suit}`), rules)).toBe(n);
    }
  });

  it('reads values from the config', () => {
    const custom = structuredClone(rules) as RulesConfig;
    custom.cards.values.A = 50;
    custom.cards.joker.value = -5;
    expect(cardValue(c('AS'), custom)).toBe(50);
    expect(cardValue(c('JKB'), custom)).toBe(-5);
  });
});

describe('card powers', () => {
  const expected: [string, PowerKind | null][] = [
    ['AS', null],
    ['2H', null],
    ['3D', null],
    ['4C', null],
    ['5S', null],
    ['6H', null],
    ['7S', 'peekOwn'],
    ['7H', 'peekOwn'],
    ['8D', 'peekOwn'],
    ['9C', 'peekOpponent'],
    ['10H', 'peekOpponent'],
    ['JS', 'peekAndSwap'],
    ['JD', 'peekAndSwap'],
    ['QC', 'blindSwap'],
    ['QH', 'blindSwap'],
    ['KS', 'peekManyAndSwap'],
    ['KC', 'peekManyAndSwap'],
    ['KH', null],
    ['KD', null],
    ['JKR', null],
    ['JKB', null],
  ];
  it.each(expected)('%s -> %s', (code, power) => {
    expect(cardPower(c(code), rules)).toBe(power);
  });
});

describe('sameRank ("mesmo número")', () => {
  it('ignores the suit', () => {
    expect(sameRank(c('5H'), c('5S'), rules)).toBe(true);
    expect(sameRank(c('10D'), c('10C'), rules)).toBe(true);
    expect(sameRank(c('5H'), c('6H'), rules)).toBe(false);
  });

  it('red and black kings are the same number', () => {
    expect(sameRank(c('KH'), c('KS'), rules)).toBe(true);
  });

  it('jokers match each other by default, never a standard card', () => {
    expect(sameRank(c('JKR'), c('JKB'), rules)).toBe(true);
    expect(sameRank(c('JKR'), c('AS'), rules)).toBe(false);
    expect(sameRank(c('KH'), c('JKB'), rules)).toBe(false);
    const strict = structuredClone(rules) as RulesConfig;
    strict.reactions.jokersMatchEachOther = false;
    expect(sameRank(c('JKR'), c('JKB'), strict)).toBe(false);
  });
});
