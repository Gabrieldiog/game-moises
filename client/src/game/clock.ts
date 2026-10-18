import { useEffect, useReducer } from 'react';
import { CLOCK_TICK_MS } from '../ui/constants';

// The server clock is the only clock that matters. When a view arrives we keep
// offset = view.now - Date.now(); "server now" is then Date.now() + offset.

export function clockOffset(viewNow: number, localNow: number = Date.now()): number {
  return viewNow - localNow;
}

export function serverNow(offset: number, localNow: number = Date.now()): number {
  return localNow + offset;
}

/** Whole seconds left until `deadline`, never negative. */
export function secondsLeft(deadline: number, now: number): number {
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

/**
 * Current server time. While `active`, re-renders every CLOCK_TICK_MS so
 * countdowns move and timed cards turn face down on time.
 */
export function useServerNow(offset: number, active: boolean): number {
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(tick, CLOCK_TICK_MS);
    return () => clearInterval(id);
  }, [active]);
  return serverNow(offset);
}
