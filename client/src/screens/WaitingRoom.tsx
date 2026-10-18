import { useState } from 'react';
import { cx } from '../components/cx';
import type { GameConnection, RoomView } from '../connection/types';
import { T } from '../i18n/pt-BR';

export interface WaitingRoomProps {
  readonly connection: GameConnection;
  readonly room: RoomView;
}

/** Waiting room: the code to share, who is sitting, bots, and the start button (enabled by the server). */
export function WaitingRoom({ connection, room }: WaitingRoomProps) {
  const [copied, setCopied] = useState(false);
  const you = room.seats.find((s) => s.isYou);
  const isHost = you?.isHost ?? false;

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
        {room.mode === 'online' ? (
          <>
            <h1 className="room__code" aria-label={T.roomTitle(room.code.split('').join(' '))}>
              {room.code}
            </h1>
            <p className="room__share">{T.roomShare}</p>
            <button type="button" className="btn btn--link" onClick={copy}>
              {copied ? T.codeCopied : T.copyCode}
            </button>
          </>
        ) : (
          <h1 className="room__title">{T.botRoomTitle}</h1>
        )}
      </header>

      <section className="lobby__panel" aria-labelledby="seats-title">
        <h2 id="seats-title" className="room__count">
          {T.seatsCount(room.seats.length, room.maxPlayers)}
        </h2>
        <ul className="seats">
          {room.seats.map((seat) => (
            <li key={seat.id} className={cx('seats__item', seat.isYou && 'is-you')}>
              <span className={cx('seats__avatar', seat.isBot && 'is-bot')} aria-hidden="true">
                {seat.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="seats__name">
                {seat.name}
                {seat.isYou && <span className="seats__meta"> ({T.you.toLowerCase()})</span>}
              </span>
              {seat.isHost && <span className="chip chip--muted">{T.host}</span>}
              {seat.isBot && <span className="chip chip--bot">{T.bot}</span>}
              {seat.isBot && isHost && (
                <button type="button" className="btn btn--link seats__remove" onClick={() => connection.removeBot(seat.id)}>
                  {T.removeBot(seat.name)}
                </button>
              )}
            </li>
          ))}
        </ul>

        {room.canAddBot && (
          <button type="button" className="btn btn--ghost" onClick={() => connection.addBot()}>
            {T.addBot}
          </button>
        )}
      </section>

      <div className="room__actions">
        {isHost ? (
          <>
            <button type="button" className="btn btn--primary btn--big" disabled={!room.canStart} onClick={() => connection.startGame()}>
              {T.startGame}
            </button>
            {!room.canStart && <p className="lobby__note">{T.minPlayersHint(room.minPlayers)}</p>}
          </>
        ) : (
          <p className="lobby__note">{T.waitingHost}</p>
        )}
        <button type="button" className="btn btn--link" onClick={() => connection.leaveRoom()}>
          {T.leaveRoom}
        </button>
      </div>
    </main>
  );
}
