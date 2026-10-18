import { useMemo, useState } from 'react';
import type { Rank } from '@moises/shared';
import { Avatar } from '../components/Avatar';
import { cx } from '../components/cx';
import type { GameConnection, RoomView } from '../connection/types';
import { avatarLooks } from '../game/avatars';
import { T } from '../i18n/pt-BR';
import { TableSettings } from './TableSettings';

export interface WaitingRoomProps {
  readonly connection: GameConnection;
  readonly room: RoomView;
}

/**
 * Waiting room: the code to share, who is sitting and who is waiting in the
 * queue, bots, table settings and the start button. What is allowed is the
 * server's call: buttons only mirror RoomView and refusals come back as notices.
 */
export function WaitingRoom({ connection, room }: WaitingRoomProps) {
  const [copied, setCopied] = useState(false);
  const isHost = room.hostId === room.you;
  const queued = room.queue.some((q) => q.id === room.you);
  const { minPlayers, maxPlayers } = room.settings;
  const seated = room.members.length;
  const playing = room.status === 'playing';
  const looks = useMemo(() => avatarLooks([...room.members.map((m) => m.id), ...room.queue.map((q) => q.id)]), [room.members, room.queue]);
  // Every rank with a power in the server rules, on or off at this table.
  const powerRanks: readonly Rank[] = room.availablePowers;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(room.code);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <main className="lobby lobby--room">
      <header className="room__head">
        {room.status === 'ended' && <p className="room__status">{T.roomEndedTitle}</p>}
        {playing && <p className="room__status">{T.roomPlaying}</p>}
        <h1 className="room__code" aria-label={T.roomTitle(room.code.split('').join(' '))}>
          {room.code}
        </h1>
        <p className="room__share">{T.roomShare}</p>
        <button type="button" className="btn btn--link" onClick={copy}>
          {copied ? T.codeCopied : T.copyCode}
        </button>
      </header>

      <section className="lobby__panel" aria-labelledby="seats-title">
        <h2 id="seats-title" className="room__count">
          {T.seatsCount(seated, maxPlayers)}
        </h2>
        <ul className="seats">
          {room.members.map((member) => {
            const isYou = member.id === room.you;
            return (
              <li key={member.id} className={cx('seats__item', isYou && 'is-you', !member.connected && 'is-offline')}>
                <Avatar name={member.name} id={member.id} look={looks.get(member.id)} isBot={member.isBot} className="seats__avatar" />
                <span className="seats__name">
                  {member.name}
                  {isYou && <span className="seats__meta"> ({T.you.toLowerCase()})</span>}
                </span>
                {member.isHost && <span className="chip chip--muted">{T.host}</span>}
                {member.isBot && <span className="chip chip--bot">{T.bot}</span>}
                {!member.connected && <span className="chip chip--last">{T.offline}</span>}
                {member.isBot && isHost && !playing && (
                  <button
                    type="button"
                    className="btn btn--link seats__remove"
                    aria-label={T.removeBot(member.name)}
                    onClick={() => void connection.removeBot(member.id)}
                  >
                    ×
                  </button>
                )}
              </li>
            );
          })}
        </ul>

        {isHost && !playing && seated < maxPlayers && (
          <button type="button" className="btn btn--ghost" onClick={() => void connection.addBot()}>
            {T.addBot}
          </button>
        )}

        {room.queue.length > 0 && (
          <div className="queue">
            <h3 className="queue__title">{T.queueTitle}</h3>
            <ul className="seats">
              {room.queue.map((q) => (
                <li key={q.id} className={cx('seats__item', q.id === room.you && 'is-you', !q.connected && 'is-offline')}>
                  <Avatar name={q.name} id={q.id} look={looks.get(q.id)} className="seats__avatar" />
                  <span className="seats__name">
                    {q.name}
                    {q.id === room.you && <span className="seats__meta"> ({T.you.toLowerCase()})</span>}
                  </span>
                  <span className="chip chip--muted">{T.waiting}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {queued && <p className="lobby__note">{T.queueYou}</p>}
      </section>

      <TableSettings
        table={room.table}
        powerRanks={powerRanks}
        editable={isHost && !playing}
        onChange={(settings) => connection.setTable(settings)}
      />

      <div className="room__actions">
        {playing ? (
          <p className="lobby__note">{T.queueHint}</p>
        ) : isHost ? (
          <>
            <button
              type="button"
              className="btn btn--primary btn--big"
              disabled={seated + room.queue.length < minPlayers}
              onClick={() => void connection.startGame()}
            >
              {room.status === 'ended' ? T.playAgain : T.startGame}
            </button>
            {seated + room.queue.length < minPlayers && <p className="lobby__note">{T.minPlayersHint(minPlayers)}</p>}
          </>
        ) : (
          <p className="lobby__note">{room.status === 'ended' ? T.waitingHostAgain : T.waitingHost}</p>
        )}
        <button type="button" className="btn btn--link" onClick={() => void connection.leaveRoom()}>
          {T.leaveRoom}
        </button>
      </div>
    </main>
  );
}
