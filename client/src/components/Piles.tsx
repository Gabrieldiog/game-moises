import type { CSSProperties } from 'react';
import type { GameView } from '@moises/shared';
import backUrl from '../assets/card-back.svg';
import { T } from '../i18n/pt-BR';
import { CardView } from './CardView';
import { cx } from './cx';

export interface PilesProps {
  readonly view: GameView;
  /** Tapping the deck draws (only offered when it is your draw step). */
  readonly onDraw: (() => void) | null;
}

/** Draw pile and discard pile in the middle of the table. */
export function Piles({ view, onDraw }: PilesProps) {
  const count = view.drawPileCount;
  const reactionCard = view.reactionWindow?.card ?? null;
  const top = reactionCard ?? view.discardTop;
  const deckLabel = `${T.deck}: ${T.deckCount(count)}`;
  const layers = Math.min(3, count);

  const stack = (
    <>
      {layers === 0 ? (
        <span className="deck__empty" aria-hidden="true" />
      ) : (
        Array.from({ length: layers }, (_, i) => (
          <img key={i} className="deck__layer" style={{ '--layer': layers - 1 - i } as CSSProperties} src={backUrl} alt="" draggable={false} />
        ))
      )}
      <span className="pile__count" aria-hidden="true">
        {count}
      </span>
    </>
  );

  return (
    <div className="piles">
      <div className="pile">
        {onDraw ? (
          <button type="button" className="deck is-actionable" aria-label={`${deckLabel}. ${T.draw}`} onClick={onDraw}>
            {stack}
          </button>
        ) : (
          <div className="deck" role="img" aria-label={deckLabel}>
            {stack}
          </div>
        )}
        <span className="pile__label" aria-hidden="true">
          {T.deck}
        </span>
      </div>
      <div className={cx('pile', reactionCard && 'pile--reaction')}>
        <CardView
          slot={top ? { state: 'visible', card: top, until: null } : { state: 'empty' }}
          size="pile"
          label={top ? `${T.discard} (${T.discardCount(view.discardCount)})` : T.discardEmpty}
          accent={reactionCard ? 'reaction' : null}
        />
        <span className="pile__label" aria-hidden="true">
          {T.discard}
        </span>
      </div>
    </div>
  );
}
