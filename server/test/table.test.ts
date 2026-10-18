import { describe, expect, it } from 'vitest';
import type { SetTableSettingsPayload } from '@moises/shared';
import { DEFAULT_RULES, type RulesConfig } from '../src/config/rules.js';
import { RoomManager, type Outcome } from '../src/rooms/manager.js';
import { FakeClock, FakeTransport, testConfig } from './support/fakes.js';
import { c, playing } from './helpers.js';

const IP = '10.0.0.1';

function rulesWith(patch: (r: RulesConfig['reactions']) => RulesConfig['reactions']): RulesConfig {
  return { ...DEFAULT_RULES, reactions: patch(DEFAULT_RULES.reactions) };
}

function setup() {
  const clock = new FakeClock();
  const transport = new FakeTransport();
  const rooms = new RoomManager({
    config: testConfig(),
    rules: DEFAULT_RULES,
    transport,
    deps: { now: () => clock.now, scheduler: clock.scheduler, random: () => 0.5, roomCode: () => 'ROOM00' },
  });
  return { clock, transport, rooms };
}
const data = <T,>(o: Outcome<T>): T => {
  if (!o.ok) throw new Error(`expected success, got ${o.code}`);
  return o.data;
};
const code = (o: Outcome<unknown>) => (o.ok ? null : o.code);

const G1 = ['2S', '3S', '4S', '5S'];
const G2 = ['6H', '3H', '4H', '5H'];

describe('table settings: engine rules', () => {
  it('matchOwn off: the reaction is refused and the window does not change', () => {
    const rules = rulesWith((r) => ({ ...r, matchOwn: false }));
    const game = playing({ grids: [G1, G2], draws: ['6C'], rules });
    game.act('p1', { type: 'draw' }).act('p1', { type: 'discardDrawn' });
    expect(game.fail('p2', { type: 'matchOwn', slot: 0 })).toBe('REACTION_DISABLED');
    expect(game.state.reaction?.attempts).toEqual([]);
    game.act('p2', { type: 'matchOpponent', target: { playerId: 'p1', slot: 0 }, giveSlot: 1 }); // wrong but allowed
    expect(game.lastEvents[0]).toMatchObject({ type: 'reactionFailed', reaction: 'matchOpponent' });
  });

  it('matchOpponent off: refused independently', () => {
    const rules = rulesWith((r) => ({ ...r, matchOpponent: false }));
    const game = playing({ grids: [G1, G2], draws: ['6C'], rules });
    game.act('p1', { type: 'draw' }).act('p1', { type: 'discardDrawn' });
    expect(game.fail('p2', { type: 'matchOpponent', target: { playerId: 'p1', slot: 0 }, giveSlot: 0 })).toBe('REACTION_DISABLED');
    game.act('p2', { type: 'matchOwn', slot: 0 });
    expect(game.grid('p2')[0]).toBeNull();
  });

  it('both reactions off: no window opens at all', () => {
    const rules = rulesWith((r) => ({ ...r, matchOwn: false, matchOpponent: false }));
    const game = playing({ grids: [G1, G2], draws: ['6C'], rules });
    game.act('p1', { type: 'draw' }).act('p1', { type: 'discardDrawn' });
    expect(game.state.reaction).toBeNull();
    expect(game.lastEvents.map((e) => e.type)).toEqual(['drawnCardDiscarded', 'turnStarted']);
    expect(game.current).toBe('p2');
  });

  it('a power switched off does nothing; the others still work', () => {
    const { Q: _q, ...rest } = DEFAULT_RULES.cards.powers;
    const rules: RulesConfig = { ...DEFAULT_RULES, cards: { ...DEFAULT_RULES.cards, powers: rest } };
    const game = playing({ grids: [G1, G2], draws: ['QC'], rules });
    game.act('p1', { type: 'draw' }).act('p1', { type: 'discardDrawn' });
    game.act('p2', { type: 'matchOwn', slot: 2 }); // wrong guess, still a window
    game.advanceTo(game.now + 10_000);
    expect(game.state.turn?.pendingPower ?? null).toBeNull();
    expect(game.current).toBe('p2');
    void c;
  });
});

describe('room:setTable (manager)', () => {
  const settings: SetTableSettingsPayload = { turnSeconds: 20, reactions: { matchOwn: true, matchOpponent: false }, powers: ['7', 'J'] };

  function lobby() {
    const env = setup();
    const host = data(env.rooms.createRoom('s1', IP, 'Ana'));
    data(env.rooms.joinRoom('s2', host.room.code, 'Bia'));
    env.rooms.flush();
    return { ...env, host };
  }

  it('shows the defaults in RoomView', () => {
    const { host } = lobby();
    expect(host.room.table).toEqual({
      turnSeconds: 15,
      reactions: { matchOwn: true, matchOpponent: true },
      powers: ['7', '8', '9', '10', 'J', 'Q', 'K'],
    });
    expect(host.room.queue).toEqual([]);
    expect(host.room.availablePowers).toEqual(['7', '8', '9', '10', 'J', 'Q', 'K']);
  });

  it('only the host can set it', () => {
    const { rooms } = lobby();
    expect(code(rooms.setTable('s2', settings))).toBe('NOT_HOST');
    expect(code(rooms.setTable('s9', settings))).toBe('NOT_IN_ROOM');
  });

  it('applies, broadcasts, and becomes the rules of the game', () => {
    const { rooms, transport } = lobby();
    data(rooms.setTable('s1', settings));
    rooms.flush();
    const view = transport.last('s2', 'room:state');
    expect(view?.table).toEqual({ turnSeconds: 20, reactions: { matchOwn: true, matchOpponent: false }, powers: ['7', 'J'] });
    expect(view?.settings.turnMs).toBe(20_000);
    expect(view?.availablePowers).toEqual(['7', '8', '9', '10', 'J', 'Q', 'K']); // unchanged by turning powers off
    data(rooms.start('s1'));
    const rules = rooms.inspect('ROOM00')?.session?.internalState.rules;
    expect(rules?.timings.turnMs).toBe(20_000);
    expect(rules?.reactions).toMatchObject({ matchOwn: true, matchOpponent: false, attemptsPerWindow: 2 });
    expect(Object.keys(rules?.cards.powers ?? {}).sort()).toEqual(['7', 'J']);
    expect(rooms.inspect('ROOM00')?.session?.turnDeadline).toBeNull(); // still arranging; the clock starts with the turns
  });

  it('is refused while a game is running, and a rank with no power in the server rules is refused', () => {
    const { rooms } = lobby();
    expect(code(rooms.setTable('s1', { ...settings, powers: ['A'] }))).toBe('BAD_REQUEST');
    data(rooms.start('s1'));
    expect(code(rooms.setTable('s1', settings))).toBe('GAME_IN_PROGRESS');
  });

  it('does not change the server-wide rules (another room keeps the defaults)', () => {
    const { rooms, host } = lobby();
    data(rooms.setTable('s1', settings));
    expect(DEFAULT_RULES.timings.turnMs).toBe(15_000);
    expect(host.room.table.turnSeconds).toBe(15);
  });
});
