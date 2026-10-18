import { useEffect, useRef } from 'react';
import type { GameView } from '@moises/shared';
import { T } from '../i18n/pt-BR';
import { cx } from './cx';
import { Grid } from './Grid';

export interface EndScreenProps {
  readonly view: GameView;
  readonly onLeave: () => void;
}

/** "−1" with a real minus sign. Totals come from the server as they are. */
export function formatTotal(total: number): string {
  return total < 0 ? `−${Math.abs(total)}` : String(total);
}

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`;
}

/**
 * Final screen: every card face up, each total and the winner(s), all taken
 * from view.result. Nothing is added up here.
 */
export function EndScreen({ view, onLeave }: EndScreenProps) {
  const result = view.result;
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);
  if (!result) return null;

  const byId = new Map(view.players.map((p) => [p.id, p]));
  const display = (id: string) => (id === view.you ? T.you : (byId.get(id)?.name ?? id));
  const winners = new Set(result.winners);
  // Lowest total first (just ordering the server's totals for reading).
  const rows = [...result.scores].sort((a, b) => a.total - b.total);

  const headline =
    result.winners.length === 1
      ? result.winners[0] === view.you
        ? T.winnerYou
        : T.winnerOne(display(result.winners[0] ?? ''))
      : T.winnersTie(joinNames(result.winners.map(display)));

  return (
    <div className="end" role="dialog" aria-modal="true" aria-labelledby="end-title">
      <div className="end__sheet">
        <h2 id="end-title" className="end__title" tabIndex={-1} ref={headingRef}>
          {T.endTitle}
        </h2>
        <p className="end__reason">{T.endReason[result.reason]}</p>
        <p className="end__headline">{headline}</p>
        <ol className="end__list">
          {rows.map((score) => {
            const player = byId.get(score.playerId);
            if (!player) return null;
            const won = winners.has(score.playerId);
            return (
              <li key={score.playerId} className={cx('end__row', won && 'is-winner', player.isYou && 'is-you')}>
                <div className="end__who">
                  <span className="end__name">{display(player.id)}</span>
                  {won && <span className="chip chip--win">{T.winnerBadge}</span>}
                </div>
                <Grid
                  player={player}
                  now={view.now}
                  size="end"
                  label={`Cartas de ${display(player.id)}`}
                  slotLabel={(slot) => T.oppSlotLabel(display(player.id), slot)}
                />
                <div className="end__total" aria-label={`${T.total}: ${formatTotal(score.total)}`}>
                  <span className="end__total-label" aria-hidden="true">
                    {T.total}
                  </span>
                  <span className="end__total-num" aria-hidden="true">
                    {formatTotal(score.total)}
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
        <button type="button" className="btn btn--primary end__leave" onClick={onLeave}>
          {T.backToLobby}
        </button>
      </div>
    </div>
  );
}
