import { useLayoutEffect, useRef, type RefObject } from 'react';
import type { PlayerId, ServerGameEvent } from '@moises/shared';
import backUrl from '../assets/card-back.svg';
import { planFx, type FxStep } from '../game/fxPlan';
import { ghostCard, moveFrom } from './fx';

function anchors(root: ParentNode): Map<string, HTMLElement> {
  const map = new Map<string, HTMLElement>();
  for (const el of root.querySelectorAll<HTMLElement>('[data-anchor]')) {
    const key = el.dataset.anchor;
    if (key && !map.has(key)) map.set(key, el);
  }
  return map;
}

/** A hand with no card of its own (an opponent's) is the seat plaque. */
const fallback = (key: string): string | null => (key.startsWith('hand:') ? `seat:${key.slice(5)}` : null);

/**
 * Plays the animations for the public events of each new GameUpdate.
 * Before the screen changes it remembers where every anchored element was
 * (FLIP), so a card can be shown traveling from its old place to its new one.
 */
export function useTableFx(
  rootRef: RefObject<HTMLElement | null>,
  events: readonly ServerGameEvent[],
  seq: number,
  me: PlayerId | null,
): void {
  const rects = useRef(new Map<string, DOMRect>());
  const lastSeq = useRef<number | null>(null);

  // No dependency list on purpose: positions are refreshed after every render.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const now = anchors(root);
    if (lastSeq.current !== null && seq !== lastSeq.current && events.length > 0) {
      play(planFx(events, me), now);
    }
    lastSeq.current = seq;
    rects.current = new Map([...now].map(([key, el]) => [key, el.getBoundingClientRect()]));
  });

  function before(key: string): DOMRect | undefined {
    const fb = fallback(key);
    return rects.current.get(key) ?? (fb ? rects.current.get(fb) : undefined);
  }

  function play(steps: readonly FxStep[], now: Map<string, HTMLElement>) {
    // The last step for the same place wins (a card that moves twice in one update).
    const moved = new Set<string>();
    for (const step of [...steps].reverse()) {
      if (step.kind !== 'move' || moved.has(step.at)) continue;
      moved.add(step.at);
      const el = now.get(step.at) ?? (fallback(step.at) ? now.get(fallback(step.at) as string) : undefined);
      const from = before(step.from);
      if (el && from) moveFrom(el, from);
    }
    for (const step of steps) {
      if (step.kind === 'ghost') {
        const from = before(step.from);
        const to = now.get(step.to)?.getBoundingClientRect();
        if (from && to) ghostCard(backUrl, from, to);
      }
    }
  }

}
