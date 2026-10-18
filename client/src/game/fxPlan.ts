import type { PlayerId, ServerGameEvent } from '@moises/shared';

// Turns the public events of one GameUpdate into a list of animation steps.
// Pure and independent of the DOM. Animations are decoration: what is on the
// screen always comes from the GameView, never from here.
//
// Anchors name a place on the table:
//   deck | discard | slot:<playerId>:<n> | hand:<playerId> | seat:<playerId>
// (hand falls back to seat when the player has no visible hand card).

export type FxStep =
  /** The thing at `at` is already in place; show it arriving from where `from` was. */
  | { readonly kind: 'move'; readonly at: string; readonly from: string }
  /** A face-down card that has no element of its own flies between two anchors. */
  | { readonly kind: 'ghost'; readonly from: string; readonly to: string };
// Swaps between positions (cardsSwapped), peeks and reaction stamps are told
// one at a time by the narrator (game/narrate.ts, components/Narrator.tsx).

export const slotAnchor = (playerId: PlayerId, slot: number): string => `slot:${playerId}:${slot}`;
const handAnchor = (playerId: PlayerId): string => `hand:${playerId}`;

export function planFx(events: readonly ServerGameEvent[], me: PlayerId | null): FxStep[] {
  const steps: FxStep[] = [];
  const swap = (a: string, b: string) => {
    steps.push({ kind: 'move', at: a, from: b }, { kind: 'move', at: b, from: a });
  };
  for (const event of events) {
    switch (event.type) {
      case 'cardDrawn':
        if (event.playerId === me) steps.push({ kind: 'move', at: handAnchor(event.playerId), from: 'deck' });
        else steps.push({ kind: 'ghost', from: 'deck', to: `seat:${event.playerId}` });
        break;
      case 'drawnCardSwapped':
        steps.push({ kind: 'move', at: 'discard', from: slotAnchor(event.playerId, event.slot) });
        steps.push({ kind: 'move', at: slotAnchor(event.playerId, event.slot), from: handAnchor(event.playerId) });
        break;
      case 'drawnCardDiscarded':
        steps.push({ kind: 'move', at: 'discard', from: handAnchor(event.playerId) });
        break;
      case 'cardsArranged':
        swap(slotAnchor(event.playerId, event.toSlot), slotAnchor(event.playerId, event.fromSlot));
        break;
      case 'reactionSucceeded':
        if (event.reaction === 'matchOwn') {
          steps.push({ kind: 'move', at: 'discard', from: slotAnchor(event.playerId, event.slot) });
        } else {
          steps.push({ kind: 'move', at: 'discard', from: slotAnchor(event.target.playerId, event.target.slot) });
          steps.push({ kind: 'move', at: slotAnchor(event.target.playerId, event.target.slot), from: slotAnchor(event.playerId, event.giveSlot) });
        }
        break;
      default:
        break;
    }
  }
  return steps;
}
