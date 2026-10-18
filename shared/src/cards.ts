// Card faces. This module only describes what a card *is*; values and powers
// are game rules and live in the server configuration (server/src/config).
//
// Cards deliberately carry no id: the 54 faces are all distinct (52 standard
// cards plus one red and one black joker), so a face is its own identity, and
// a hidden card is never sent to a client at all.

export const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'] as const;
export type Suit = (typeof SUITS)[number];

export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;
export type Rank = (typeof RANKS)[number];

export const CARD_COLORS = ['red', 'black'] as const;
export type CardColor = (typeof CARD_COLORS)[number];

export interface StandardCard {
  readonly kind: 'standard';
  readonly rank: Rank;
  readonly suit: Suit;
}

export interface JokerCard {
  readonly kind: 'joker';
  readonly color: CardColor;
}

export type Card = StandardCard | JokerCard;

const RED_SUITS: ReadonlySet<Suit> = new Set<Suit>(['hearts', 'diamonds']);

export function suitColor(suit: Suit): CardColor {
  return RED_SUITS.has(suit) ? 'red' : 'black';
}

export function cardColor(card: Card): CardColor {
  return card.kind === 'joker' ? card.color : suitColor(card.suit);
}
