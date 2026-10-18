import { describe, expect, it } from 'vitest';
import type { Card } from '@moises/shared';
import { buildScenario, DEMO_PLAYER_COUNTS, SCENARIOS } from './fixtures';

// The fixtures stand in for the server, so they must look like real views.

const key = (card: Card) => (card.kind === 'joker' ? `joker-${card.color}` : `${card.rank}${card.suit}`);

describe('demo fixtures', () => {
  for (const { id } of SCENARIOS) {
    for (const players of DEMO_PLAYER_COUNTS) {
      it(`${id} with ${players} players is a coherent view`, () => {
        const view = buildScenario(id, { players, now: 1_000 });
        expect(view.players).toHaveLength(players);
        expect(view.players.filter((p) => p.isYou).map((p) => p.id)).toEqual([view.you]);
        for (const p of view.players) {
          expect(p.cardCount).toBe(p.slots.filter((s) => s.state !== 'empty').length);
        }
        // No card face appears twice in the grids (54 distinct faces).
        const faces = view.players.flatMap((p) => p.slots.flatMap((s) => (s.state === 'visible' ? [key(s.card)] : [])));
        expect(new Set(faces).size).toBe(faces.length);
        // The drawn card is only ever yours.
        if (view.turn?.drawnCard) expect(view.turn.playerId).toBe(view.you);
        if (view.phase === 'ended') {
          expect(view.result?.scores).toHaveLength(players);
          expect(view.result?.winners.length).toBeGreaterThan(0);
        }
      });
    }
  }
});
