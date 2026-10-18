import { useEffect, useRef, useSyncExternalStore } from 'react';
import { sounds, tickInterval, type SoundSettings } from './sounds';

export function useSoundSettings(): SoundSettings {
  const board = sounds();
  return useSyncExternalStore(board.subscribe, board.getSettings, board.getSettings);
}

/**
 * Tick-tock over the last seconds of `deadline` (server clock), speeding up
 * at the end. `now` must move (the table re-renders while a countdown runs).
 */
export function useCountdownTicks(deadline: number | null, now: number): void {
  const last = useRef<{ deadline: number; at: number; n: number } | null>(null);
  useEffect(() => {
    if (deadline === null) {
      last.current = null;
      return;
    }
    const remaining = deadline - now;
    const gap = tickInterval(remaining);
    if (gap === null) return;
    const prev = last.current;
    if (prev && prev.deadline === deadline && prev.at - remaining < gap - 60) return;
    const n = prev && prev.deadline === deadline ? prev.n + 1 : 0;
    last.current = { deadline, at: remaining, n };
    sounds().play(n % 2 === 0 ? 'tick' : 'tock', { rate: remaining <= 1_500 ? 1.15 : 1, gain: remaining <= 1_500 ? 1 : 0.8 });
  }, [deadline, now]);
}
