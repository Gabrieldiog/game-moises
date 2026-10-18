import type { BotKnowledge } from '../bots/index.js';
import type { RulesConfig } from '../config/rules.js';
import { buildDeck, cardPower, cardValue, sameRank } from '../engine/index.js';

/**
 * The rules a bot knows (card values and powers), as plain functions of a
 * card. It gives no access to any game state: the bot still only sees its own
 * view. Lives outside server/src/bots so that module never imports the engine.
 */
export function botKnowledge(rules: RulesConfig): BotKnowledge {
  const deck = buildDeck(rules);
  const average = deck.reduce((sum, card) => sum + cardValue(card, rules), 0) / deck.length;
  return {
    valueOf: (card) => cardValue(card, rules),
    powerOf: (card) => cardPower(card, rules),
    sameRank: (a, b) => sameRank(a, b, rules),
    peekManyCount: rules.powers.peekManyCount,
    unknownCardValue: average,
  };
}
