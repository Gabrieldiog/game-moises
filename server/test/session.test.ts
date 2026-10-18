import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameView, ServerGameEvent } from '@moises/shared';
import { Bot } from '../src/bots/index.js';
import { DEFAULT_RULES, type RulesConfig } from '../src/config/rules.js';
import { viewFor } from '../src/engine/index.js';
import { GameSession } from '../src/game/session.js';
import { IDS, SEED, T0, c, stackDeck } from './helpers.js';
import { bots, simulate } from './support/sim.js';

const TURN = DEFAULT_RULES.timings.turnMs;
const WINDOW = DEFAULT_RULES.timings.reactionWindowMs;
/** When the first turn starts (after arrangement and initial peek). */
const PLAY = T0 + DEFAULT_RULES.timings.arrangeMs + DEFAULT_RULES.timings.initialPeekMs;

interface Setup {
  grids: string[][];
  draws?: string[];
  first?: string;
  bots?: string[];
  botDelayMs?: { min: number; max: number };
  rules?: RulesConfig;
}

function session(setup: Setup): GameSession {
  const rules = setup.rules ?? DEFAULT_RULES;
  const ids = IDS.slice(0, setup.grids.length);
  return new GameSession({
    players: ids.map((id) => ({ id, name: id.toUpperCase(), isBot: (setup.bots ?? []).includes(id) })),
    rules,
    seed: SEED,
    now: T0,
    random: () => 0,
    botDelayMs: setup.botDelayMs ?? { min: 0, max: 0 },
    deck: stackDeck(setup.grids.map((g) => g.map(c)), (setup.draws ?? []).map(c), rules),
    firstPlayerId: setup.first ?? 'p1',
  });
}

const G1 = ['2S', '3S', '4S', '5S'];
const G2 = ['6H', '7H', 'KS', '9H'];

/** Lets the arrangement and the initial peek run out, as the room timer would. */
function toPlay(s: GameSession): GameSession {
  s.advance(T0 + DEFAULT_RULES.timings.arrangeMs);
  s.advance(PLAY);
  return s;
}

function types(events: readonly ServerGameEvent[]): string[] {
  return events.map((e) => e.type);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('turn timer', () => {
  it('gives the current player turnMs for each decision', () => {
    const s = session({ grids: [G1, G2] });
    expect(s.turnDeadline).toBeNull(); // arrangement: no turn yet
    toPlay(s);
    expect(s.internalState.turn).toMatchObject({ playerId: 'p1', step: 'draw' });
    expect(s.turnDeadline).toBe(PLAY + TURN);
    expect(s.act('p1', { type: 'draw' }, PLAY + 1000)).toEqual({ ok: true });
    expect(s.turnDeadline).toBe(PLAY + 1000 + TURN);
    s.act('p1', { type: 'discardDrawn' }, PLAY + 2000);
    expect(s.turnDeadline).toBeNull(); // reaction window: waits for everyone, with its own deadline
  });

  it('plays the minimum (draw and discard) when the player runs out of time', () => {
    const s = session({ grids: [G1, G2], draws: ['5C'] });
    toPlay(s);
    s.drainEvents();
    const before = s.version;
    s.advance(PLAY + TURN - 1);
    expect(s.version).toBe(before);
    expect(s.nextWakeAt()).toBe(PLAY + TURN);

    s.advance(PLAY + TURN);
    const events = s.drainEvents();
    expect(events[0]).toEqual({ type: 'turnTimedOut', playerId: 'p1', turnNumber: 1, step: 'draw' });
    expect(types(events)).toEqual(['turnTimedOut', 'cardDrawn', 'drawnCardDiscarded', 'reactionWindowOpened']);
    expect(s.internalState.turn?.step).toBe('reaction');
    expect(s.stats.timeouts).toBe(1);

    s.advance(PLAY + TURN + WINDOW);
    expect(s.internalState.turn).toMatchObject({ playerId: 'p2', step: 'draw' });
    expect(s.turnDeadline).toBe(PLAY + TURN + WINDOW + TURN);
  });

  it('skips the power at once when a timed-out turn reaches it', () => {
    const s = toPlay(session({ grids: [G1, G2], draws: ['7C'] }));
    s.advance(PLAY + TURN); // auto draw + discard of a 7 (peekOwn)
    s.drainEvents();
    s.advance(PLAY + TURN + WINDOW);
    const events = s.drainEvents();
    expect(types(events)).toEqual(['reactionWindowClosed', 'powerAvailable', 'powerSkipped', 'turnStarted']);
    expect(events).toContainEqual({ type: 'powerSkipped', by: 'p1', power: 'peekOwn', reason: 'player' });
    expect(s.stats.timeouts).toBe(1); // one timeout for the whole turn
  });

  it('times out the power step on its own when the player stops there', () => {
    const s = session({ grids: [G1, G2], draws: ['7C'] });
    toPlay(s);
    s.act('p1', { type: 'draw' }, PLAY);
    s.act('p1', { type: 'discardDrawn' }, PLAY);
    s.advance(PLAY + WINDOW);
    expect(s.internalState.turn?.step).toBe('power');
    expect(s.turnDeadline).toBe(PLAY + WINDOW + TURN);
    s.drainEvents();
    s.advance(PLAY + WINDOW + TURN);
    expect(s.drainEvents()).toEqual(
      expect.arrayContaining([
        { type: 'turnTimedOut', playerId: 'p1', turnNumber: 1, step: 'power' },
        { type: 'powerSkipped', by: 'p1', power: 'peekOwn', reason: 'player' },
      ]),
    );
    expect(s.internalState.turn?.playerId).toBe('p2');
  });

  it('refuses a late move once the server has played for the player', () => {
    const s = session({ grids: [G1, G2], draws: ['5C'] });
    toPlay(s);
    s.act('p1', { type: 'draw' }, PLAY);
    const late = s.act('p1', { type: 'swapWithDrawn', slot: 0 }, PLAY + TURN + 1);
    expect(late).toEqual({ ok: false, error: expect.objectContaining({ code: 'INVALID_PHASE' }) });
    expect(s.internalState.discardPile.map((card) => card)).toContainEqual(c('5C'));
  });

  it('refuses moves out of turn without changing anything', () => {
    const s = session({ grids: [G1, G2] });
    toPlay(s);
    const version = s.version;
    expect(s.act('p2', { type: 'draw' }, PLAY)).toEqual({ ok: false, error: expect.objectContaining({ code: 'NOT_YOUR_TURN' }) });
    expect(s.act('p9', { type: 'draw' }, PLAY)).toEqual({ ok: false, error: expect.objectContaining({ code: 'UNKNOWN_PLAYER' }) });
    expect(s.version).toBe(version);
  });

  it('uses the configured turnMs', () => {
    const rules = { ...DEFAULT_RULES, timings: { ...DEFAULT_RULES.timings, turnMs: 1234 } };
    const s = session({ grids: [G1, G2], rules });
    toPlay(s);
    expect(s.turnDeadline).toBe(PLAY + 1234);
  });
});

describe('bots in a session', () => {
  it('a bot plays after the configured delay', () => {
    const s = session({ grids: [G1, G2], bots: ['p1'], botDelayMs: { min: 400, max: 400 } });
    toPlay(s);
    expect(s.nextWakeAt()).toBe(PLAY + 400);
    s.drainEvents();
    s.advance(PLAY + 399);
    expect(s.drainEvents()).toEqual([]);
    s.advance(PLAY + 400);
    expect(s.drainEvents()).toContainEqual({ type: 'cardDrawn', playerId: 'p1' });
    expect(s.stats.botActions).toBe(1);
  });

  it('a bot reaction always lands before the window closes, even with a long delay', () => {
    const s = session({ grids: [G1, G2], draws: ['9C'], bots: ['p2'], botDelayMs: { min: 5000, max: 5000 } });
    toPlay(s);
    s.act('p1', { type: 'draw' }, PLAY);
    s.act('p1', { type: 'discardDrawn' }, PLAY); // a 9: the bot saw its own 9 in the initial peek
    expect(s.nextWakeAt()).toBe(PLAY + WINDOW - 50);
    s.drainEvents();
    s.advance(PLAY + WINDOW - 50);
    // The bot shouts first (claimReaction), which extends the deadline; then it picks the card.
    expect(s.drainEvents()).toContainEqual({ type: 'reactionClaimed', by: 'p2', kind: 'matchOwn' });
    s.advance(PLAY + WINDOW - 50 + 5000);
    expect(s.drainEvents()).toContainEqual(expect.objectContaining({ type: 'reactionSucceeded', playerId: 'p2', slot: 3 }));
  });

  it('nothing is scheduled once the game is over', () => {
    const { session: s, endTime } = simulate({ players: bots(3), seed: 7 });
    expect(s.phase).toBe('ended');
    expect(s.nextWakeAt()).toBeNull();
    expect(s.turnDeadline).toBeNull();
    expect(s.act('b1', { type: 'draw' }, endTime + 1)).toEqual({ ok: false, error: expect.objectContaining({ code: 'GAME_OVER' }) });
  });

  it('bots only ever receive the view built for their own seat', () => {
    const seen: { bot: string; view: GameView }[] = [];
    const observe = Bot.prototype.observe;
    vi.spyOn(Bot.prototype, 'observe').mockImplementation(function (this: Bot, view, events) {
      seen.push({ bot: this.id, view: structuredClone(view) });
      observe.call(this, view, events);
    });
    const decide = Bot.prototype.decide;
    vi.spyOn(Bot.prototype, 'decide').mockImplementation(function (this: Bot, view) {
      seen.push({ bot: this.id, view: structuredClone(view) });
      return decide.call(this, view);
    });
    const { session: s } = simulate({ players: bots(4), seed: 11 });
    expect(s.phase).toBe('ended');
    expect(seen.length).toBeGreaterThan(100);
    for (const { bot, view } of seen) {
      expect(view.you).toBe(bot);
      if (view.turn?.drawnCard) expect(view.turn.playerId).toBe(bot);
    }
  });

  it('the view a bot gets is exactly viewFor(state, bot)', () => {
    const s = session({ grids: [G1, G2], bots: ['p2'] });
    toPlay(s);
    expect(s.viewFor('p2', PLAY)).toEqual(viewFor(s.internalState, 'p2', PLAY));
  });
});
