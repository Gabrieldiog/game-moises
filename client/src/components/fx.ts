// Table animations with the Web Animations API: no library, short (150-400 ms),
// skipped when the player asks for less motion. They only decorate state that
// already changed: nothing here waits for an animation to finish.

export const FX_MS = { move: 280, flip: 220, ghost: 260 } as const;
const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

export function motionAllowed(): boolean {
  try {
    return typeof window !== 'undefined' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return true;
  }
}

function canAnimate(el: Element): el is HTMLElement {
  return motionAllowed() && typeof (el as HTMLElement).animate === 'function';
}

/** A card turning over: starts edge-on and opens. */
export function flipCard(el: HTMLElement): void {
  if (!canAnimate(el)) return;
  el.animate(
    [{ transform: 'perspective(500px) rotateY(88deg) scale(0.96)' }, { transform: 'perspective(500px) rotateY(0deg) scale(1)' }],
    { duration: FX_MS.flip, easing: EASE },
  );
}

/**
 * FLIP: `el` is already at its new place; make it travel there from where
 * `from` was (a rect taken before the screen changed).
 */
export function moveFrom(el: HTMLElement, from: DOMRect): void {
  if (!canAnimate(el)) return;
  const to = el.getBoundingClientRect();
  if (to.width === 0 || from.width === 0) return;
  const dx = from.left - to.left;
  const dy = from.top - to.top;
  const scale = from.width / to.width;
  if (Math.abs(dx) < 2 && Math.abs(dy) < 2 && Math.abs(scale - 1) < 0.03) return;
  el.style.zIndex = '30';
  const done = () => {
    el.style.zIndex = '';
  };
  const animation = el.animate(
    [
      { transformOrigin: 'top left', transform: `translate(${dx}px, ${dy}px) scale(${scale})` },
      { transformOrigin: 'top left', transform: 'translate(0, 0) scale(1)' },
    ],
    { duration: FX_MS.move, easing: EASE },
  );
  animation.onfinish = done;
  animation.oncancel = done;
}

/** A face-down card that flies between two places and vanishes (a card that has no element of its own, like an opponent's drawn card). */
export function ghostCard(backUrl: string, from: DOMRect, to: DOMRect): void {
  if (!motionAllowed() || typeof document === 'undefined' || from.width === 0 || to.width === 0) return;
  const img = document.createElement('img');
  img.src = backUrl;
  img.alt = '';
  img.setAttribute('aria-hidden', 'true');
  Object.assign(img.style, {
    position: 'fixed',
    left: `${from.left}px`,
    top: `${from.top}px`,
    width: `${from.width}px`,
    height: `${from.height}px`,
    borderRadius: '4px',
    pointerEvents: 'none',
    zIndex: '40',
    transformOrigin: 'top left',
    boxShadow: '0 6px 12px rgb(0 0 0 / 0.5)',
  });
  document.body.appendChild(img);
  if (typeof img.animate !== 'function') {
    img.remove();
    return;
  }
  // It shrinks to half from its top-left corner, so aim that corner's center-after-scale at the target's center.
  const dx = to.left + to.width / 2 - (from.left + from.width * 0.25);
  const dy = to.top + to.height / 2 - (from.top + from.height * 0.25);
  const animation = img.animate(
    [
      { transform: 'translate(0, 0) scale(1)', opacity: 1 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.5)`, opacity: 0.2 },
    ],
    { duration: FX_MS.ghost, easing: EASE },
  );
  animation.onfinish = () => img.remove();
  animation.oncancel = () => img.remove();
}

/**
 * Two positions swapped cards: both cards fly, face down, along crossing arcs
 * to the other place, leaving a short trail. The real cards (already in their
 * new places) are hidden during the flight. With reduced motion, the two
 * cards only fade out and back in.
 */
export function flySwap(backUrl: string, a: HTMLElement, b: HTMLElement, ms: number): void {
  if (typeof document === 'undefined') return;
  const ra = a.getBoundingClientRect();
  const rb = b.getBoundingClientRect();
  if (ra.width === 0 || rb.width === 0) return;
  if (!motionAllowed()) {
    for (const el of [a, b]) {
      if (typeof el.animate === 'function') {
        el.animate([{ opacity: 1 }, { opacity: 0.15 }, { opacity: 1 }], { duration: ms, easing: 'ease-in-out' });
      }
    }
    return;
  }
  const hidden = [a, b];
  for (const el of hidden) el.style.visibility = 'hidden';
  let pending = 0;
  const finish = () => {
    pending -= 1;
    if (pending <= 0) for (const el of hidden) el.style.visibility = '';
  };
  // Trail: the card itself plus fainter copies just behind it.
  const trail = [1, 0.42, 0.24, 0.12];
  for (const [from, to, side] of [
    [ra, rb, 1],
    [rb, ra, -1],
  ] as const) {
    const dx = to.left - from.left;
    const dy = to.top - from.top;
    const scale = to.width / from.width;
    // Lift each card sideways so the two paths cross as arcs instead of overlapping.
    const len = Math.max(1, Math.hypot(dx, dy));
    const lift = Math.min(90, len * 0.28) * side;
    const mx = dx / 2 + (-dy / len) * lift;
    const my = dy / 2 + (dx / len) * lift;
    trail.forEach((opacity, i) => {
      const img = document.createElement('img');
      img.src = backUrl;
      img.alt = '';
      img.setAttribute('aria-hidden', 'true');
      img.className = 'flying-card';
      Object.assign(img.style, {
        position: 'fixed',
        left: `${from.left}px`,
        top: `${from.top}px`,
        width: `${from.width}px`,
        height: `${from.height}px`,
        borderRadius: '5px',
        pointerEvents: 'none',
        zIndex: String(60 - i),
        transformOrigin: 'top left',
        opacity: String(opacity),
        boxShadow: i === 0 ? '0 0 0 3px var(--lambe-rosa), 0 14px 26px rgb(0 0 0 / 0.6)' : 'none',
      });
      document.body.appendChild(img);
      if (typeof img.animate !== 'function') {
        img.remove();
        return;
      }
      pending += 1;
      const mid = (1 + scale) / 2 + 0.18;
      const animation = img.animate(
        [
          { transform: 'translate(0, 0) scale(1) rotate(0deg)' },
          { transform: `translate(${mx}px, ${my}px) scale(${mid}) rotate(${side * 10}deg)`, offset: 0.5 },
          { transform: `translate(${dx}px, ${dy}px) scale(${scale}) rotate(0deg)` },
        ],
        { duration: ms, delay: i * 40, easing: 'cubic-bezier(0.3, 0.1, 0.25, 1)', fill: 'backwards' },
      );
      const done = () => {
        img.remove();
        finish();
      };
      animation.onfinish = done;
      animation.oncancel = done;
    });
  }
  if (pending === 0) for (const el of hidden) el.style.visibility = '';
}
