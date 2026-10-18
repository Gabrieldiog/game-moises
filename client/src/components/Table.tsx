import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Action, GameView, PlayerView, RoomView, ServerGameEvent } from '@moises/shared';
import { avatarLooks } from '../game/avatars';
import { useServerNow } from '../game/clock';
import { canPickOpponent, canPickOwn } from '../game/intent';
import {
  activeCountdown,
  findMe,
  hasTimedCards,
  opponentsInSeatOrder,
  reactionOffer,
  sameRef,
  seatAreas,
  serverDeadlinePassed,
  uiContext,
  type SeatArea,
} from '../game/selectors';
import { guideFor } from '../game/guide';
import { endCallLines, statusLines } from '../game/status';
import { useIntent } from '../game/useIntent';
import { T } from '../i18n/pt-BR';
import { ActionBar, CallEndButton } from './ActionBar';
import { sounds } from '../sound/sounds';
import { useCountdownTicks } from '../sound/useSound';
import { Countdown } from './Countdown';
import { cx } from './cx';
import { EndScreen } from './EndScreen';
import { Feed, FeedButton } from './Feed';
import { Narrator } from './Narrator';
import { Piles } from './Piles';
import { Seat } from './Seat';
import { SoundControl } from './SoundControl';
import { useNarration } from './useNarration';
import { useTableFx } from './useTableFx';
import { YouArea } from './YouArea';

export interface TableProps {
  readonly view: GameView;
  /** view.now - Date.now() when the view arrived. */
  /** Public events of the last update and a counter that changes with each update (animations only). */
  readonly events?: readonly ServerGameEvent[];
  readonly eventsSeq?: number;
  readonly clockOffset: number;
  readonly onSend: (action: Action) => void;
  readonly onLeave: () => void;
  /** GameUpdate.turnDeadline (server clock): time left for the current decision. */
  readonly turnDeadline?: number | null;
  /** The room around this game (table settings, bots, queue); null in tests or before it arrives. */
  readonly room?: RoomView | null;
  /** Closes the final screen and goes back to the room (the room stays open after a game). */
  readonly onBackToRoom?: () => void;
  /** Extra control in the status bar (the demo panel button). */
  readonly statusExtra?: ReactNode;
}

const NO_EVENTS: readonly ServerGameEvent[] = [];

export function Table({ view, events = NO_EVENTS, eventsSeq = 0, clockOffset, onSend, onLeave, turnDeadline = null, room = null, onBackToRoom, statusExtra }: TableProps) {
  const countdown = activeCountdown(view, turnDeadline);
  // Tick only while something on screen depends on the clock.
  const probe = Date.now() + clockOffset;
  const ticking = (countdown !== null && !serverDeadlinePassed(countdown.deadline, probe)) || hasTimedCards(view, probe);
  const now = useServerNow(clockOffset, ticking);

  const ctx = uiContext(view, now);
  const intent = useIntent(view, ctx, onSend);
  const me = findMe(view);
  const rootRef = useRef<HTMLElement | null>(null);
  useTableFx(rootRef, events, eventsSeq, view.you);
  const narration = useNarration(events, eventsSeq, view);
  const offer = reactionOffer(view, now);
  useEffect(() => sounds().preload(), []);

  // Tick-tock over the last seconds of a countdown that is yours to beat.
  const mine =
    countdown !== null &&
    (countdown.kind === 'claim' ||
      (countdown.kind === 'reaction' && offer?.canShout === true) ||
      (countdown.kind === 'turn' && view.turn?.playerId === view.you && view.you !== null));
  useCountdownTicks(mine ? countdown.deadline : null, now);

  // History: closed by default; the badge counts lines that arrived while closed.
  const [feedOpen, setFeedOpen] = useState(false);
  const [seenId, setSeenId] = useState(0);
  const newest = narration.feed[0]?.id ?? 0;
  if (feedOpen && seenId !== newest) setSeenId(newest);
  const unseen = feedOpen ? 0 : narration.feed.filter((e) => e.id > seenId).length;
  const closeFeed = useCallback(() => setFeedOpen(false), []);
  const tools = (
    <div className="tools">
      <FeedButton unseen={unseen} open={feedOpen} onToggle={() => setFeedOpen((v) => !v)} />
      <SoundControl />
    </div>
  );
  const looks = useMemo(() => avatarLooks(view.players.map((p) => p.id)), [view.players]);
  const opponents = opponentsInSeatOrder(view);
  const areas = seatAreas(opponents.length);
  const status = statusLines(view, ctx, intent.picks);
  const endCall = endCallLines(view);

  const bots = new Set(room?.members.filter((m) => m.isBot).map((m) => m.id) ?? []);
  const queued = room !== null && room.queue.some((q) => q.id === room.you);

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
        look={looks.get(player.id)}
        isBot={bots.has(player.id)}
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
      ref={rootRef}
      className={cx('table', `table--${status.tone}`, (intent.policy.own > 0 || intent.policy.opponents > 0) && 'is-picking', ctx.kind === 'claim' && 'is-claiming', guideFor(view, ctx, intent.picks) !== null && 'is-guided', endCall !== null && 'has-endcall')}
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
            label={T.countdown[countdown.kind]}
            tone={countdown.kind === 'reaction' || countdown.kind === 'claim' || countdown.kind === 'claimOther' ? 'hot' : 'calm'}
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

      {queued && view.phase !== 'ended' && (
        <p className="queuebar" role="status">
          {T.queueBanner}
        </p>
      )}

      <div className="room">
        <div className="rail">
          <div className="felt">
            <div className="felt__top">{seatsIn('top')}</div>
            <div className="felt__middle">
              <div className="felt__side">{left}</div>
              <Piles view={view} onDraw={ctx.kind === 'myDraw' ? () => intent.dispatch({ type: 'draw' }) : null} />
              <div className="felt__side">{right}</div>
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
                look={looks.get(me.id)}
                beside={<CallEndButton view={view} onSend={intent.dispatch} />}
                tools={tools}
              />
            ) : (
              <div className="felt__spectator-row">
                <p className="felt__spectator">{T.spectating}</p>
                {tools}
              </div>
            )}
          </div>
        </div>
      </div>

      <ActionBar
        view={view}
        ctx={ctx}
        picks={intent.picks}
        offer={offer}
        claiming={intent.claiming}
        onSend={intent.dispatch}
        onShout={intent.pressShout}
        onRestart={intent.cancel}
        {...(room ? { reactions: room.table.reactions } : {})}
      />

      <Narrator rootRef={rootRef} shown={narration.beat} view={view} />
      <Feed entries={narration.feed} open={feedOpen} onClose={closeFeed} />

      {view.phase === 'ended' && (
        <EndScreen view={view} onLeave={onLeave} {...(onBackToRoom ? { onBackToRoom } : {})} />
      )}
    </main>
  );
}
