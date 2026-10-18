import type { ReactNode } from 'react';
import type { Action, GameView, PlayerView } from '@moises/shared';
import { useServerNow } from '../game/clock';
import { canPickOpponent, canPickOwn } from '../game/intent';
import {
  activeCountdown,
  findMe,
  hasTimedCards,
  opponentsInSeatOrder,
  sameRef,
  seatAreas,
  serverDeadlinePassed,
  uiContext,
  type SeatArea,
} from '../game/selectors';
import { endCallLines, statusLines } from '../game/status';
import { useIntent } from '../game/useIntent';
import { T } from '../i18n/pt-BR';
import { ActionBar, CallEndButton } from './ActionBar';
import { Countdown } from './Countdown';
import { cx } from './cx';
import { EndScreen } from './EndScreen';
import { Piles } from './Piles';
import { Seat } from './Seat';
import { YouArea } from './YouArea';

export interface TableProps {
  readonly view: GameView;
  /** view.now - Date.now() when the view arrived. */
  readonly clockOffset: number;
  readonly onSend: (action: Action) => void;
  readonly onLeave: () => void;
  /** Extra control in the status bar (the demo panel button). */
  readonly statusExtra?: ReactNode;
}

const COUNTDOWN_LABEL = { arrange: 'Arrumação', initialPeek: 'Espiada', reaction: 'Reação' } as const;

export function Table({ view, clockOffset, onSend, onLeave, statusExtra }: TableProps) {
  const countdown = activeCountdown(view);
  // Tick only while something on screen depends on the clock.
  const probe = Date.now() + clockOffset;
  const ticking = (countdown !== null && !serverDeadlinePassed(countdown.deadline, probe)) || hasTimedCards(view, probe);
  const now = useServerNow(clockOffset, ticking);

  const ctx = uiContext(view, now);
  const intent = useIntent(view, ctx, onSend);
  const me = findMe(view);
  const opponents = opponentsInSeatOrder(view);
  const areas = seatAreas(opponents.length);
  const status = statusLines(view, ctx, intent.picks);
  const endCall = endCallLines(view);

  const seatsIn = (area: SeatArea) =>
    opponents.flatMap((player, i) => (areas[i] === area ? [renderSeat(player, area)] : []));

  function renderSeat(player: PlayerView, area: SeatArea) {
    return (
      <Seat
        key={player.id}
        view={view}
        player={player}
        now={now}
        area={area}
        isSelectable={(slot) => canPickOpponent(intent.policy, player, slot)}
        isSelected={(slot) => intent.picks.opponents.some((ref) => sameRef(ref, { playerId: player.id, slot }))}
        onSelect={(slot) => intent.pickOpponent({ playerId: player.id, slot })}
      />
    );
  }

  const left = seatsIn('left');
  const right = seatsIn('right');

  return (
    <main
      className={cx('table', `table--${status.tone}`, (intent.policy.own > 0 || intent.policy.opponents > 0) && 'is-picking')}
      data-opponents={opponents.length}
      data-sides={left.length + right.length > 0 ? 'yes' : 'no'}
    >
      <header className={cx('status', `status--${status.tone}`)}>
        <div className="status__text" aria-live="polite">
          <h1 className="status__title">{status.title}</h1>
          {status.hint && <p className="status__hint">{status.hint}</p>}
        </div>
        {countdown && (
          <Countdown
            deadline={countdown.deadline}
            now={now}
            label={COUNTDOWN_LABEL[countdown.kind]}
            tone={countdown.kind === 'reaction' ? 'hot' : 'calm'}
          />
        )}
        {statusExtra}
      </header>

      {endCall && (
        <div className="endcall" role="status">
          <strong className="endcall__title">{endCall.title}</strong>
          {endCall.hint && <span className="endcall__hint">{endCall.hint}</span>}
        </div>
      )}

      <div className="table__felt">
        <div className="table__top">{seatsIn('top')}</div>
        <div className="table__middle">
          <div className="table__side">{left}</div>
          <Piles view={view} onDraw={ctx.kind === 'myDraw' ? () => intent.dispatch({ type: 'draw' }) : null} />
          <div className="table__side">{right}</div>
        </div>
        {me ? (
          <YouArea
            view={view}
            me={me}
            now={now}
            drawn={view.turn?.playerId === me.id ? view.turn.drawnCard : null}
            isSelectable={(slot) => canPickOwn(intent.policy, me, slot)}
            isSelected={(slot) => intent.picks.own.includes(slot)}
            onSelect={intent.pickOwn}
            beside={<CallEndButton view={view} ctx={ctx} onSend={intent.dispatch} />}
          />
        ) : (
          <p className="table__spectator">{T.spectating}</p>
        )}
      </div>

      <ActionBar
        ctx={ctx}
        picks={intent.picks}
        shout={intent.shout}
        onSend={intent.dispatch}
        onShout={intent.pressShout}
        onCancel={intent.cancel}
      />

      {view.phase === 'ended' && <EndScreen view={view} onLeave={onLeave} />}
    </main>
  );
}
