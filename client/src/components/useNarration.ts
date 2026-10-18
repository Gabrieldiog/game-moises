import { useEffect, useRef, useState } from 'react';
import type { GameView, ServerGameEvent } from '@moises/shared';
import { beatSound, narrate, type Beat, type FeedLine } from '../game/narrate';
import { sounds } from '../sound/sounds';
import { BEAT_MS, BEAT_MS_BUSY, BEAT_MS_SWAP, FEED_MAX } from '../ui/constants';

export interface FeedEntry extends FeedLine {
  readonly id: number;
}

export interface ShownBeat {
  readonly id: number;
  readonly beat: Beat;
  readonly ms: number;
}

export interface Narration {
  /** What the table is telling right now (one at a time), or null. */
  readonly beat: ShownBeat | null;
  /** History, newest first. */
  readonly feed: readonly FeedEntry[];
}

/**
 * Narrates each GameUpdate: history lines at once, beats one after the other
 * (about a second each, shorter when they pile up) so nothing runs over
 * anything else.
 */
export function useNarration(events: readonly ServerGameEvent[], seq: number, view: GameView): Narration {
  const [feed, setFeed] = useState<readonly FeedEntry[]>([]);
  const [beat, setBeat] = useState<ShownBeat | null>(null);
  const queue = useRef<Beat[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSeq = useRef<number | null>(null);
  const ids = useRef(0);
  const viewRef = useRef(view);
  viewRef.current = view;

  const next = () => {
    timer.current = null;
    const upcoming = queue.current.shift();
    if (!upcoming) {
      setBeat(null);
      return;
    }
    const base = upcoming.kind === 'swap' ? BEAT_MS_SWAP : BEAT_MS;
    const ms = queue.current.length >= 2 ? Math.min(base, BEAT_MS_BUSY) : base;
    ids.current += 1;
    setBeat({ id: ids.current, beat: upcoming, ms });
    const sound = beatSound(upcoming);
    if (sound) sounds().play(sound);
    timer.current = setTimeout(next, ms);
  };

  useEffect(() => {
    if (lastSeq.current === seq) return;
    const first = lastSeq.current === null;
    lastSeq.current = seq;
    // The first update after mounting is a snapshot: nothing to tell.
    if (first || events.length === 0) return;
    const told = narrate(events, viewRef.current);
    if (told.lines.length > 0) {
      setFeed((old) => {
        const added = told.lines.map((l) => {
          ids.current += 1;
          return { ...l, id: ids.current };
        });
        return [...added.reverse(), ...old].slice(0, FEED_MAX);
      });
    }
    for (const sound of told.sounds) sounds().play(sound);
    if (told.beats.length > 0) {
      queue.current.push(...told.beats);
      if (timer.current === null) next();
    }
  }, [seq, events]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    },
    [],
  );

  return { beat, feed };
}
