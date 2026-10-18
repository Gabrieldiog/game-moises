import { describe, expect, it } from 'vitest';
import type { ServerGameEvent } from '@moises/shared';
import { buildScenario } from '../demo/fixtures';
import { tickInterval } from '../sound/sounds';
import { guideFor } from './guide';
import { NO_PICKS } from './intent';
import { beatSound, narrate } from './narrate';
import { uiContext } from './selectors';

const NOW = 1_000;
// s0 = you (Gi), s1 = Ana, s2 = Beto
const view = buildScenario('vez-de-outro', { players: 3, now: NOW });
const five = { kind: 'standard', rank: '5', suit: 'hearts' } as const;

describe('narrate', () => {
  it('peeks: an eye beat and a line naming whose card', () => {
    const told = narrate([{ type: 'cardPeeked', by: 's1', target: { playerId: 's0', slot: 2 } }], view);
    expect(told.lines).toEqual([{ icon: 'eye', text: 'Ana olhou a sua carta 3', tone: 'mine' }]);
    expect(told.beats).toEqual([{ kind: 'peek', by: 's1', target: { playerId: 's0', slot: 2 }, text: 'Ana olhou a sua carta 3' }]);
    expect(beatSound(told.beats[0]!)).toBe('flip');
  });

  it('swaps: a flying beat; the power summary is left out when details exist', () => {
    const events: ServerGameEvent[] = [
      { type: 'powerUsed', by: 's2', power: 'blindSwap', ownSlot: 0, targets: [{ playerId: 's1', slot: 3 }] },
      { type: 'cardsSwapped', by: 's2', a: { playerId: 's2', slot: 0 }, b: { playerId: 's1', slot: 3 }, blind: true },
    ];
    const told = narrate(events, view);
    expect(told.lines.map((l) => l.text)).toEqual(['Beto trocou no escuro a própria carta 1 com a carta 4 de Ana']);
    expect(told.beats[0]).toMatchObject({ kind: 'swap', blind: true });
  });

  it('a claim, then its verdict with the positions; the detailed verdict line wins', () => {
    const events: ServerGameEvent[] = [
      { type: 'reactionClaimed', by: 's1', kind: 'matchOpponent' },
      { type: 'reactionFailed', reaction: 'matchOpponent', playerId: 's1', target: { playerId: 's0', slot: 1 }, giveSlot: 2, revealed: five },
      { type: 'reactionResolved', by: 's1', kind: 'matchOpponent', ok: false, slots: [{ playerId: 's0', slot: 1 }, { playerId: 's1', slot: 2 }] },
    ];
    const told = narrate(events, view);
    expect(told.lines.map((l) => l.text)).toEqual(['Ana gritou Filho da puta!', 'Ana errou e mostrou 5♥ para todos']);
    expect(told.beats.map((b) => b.kind)).toEqual(['claim', 'resolve']);
    expect(told.beats[1]).toMatchObject({ ok: false, slots: [{ playerId: 's0', slot: 1 }, { playerId: 's1', slot: 2 }] });
    expect(told.beats.map(beatSound)).toEqual(['shout', 'miss']);
  });

  it('an expired claim says nothing changed', () => {
    const told = narrate([{ type: 'reactionResolved', by: 's2', kind: 'matchOwn', ok: false, slots: [] }], view);
    expect(told.lines[0]?.text).toBe('O tempo de quem gritou acabou: nada mudou');
  });

  it('your turn rings the bell; draws and discards have their sounds', () => {
    const told = narrate(
      [
        { type: 'turnStarted', playerId: 's0', turnNumber: 9 },
        { type: 'cardDrawn', playerId: 's0' },
        { type: 'drawnCardDiscarded', playerId: 's0', card: five },
      ],
      view,
    );
    expect(told.sounds).toEqual(['turn', 'draw', 'discard']);
    expect(told.lines.map((l) => l.text)).toEqual(['Sua vez', 'Você comprou uma carta', 'Você descartou 5♥']);
    expect(told.beats).toEqual([]);
  });

  it('a skipped power gets a balloon for the others', () => {
    const told = narrate([{ type: 'powerSkipped', by: 's1', power: 'peekOpponent', reason: 'player' }], view);
    expect(told.beats[0]).toMatchObject({ kind: 'note', text: 'Ana não usou o poder (ver carta de um inimigo)' });
  });
});

describe('guide', () => {
  it('Q: three steps, the current one follows the picks', () => {
    const q = buildScenario('poder-q', { players: 3, now: NOW });
    const ctx = uiContext(q, NOW);
    const now = (picks = NO_PICKS) => guideFor(q, ctx, picks)?.steps.findIndex((s) => s.state === 'now');
    expect(guideFor(q, ctx, NO_PICKS)?.title).toBe('Poder do Q♥: trocar no escuro');
    expect(now()).toBe(0);
    expect(now({ own: [1], opponents: [] })).toBe(1);
    expect(now({ own: [1], opponents: [{ playerId: 's1', slot: 0 }] })).toBe(2);
  });

  it('nothing to guide on a plain draw', () => {
    const v = buildScenario('minha-vez', { players: 3, now: NOW });
    expect(guideFor(v, uiContext(v, NOW), NO_PICKS)).toBeNull();
  });
});

describe('tick-tock', () => {
  it('is silent until 5 s and speeds up at the end', () => {
    expect(tickInterval(6_000)).toBeNull();
    expect(tickInterval(4_200)).toBe(1_000);
    expect(tickInterval(2_000)).toBe(500);
    expect(tickInterval(900)).toBe(250);
    expect(tickInterval(0)).toBeNull();
  });
});
