import { describe, expect, it } from 'vitest';
import type { ServerGameEvent } from '@moises/shared';
import { avatarLooks, AVATAR_COLORS } from './avatars';
import { planFx } from './fxPlan';

const card = { kind: 'standard', rank: '5', suit: 'hearts' } as const;

describe('planFx', () => {
  it('draw: my card comes from the deck, an opponent gets a ghost card', () => {
    expect(planFx([{ type: 'cardDrawn', playerId: 'me' }], 'me')).toEqual([{ kind: 'move', at: 'hand:me', from: 'deck' }]);
    expect(planFx([{ type: 'cardDrawn', playerId: 'bot' }], 'me')).toEqual([{ kind: 'ghost', from: 'deck', to: 'seat:bot' }]);
  });

  it('swap with the drawn card: slot -> discard, hand -> slot', () => {
    const steps = planFx([{ type: 'drawnCardSwapped', playerId: 'a', slot: 2, discarded: card }], 'me');
    expect(steps).toEqual([
      { kind: 'move', at: 'discard', from: 'slot:a:2' },
      { kind: 'move', at: 'slot:a:2', from: 'hand:a' },
    ]);
  });

  it('power swap exchanges the two positions, whoever owns them', () => {
    const steps = planFx([{ type: 'powerSwapped', playerId: 'a', ownSlot: 0, target: { playerId: 'b', slot: 3 } }], 'me');
    expect(steps).toEqual([
      { kind: 'move', at: 'slot:a:0', from: 'slot:b:3' },
      { kind: 'move', at: 'slot:b:3', from: 'slot:a:0' },
    ]);
  });

  it('reactions stamp the table; a wrong one moves nothing', () => {
    const wrong: ServerGameEvent = { type: 'reactionFailed', reaction: 'matchOwn', playerId: 'a', slot: 1, revealed: card };
    expect(planFx([wrong], 'me')).toEqual([{ kind: 'stamp', ok: false, reaction: 'matchOwn', playerId: 'a' }]);
    const right: ServerGameEvent = { type: 'reactionSucceeded', reaction: 'matchOwn', playerId: 'a', slot: 1, card };
    expect(planFx([right], 'me')).toEqual([
      { kind: 'move', at: 'discard', from: 'slot:a:1' },
      { kind: 'stamp', ok: true, reaction: 'matchOwn', playerId: 'a' },
    ]);
  });

  it('ignores events with nothing to animate', () => {
    expect(planFx([{ type: 'turnStarted', playerId: 'a', turnNumber: 1 }], 'me')).toEqual([]);
  });
});

describe('avatarLooks', () => {
  const ids = ['bot-1', 'bot-2', 'bot-3', 'me-xyz', 'bot-4', 'bot-5'];

  it('is deterministic and gives everyone at the table a different color', () => {
    const a = avatarLooks(ids);
    const b = avatarLooks(ids);
    expect([...a]).toEqual([...b]);
    expect(new Set([...a.values()].map((l) => l.color)).size).toBe(ids.length);
    for (const look of a.values()) expect(look.color).toBeLessThan(AVATAR_COLORS);
  });
});
