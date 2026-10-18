import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Action, GameEvent } from '@moises/shared';
import { Bot, DEFAULT_BOT_TUNING, type BotTuning } from '../src/bots/index.js';
import { DEFAULT_RULES } from '../src/config/rules.js';
import { botKnowledge } from '../src/game/bot-knowledge.js';
import { c, key, newGame, type SetupOptions, type TestGame } from './helpers.js';

// Bot decisions in real engine situations. The bot is fed exactly what a
// client would get: its own view (viewFor) and the public events.

const KNOWLEDGE = botKnowledge(DEFAULT_RULES);

class Seat {
  readonly bot: Bot;
  constructor(
    readonly game: TestGame,
    readonly id: string,
    tuning: BotTuning = DEFAULT_BOT_TUNING,
  ) {
    this.bot = new Bot(id, KNOWLEDGE, () => 0, tuning);
  }
  sync(events: readonly GameEvent[] = this.game.lastEvents): this {
    this.bot.observe(this.game.view(this.id), events);
    return this;
  }
  decide(): Action | null {
    return this.bot.decide(this.game.view(this.id));
  }
  /** Decides and applies the move (it must be legal). */
  play(): Action {
    const action = this.decide();
    if (!action) throw new Error('bot had nothing to do');
    this.game.act(this.id, action);
    return action;
  }
  remembered(playerId: string, slot: number): string | null {
    const card = this.bot.remembered(playerId, slot);
    return card ? key(card) : null;
  }
}

/** Starts a game and lets every bot watch the arrangement and the initial peek. */
function start(options: SetupOptions, botIds: string[], tuning?: BotTuning): { game: TestGame; seats: Map<string, Seat> } {
  const game = newGame(options);
  const seats = new Map(botIds.map((id) => [id, new Seat(game, id, tuning)]));
  const syncAll = () => seats.forEach((seat) => seat.sync());
  syncAll();
  game.advanceTo(game.state.phaseDeadline as number); // -> initialPeek
  syncAll();
  game.advanceTo(game.state.phaseDeadline as number); // -> playing
  syncAll();
  return { game, seats };
}

function seat(seats: Map<string, Seat>, id: string): Seat {
  const found = seats.get(id);
  if (!found) throw new Error(`no seat ${id}`);
  return found;
}

/** Applies a move for a non-bot player and lets the bots watch. */
function human(game: TestGame, seats: Map<string, Seat>, playerId: string, action: Action): void {
  game.act(playerId, action);
  seats.forEach((s) => s.sync());
}

function closeWindow(game: TestGame, seats: Map<string, Seat>): void {
  game.closeWindow();
  seats.forEach((s) => s.sync());
}

describe('bot memory', () => {
  it('remembers the bottom row from the initial peek', () => {
    const { seats } = start({ grids: [['2S', '3S', '4S', '5S'], ['6H', '7H', 'KS', '9H']] }, ['p2']);
    const bot = seat(seats, 'p2');
    expect(bot.remembered('p2', 2)).toBe(key(c('KS')));
    expect(bot.remembered('p2', 3)).toBe(key(c('9H')));
    expect(bot.remembered('p2', 0)).toBeNull();
    expect(bot.remembered('p1', 2)).toBeNull(); // never sees an opponent's peek
  });

  it('follows a blind swap made by an opponent', () => {
    const { game, seats } = start({ grids: [['2S', '3S', '4S', '5S'], ['6H', '7H', 'KS', '9H']], draws: ['QS'] }, ['p2']);
    const bot = seat(seats, 'p2');
    human(game, seats, 'p1', { type: 'draw' });
    human(game, seats, 'p1', { type: 'discardDrawn' });
    closeWindow(game, seats);
    human(game, seats, 'p1', { type: 'usePower', power: 'blindSwap', ownSlot: 0, target: { playerId: 'p2', slot: 2 } });
    expect(bot.remembered('p1', 0)).toBe(key(c('KS'))); // its K went to p1
    expect(bot.remembered('p2', 2)).toBeNull(); // and it does not know what came back
  });

  it('forgets a position whose card an opponent replaced', () => {
    const { game, seats } = start(
      { grids: [['7D', '3S', '4S', '5S'], ['6H', 'QH', '2H', '3H']], draws: ['9C', 'AC'], first: 'p2' },
      ['p2'],
    );
    const bot = seat(seats, 'p2');
    bot.play(); // draw the 9
    bot.sync();
    bot.play(); // discard it
    closeWindow(game, seats);
    expect(bot.play()).toEqual({ type: 'usePower', power: 'peekOpponent', target: { playerId: 'p1', slot: 0 } });
    bot.sync();
    expect(bot.remembered('p1', 0)).toBe(key(c('7D')));
    human(game, seats, 'p1', { type: 'draw' });
    human(game, seats, 'p1', { type: 'swapWithDrawn', slot: 0 });
    expect(bot.remembered('p1', 0)).toBeNull();
    expect(bot.remembered('p2', 2)).toBe(key(c('2H')));
  });
});

describe('bot turn', () => {
  it('replaces its worst known card with a lower drawn card', () => {
    const { seats } = start({ grids: [['2S', '3S', '4S', '5S'], ['6H', '7H', 'KS', '9H']], draws: ['5C'], first: 'p2' }, ['p2']);
    const bot = seat(seats, 'p2');
    expect(bot.play()).toEqual({ type: 'draw' });
    bot.sync();
    expect(bot.play()).toEqual({ type: 'swapWithDrawn', slot: 2 });
    bot.sync();
    expect(bot.remembered('p2', 2)).toBe(key(c('5C'))); // it knows what it put there
  });

  it('keeps a low card even on an unknown position', () => {
    const { seats } = start({ grids: [['2S', '3S', '4S', '5S'], ['6H', '7H', '2H', '3H']], draws: ['AC'], first: 'p2' }, ['p2']);
    const bot = seat(seats, 'p2');
    bot.play();
    bot.sync();
    const action = bot.play();
    expect(action.type).toBe('swapWithDrawn');
    expect([0, 1]).toContain((action as { slot: number }).slot);
  });

  it('discards a card of the same rank as a known own card, then sheds it with a reaction', () => {
    const { game, seats } = start({ grids: [['2S', '3S', '4S', '5S'], ['6H', '7H', 'KS', '9H']], draws: ['9C'], first: 'p2' }, ['p2']);
    const bot = seat(seats, 'p2');
    bot.play();
    bot.sync();
    expect(bot.play()).toEqual({ type: 'discardDrawn' });
    bot.sync();
    expect(bot.decide()).toEqual({ type: 'claimReaction', kind: 'matchOwn' });
    bot.play();
    bot.sync();
    expect(bot.decide()).toEqual({ type: 'matchOwn', slot: 3 });
    bot.play();
    expect(game.grid('p2')[3]).toBeNull();
    expect(game.lastEvents.some((e) => e.type === 'reactionSucceeded')).toBe(true);
  });

  it('uses 7/8 to look at an unknown own card', () => {
    const { seats } = start({ grids: [['2S', '3S', '4S', '5S'], ['6H', '7H', '2H', '3H']], draws: ['8C'], first: 'p2' }, ['p2']);
    const bot = seat(seats, 'p2');
    const game = bot.game;
    bot.play();
    bot.sync();
    expect(bot.play()).toEqual({ type: 'discardDrawn' });
    closeWindow(game, seats);
    const action = bot.play();
    expect(action).toMatchObject({ type: 'usePower', power: 'peekOwn' });
    bot.sync();
    const slot = (action as { slot: number }).slot;
    expect(bot.remembered('p2', slot)).toBe(key(game.grid('p2')[slot] ?? c('AS')));
  });

  it('uses 9/10 to look at an opponent card, then takes it with "filho da puta" when the rank comes up', () => {
    const { game, seats } = start(
      { grids: [['7D', '3S', '4S', '5S'], ['6H', 'QH', '2H', '3H']], draws: ['9C', '7S'], first: 'p2' },
      ['p2'],
    );
    const bot = seat(seats, 'p2');
    bot.play(); // draw 9
    bot.sync();
    expect(bot.play()).toEqual({ type: 'discardDrawn' });
    bot.sync();
    expect(bot.decide()).toBeNull(); // nothing to react with
    closeWindow(game, seats);
    expect(bot.play()).toEqual({ type: 'usePower', power: 'peekOpponent', target: { playerId: 'p1', slot: 0 } });
    bot.sync();
    expect(bot.remembered('p1', 0)).toBe(key(c('7D')));
    // p1 discards a 7: the bot knows p1 holds the 7 of diamonds.
    human(game, seats, 'p1', { type: 'draw' });
    human(game, seats, 'p1', { type: 'discardDrawn' });
    expect(bot.play()).toEqual({ type: 'claimReaction', kind: 'matchOpponent' });
    bot.sync();
    const reaction = bot.decide();
    expect(reaction).toMatchObject({ type: 'matchOpponent', target: { playerId: 'p1', slot: 0 } });
    bot.play();
    expect(game.lastEvents.some((e) => e.type === 'reactionSucceeded' && e.reaction === 'matchOpponent')).toBe(true);
  });

  it('J: peeks an opponent card and swaps it in when it is low', () => {
    const { game, seats } = start(
      { grids: [['AS', 'AC', 'AD', '2C'], ['6H', 'QH', '2H', '3H']], draws: ['JC'], first: 'p2' },
      ['p2'],
    );
    const bot = seat(seats, 'p2');
    bot.play();
    bot.sync();
    expect(bot.play()).toEqual({ type: 'discardDrawn' });
    closeWindow(game, seats);
    const peek = bot.play();
    expect(peek).toMatchObject({ type: 'usePower', power: 'peekAndSwap', target: { playerId: 'p1' } });
    bot.sync();
    const target = (peek as { target: { playerId: string; slot: number } }).target;
    const peekedCard = game.grid('p1')[target.slot];
    expect(bot.decide()).toMatchObject({ type: 'powerSwap', target });
    bot.play();
    bot.sync();
    expect(game.grid('p2').map((card) => (card ? key(card) : null))).toContain(key(peekedCard ?? c('KS')));
  });

  it('J: declines the swap when the peeked card is high', () => {
    const { game, seats } = start(
      { grids: [['KS', 'KC', 'QS', 'QC'], ['6H', 'QH', '2H', '3H']], draws: ['JC'], first: 'p2' },
      ['p2'],
    );
    const bot = seat(seats, 'p2');
    bot.play();
    bot.sync();
    bot.play();
    closeWindow(game, seats);
    expect(bot.play()).toMatchObject({ type: 'usePower', power: 'peekAndSwap' });
    bot.sync();
    expect(bot.decide()).toEqual({ type: 'skipPower' });
  });

  it('black K: looks at the right number of distinct opponent cards', () => {
    const { game, seats } = start(
      { grids: [['AS', '3S', '4S', '5S'], ['6H', 'QH', '2H', '3H'], ['AD', '2D', '3D', '4D']], draws: ['KC'], first: 'p2' },
      ['p2'],
    );
    const bot = seat(seats, 'p2');
    bot.play();
    bot.sync();
    expect(bot.play()).toEqual({ type: 'discardDrawn' });
    closeWindow(game, seats);
    const action = bot.play();
    expect(action).toMatchObject({ type: 'usePower', power: 'peekManyAndSwap' });
    const targets = (action as { targets: { playerId: string; slot: number }[] }).targets;
    expect(targets).toHaveLength(DEFAULT_RULES.powers.peekManyCount);
    expect(new Set(targets.map((t) => `${t.playerId}#${t.slot}`)).size).toBe(targets.length);
    expect(targets.every((t) => t.playerId !== 'p2')).toBe(true);
  });

  it('Q: blind swap only gives away a known high card', () => {
    const high = start({ grids: [['2S', '3S', '4S', '5S'], ['6H', '7H', 'KS', '9H']], draws: ['QC'], first: 'p2' }, ['p2']);
    let bot = seat(high.seats, 'p2');
    bot.play();
    bot.sync();
    expect(bot.play()).toEqual({ type: 'discardDrawn' });
    closeWindow(high.game, high.seats);
    expect(bot.decide()).toMatchObject({ type: 'usePower', power: 'blindSwap', ownSlot: 2 });

    const low = start({ grids: [['2S', '3S', '4S', '5S'], ['6H', '7H', 'AH', '2H']], draws: ['QC'], first: 'p2' }, ['p2']);
    bot = seat(low.seats, 'p2');
    bot.play();
    bot.sync();
    bot.play();
    closeWindow(low.game, low.seats);
    expect(bot.decide()).toEqual({ type: 'skipPower' });
  });
});

describe('bot end call and timing', () => {
  it('says "Estou foda" when it knows its total is low', () => {
    const tuning = { ...DEFAULT_BOT_TUNING, maxUnknownToCall: 2, endThreshold: 20 };
    const { seats } = start({ grids: [['2S', '3S', '4S', '5S'], ['AH', '2H', 'AD', '2D']], first: 'p2' }, ['p2'], tuning);
    const bot = seat(seats, 'p2');
    expect(bot.play()).toEqual({ type: 'callEnd' });
    bot.sync();
    expect(bot.decide()).toEqual({ type: 'draw' }); // and then plays its turn normally
  });

  it('does not call the end with an unknown, high hand', () => {
    const { seats } = start({ grids: [['2S', '3S', '4S', '5S'], ['AH', '2H', 'KS', 'QD']], first: 'p2' }, ['p2']);
    expect(seat(seats, 'p2').decide()).toEqual({ type: 'draw' });
  });

  it('always calls the end after the configured number of own turns', () => {
    const tuning = { ...DEFAULT_BOT_TUNING, forceEndAfterTurns: 1 };
    const { seats } = start({ grids: [['2S', '3S', '4S', '5S'], ['KH', 'KS', 'QS', 'QD']], first: 'p2' }, ['p2'], tuning);
    expect(seat(seats, 'p2').decide()).toEqual({ type: 'callEnd' });
  });

  it('waits outside its turn and outside the playing phase', () => {
    const game = newGame({ grids: [['2S', '3S', '4S', '5S'], ['6H', '7H', 'KS', '9H']] });
    const bot = new Seat(game, 'p2').sync();
    expect(bot.decide()).toBeNull(); // arrange phase
    game.advanceTo(game.state.phaseDeadline as number);
    game.advanceTo(game.state.phaseDeadline as number);
    bot.sync();
    expect(game.current).toBe('p1');
    expect(bot.decide()).toBeNull(); // p1's turn, no reaction window
  });

  it('reacts at most once per window', () => {
    const { game, seats } = start({ grids: [['2S', '3S', '4S', '5S'], ['6H', '7H', 'KS', '9H']], draws: ['9C'] }, ['p2']);
    const bot = seat(seats, 'p2');
    human(game, seats, 'p1', { type: 'draw' });
    human(game, seats, 'p1', { type: 'discardDrawn' });
    expect(bot.play()).toEqual({ type: 'claimReaction', kind: 'matchOwn' });
    bot.sync();
    expect(bot.play()).toEqual({ type: 'matchOwn', slot: 3 });
    bot.sync();
    expect(bot.decide()).toBeNull();
  });
});

describe('bot fairness', () => {
  it('the bots module imports nothing but the shared types and itself', () => {
    const dir = new URL('../src/bots/', import.meta.url);
    for (const file of readdirSync(dir).filter((name) => name.endsWith('.ts'))) {
      const source = readFileSync(new URL(file, dir), 'utf8');
      const specifiers = [...source.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1] as string);
      for (const specifier of specifiers) {
        expect(specifier === '@moises/shared' || specifier.startsWith('./'), `${file} imports ${specifier}`).toBe(true);
      }
    }
  });
});
