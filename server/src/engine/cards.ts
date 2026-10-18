import { CARD_COLORS, RANKS, SUITS, cardColor, type Card, type PowerKind } from '@moises/shared';
import type { RulesConfig } from '../config/rules.js';

/** The full deck in a fixed canonical order (suits x ranks, then jokers). */
export function buildDeck(rules: RulesConfig): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) deck.push({ kind: 'standard', rank, suit });
  }
  for (const color of rules.deck.jokerColors) deck.push({ kind: 'joker', color });
  return deck;
}

/** Stable identity of a face (all 54 faces are distinct). Server-internal. */
export function cardKey(card: Card): string {
  return card.kind === 'joker' ? `joker:${card.color}` : `${card.rank}:${card.suit}`;
}

export function sameCard(a: Card, b: Card): boolean {
  return cardKey(a) === cardKey(b);
}

/** Copy with only the public fields, so nothing internal can ride along into a view or event. */
export function publicCard(card: Card): Card {
  return card.kind === 'joker'
    ? { kind: 'joker', color: card.color }
    : { kind: 'standard', rank: card.rank, suit: card.suit };
}

export function cardValue(card: Card, rules: RulesConfig): number {
  if (card.kind === 'joker') return rules.cards.joker.value;
  if (cardColor(card) === 'red') {
    const override = rules.cards.redOverrides[card.rank]?.value;
    if (override !== undefined) return override;
  }
  return rules.cards.values[card.rank];
}

export function cardPower(card: Card, rules: RulesConfig): PowerKind | null {
  if (card.kind === 'joker') return rules.cards.joker.power;
  if (cardColor(card) === 'red') {
    const override = rules.cards.redOverrides[card.rank];
    if (override && override.power !== undefined) return override.power;
  }
  return rules.cards.powers[card.rank] ?? null;
}

/** "Mesmo número": same rank, any suit. Jokers match each other only if the rules say so. */
export function sameRank(a: Card, b: Card, rules: RulesConfig): boolean {
  if (a.kind === 'joker' || b.kind === 'joker') {
    return a.kind === 'joker' && b.kind === 'joker' && rules.reactions.jokersMatchEachOther;
  }
  return a.rank === b.rank;
}

/** Runtime check for card-shaped data coming from outside (e.g. a fixed test deck). */
export function isCard(value: unknown): value is Card {
  if (value === null || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (record['kind'] === 'joker') {
    return Object.keys(record).length === 2 && (CARD_COLORS as readonly unknown[]).includes(record['color']);
  }
  if (record['kind'] === 'standard') {
    return (
      Object.keys(record).length === 3 &&
      (RANKS as readonly unknown[]).includes(record['rank']) &&
      (SUITS as readonly unknown[]).includes(record['suit'])
    );
  }
  return false;
}
