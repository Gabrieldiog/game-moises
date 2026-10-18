import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';
import type { GameView, SlotRef } from '@moises/shared';
import backUrl from '../assets/card-back.svg';
import { slotAnchor } from '../game/fxPlan';
import { shoutText, type Beat } from '../game/narrate';
import { playerName } from '../game/selectors';
import { SAY, T } from '../i18n/pt-BR';
import { SWAP_FLIGHT_MS } from '../ui/constants';
import { cx } from './cx';
import { flySwap } from './fx';
import { Icon } from './Icon';
import type { ShownBeat } from './useNarration';

export interface NarratorProps {
  readonly rootRef: RefObject<HTMLElement | null>;
  readonly shown: ShownBeat | null;
  readonly view: GameView;
}

interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

interface Layout {
  readonly id: number;
  readonly rings: readonly Box[];
  readonly eye: Box | null;
  /** Balloon anchor: x center, y edge, and whether it opens downwards. */
  readonly balloon: { readonly x: number; readonly y: number; readonly down: boolean } | null;
  readonly width: number;
}

function find(root: HTMLElement, key: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[data-anchor="${key.replace(/["\\]/g, '')}"]`);
}

function boxOf(root: HTMLElement, el: Element): Box {
  // A card may be in the middle of a move animation (transformed): measure its grid cell instead.
  const r = (el.closest('.grid__cell') ?? el).getBoundingClientRect();
  const o = root.getBoundingClientRect();
  return { left: r.left - o.left, top: r.top - o.top, width: r.width, height: r.height };
}

function focusOf(beat: Beat): readonly SlotRef[] {
  switch (beat.kind) {
    case 'peek':
      return [beat.target];
    case 'swap':
      return [beat.a, beat.b];
    case 'resolve':
      return beat.slots;
    case 'note':
      return beat.focus;
    case 'claim':
      return [];
  }
}

const style = (box: Box): CSSProperties => ({ left: box.left, top: box.top, width: box.width, height: box.height });

/**
 * Tells what the server just did, one thing at a time, right where it
 * happened: a balloon at the player who did it, rings on the positions it
 * touched, an eye over a card being looked at, two cards flying when
 * positions swap, and the shout stamped on the felt.
 */
export function Narrator({ rootRef, shown, view }: NarratorProps) {
  const [layout, setLayout] = useState<Layout | null>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!shown || !root) {
      setLayout(null);
      return;
    }
    const { beat } = shown;
    const rings = focusOf(beat)
      .map((ref) => find(root, slotAnchor(ref.playerId, ref.slot)))
      .filter((el): el is HTMLElement => el !== null)
      .map((el) => boxOf(root, el));
    const eyeEl = beat.kind === 'peek' ? find(root, slotAnchor(beat.target.playerId, beat.target.slot)) : null;
    const actor = 'by' in beat && beat.by !== null ? find(root, `seat:${beat.by}`) : null;
    const width = root.clientWidth;
    let balloon: Layout['balloon'] = null;
    if (actor) {
      // The whole seat (name and cards), so the balloon never hides the cards it talks about.
      const box = boxOf(root, actor.closest('.seat, .me') ?? actor);
      const down = box.top + box.height / 2 < root.clientHeight / 2;
      balloon = { x: box.left + box.width / 2, y: down ? box.top + box.height + 6 : box.top - 6, down };
    }
    setLayout({ id: shown.id, rings, eye: eyeEl ? boxOf(root, eyeEl) : null, balloon, width });

    if (beat.kind === 'swap') {
      const a = find(root, slotAnchor(beat.a.playerId, beat.a.slot));
      const b = find(root, slotAnchor(beat.b.playerId, beat.b.slot));
      if (a && b) flySwap(backUrl, a, b, SWAP_FLIGHT_MS);
    }
  }, [shown, rootRef]);

  if (!shown || !layout || layout.id !== shown.id) return null;
  const { beat } = shown;
  const tone = beat.kind === 'resolve' ? (beat.ok ? 'ok' : 'miss') : beat.kind;
  const half = Math.min(150, layout.width / 2 - 8);
  const balloonX = layout.balloon ? Math.min(Math.max(layout.balloon.x, half + 8), layout.width - half - 8) : layout.width / 2;
  const by = 'by' in beat && beat.by !== null ? beat.by : null;

  return (
    <>
    <p className="sr-only" role="status">{beat.text}</p>
    <div className="narrator" style={{ '--beat-ms': `${shown.ms}ms` } as CSSProperties} aria-hidden="true">
      {layout.rings.map((box, i) => (
        <span key={i} className={cx('narrator__ring', `narrator__ring--${tone}`)} style={style(box)} />
      ))}
      {layout.eye && (
        <span className="narrator__eye" style={style(layout.eye)}>
          <svg viewBox="0 0 48 30" className="narrator__eye-svg">
            <path className="narrator__eye-white" d="M2 15C8 5 16 2 24 2s16 3 22 13c-6 10-14 13-22 13S8 25 2 15Z" />
            <circle className="narrator__eye-iris" cx="24" cy="15" r="8" />
            <circle className="narrator__eye-pupil" cx="24" cy="15" r="3.6" />
          </svg>
        </span>
      )}
      {((beat.kind === 'claim' && beat.by !== view.you) || beat.kind === 'resolve') && (
        <div
          key={shown.id}
          className={cx('stamp', beat.kind === 'claim' || beat.ok ? 'stamp--ok' : 'stamp--miss', beat.kind === 'claim' && 'stamp--claim')}
          role="presentation"
        >
          <span className="stamp__text">
            {beat.kind === 'claim' ? shoutText(beat.reaction) : beat.ok ? SAY.stampHit : T.stampMiss}
          </span>
          <span className="stamp__who">
            {by === view.you ? T.you : by ? playerName(view, by) : ''}
            {beat.kind === 'claim' ? ` ${SAY.stampChoosing}` : ''}
          </span>
        </div>
      )}
      {beat.kind !== 'claim' && (
        <p
          className={cx('balloon', `balloon--${tone}`, layout.balloon?.down === false && 'balloon--up', !layout.balloon && 'balloon--center')}
          style={layout.balloon ? { left: balloonX, top: layout.balloon.y } : { left: balloonX }}
        >
          <Icon
            name={beat.kind === 'peek' ? 'eye' : beat.kind === 'swap' ? 'swap' : beat.kind === 'resolve' ? (beat.ok ? 'hit' : 'miss') : 'power'}
            size={18}
            className="balloon__icon"
          />
          <span>{beat.text}</span>
        </p>
      )}
    </div>
    </>
  );
}
