import type { ReactNode } from 'react';
import type { Card, GameView, PlayerView } from '@moises/shared';
import { T } from '../i18n/pt-BR';
import { CardView } from './CardView';
import { cx } from './cx';
import { Avatar } from './Avatar';
import { Grid } from './Grid';

export interface YouAreaProps {
  readonly view: GameView;
  readonly me: PlayerView;
  readonly now: number;
  /** The card you drew and are holding (only you receive it). */
  readonly drawn: Card | null;
  readonly isSelectable: (slot: number) => boolean;
  readonly isSelected: (slot: number) => boolean;
  readonly onSelect: (slot: number) => void;
  /** Shown on the left of your grid ("Estou foda"). */
  readonly beside?: ReactNode;
}

/** Your seat at the bottom: the big grid and the card in your hand. */
export function YouArea({ view, me, now, drawn, isSelectable, isSelected, onSelect, beside }: YouAreaProps) {
  const isTurn = view.phase === 'playing' && view.turn?.playerId === me.id;
  const called = view.endCall?.callerId === me.id;
  const lastTurn = view.endCall?.pending.includes(me.id) === true;

  return (
    <section className={cx('me', isTurn && 'is-turn')} aria-label="Suas cartas">
      <div className="me__head">
        <div className="seat__tag me__tag">
          <Avatar name={me.name} index={view.players.findIndex((p) => p.id === me.id)} />
          <span className="seat__name">{T.you}</span>
        </div>
        {called && <span className="chip chip--end">{T.callEnd}</span>}
        {!called && lastTurn && <span className="chip chip--last">{T.finalTurnPending}</span>}
      </div>
      <div className="me__table">
        <div className="me__beside">{beside}</div>
        <Grid
          player={me}
          now={now}
          size="you"
          label="Sua grade"
          slotLabel={T.ownSlotLabel}
          isSelectable={isSelectable}
          isSelected={isSelected}
          onSelect={onSelect}
          numbered
        />
        <div className="me__hand">
          {drawn && (
            <>
              <CardView slot={{ state: 'visible', card: drawn, until: null }} size="hand" label={T.yourCard} />
              <span className="me__hand-label">{T.yourCard}</span>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
