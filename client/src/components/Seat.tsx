import type { GameView, PlayerView } from '@moises/shared';
import { T } from '../i18n/pt-BR';
import { cx } from './cx';
import { Avatar } from './Avatar';
import { Grid } from './Grid';

export interface SeatProps {
  readonly view: GameView;
  readonly player: PlayerView;
  readonly now: number;
  readonly area: 'left' | 'top' | 'right';
  /** Position in turn order, only to pick the avatar color. */
  readonly seatIndex: number;
  readonly isBot?: boolean;
  readonly isSelectable: (slot: number) => boolean;
  readonly isSelected: (slot: number) => boolean;
  readonly onSelect: (slot: number) => void;
}

/** An opponent around the table: name tag, small grid and what is going on with them. */
export function Seat({ view, player, now, area, seatIndex, isBot = false, isSelectable, isSelected, onSelect }: SeatProps) {
  const isTurn = view.phase === 'playing' && view.turn?.playerId === player.id;
  const holding = isTurn && view.turn?.hasDrawnCard === true;
  const called = view.endCall?.callerId === player.id;
  const lastTurn = view.endCall?.pending.includes(player.id) === true;
  const reacted = view.reactionWindow?.attemptedBy.includes(player.id) === true;
  interface Chip {
    readonly key: string;
    readonly text: string;
    readonly tone: 'end' | 'last' | 'muted';
  }
  const chips: Chip[] = [];
  if (called) chips.push({ key: 'end', text: T.callEnd, tone: 'end' });
  else if (lastTurn) chips.push({ key: 'last', text: T.finalTurnPending, tone: 'last' });
  if (reacted) chips.push({ key: 'reacted', text: T.reacted, tone: 'muted' });

  return (
    <section
      className={cx('seat', `seat--${area}`, isTurn && 'is-turn')}
      aria-label={[player.name, isTurn ? T.turnOf(player.name) : null, T.cardsLeft(player.cardCount)].filter(Boolean).join(', ')}
    >
      <div className="seat__tag">
        <Avatar name={player.name} index={seatIndex} isBot={isBot} />
        <span className="seat__name">{player.name}</span>
        {holding && <span className="seat__hand" title={T.heldBy(player.name)} aria-hidden="true" />}
      </div>
      <Grid
        player={player}
        now={now}
        size="opp"
        label={`Cartas de ${player.name}`}
        slotLabel={(slot) => T.oppSlotLabel(player.name, slot)}
        isSelectable={isSelectable}
        isSelected={isSelected}
        onSelect={onSelect}
      />
      {chips.length > 0 && (
        <ul className="seat__notes">
          {chips.map((chip) => (
            <li key={chip.key} className={`chip chip--${chip.tone}`}>
              {chip.text}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
