import { useState, type FormEvent } from 'react';
import { PROTOCOL_LIMITS } from '@moises/shared';
import { faceUrl } from '../components/CardView';
import backUrl from '../assets/card-back.svg';
import type { GameConnection, RequestResult } from '../connection/types';
import { T } from '../i18n/pt-BR';
import { QUICK_PLAY_DEFAULT_BOTS } from '../ui/constants';

export interface HomeProps {
  readonly connection: GameConnection;
  readonly initialName?: string;
  readonly onName?: (name: string) => void;
  /**
   * Most bots that fit with you at a table (server room size minus you), when
   * the server already told us (RoomView.settings). Unknown: the picker is
   * only bounded by the protocol and the server answers ROOM_FULL.
   */
  readonly maxBots?: number | null;
}

/** First screen: your name, then create a room, join one with a code, or play against bots. */
export function Home({ connection, initialName = '', onName, maxBots = null }: HomeProps) {
  const [name, setName] = useState(initialName);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const cap = Math.max(1, maxBots ?? PROTOCOL_LIMITS.maxBotsPerRequest);
  const [bots, setBots] = useState(Math.min(QUICK_PLAY_DEFAULT_BOTS, cap));
  const cleanName = name.trim();
  const hasName = cleanName.length >= PROTOCOL_LIMITS.playerNameMinLength;
  const botCount = Math.min(bots, cap);

  // One request at a time; the answer (room or refusal notice) comes from the server.
  const run = (request: () => Promise<RequestResult>) => {
    if (busy) return;
    onName?.(cleanName);
    setBusy(true);
    void request().finally(() => setBusy(false));
  };

  const join = (event: FormEvent) => {
    event.preventDefault();
    if (!hasName || code.trim() === '') return;
    run(() => connection.joinRoom(code, cleanName));
  };

  return (
    <main className="lobby lobby--home">
      <div className="hero" aria-hidden="true">
        <img className="hero__card hero__card--a" src={backUrl} alt="" />
        <img className="hero__card hero__card--b" src={faceUrl({ kind: 'standard', rank: 'K', suit: 'hearts' })} alt="" />
        <img className="hero__card hero__card--c" src={backUrl} alt="" />
      </div>
      <h1 className="logo">{T.appName}</h1>
      <p className="tagline">{T.tagline}</p>

      <div className="lobby__panel">
        <label className="field">
          <span className="field__label">{T.nameLabel}</span>
          <input
            className="field__input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={T.namePlaceholder}
            maxLength={PROTOCOL_LIMITS.playerNameMaxLength}
            autoComplete="nickname"
            enterKeyHint="done"
          />
        </label>

        <div className="lobby__actions">
          <button
            type="button"
            className="btn btn--primary"
            disabled={!hasName || busy}
            onClick={() => run(() => connection.createRoom(cleanName))}
          >
            {T.createRoom}
          </button>

          <div className="bots" role="group" aria-label={T.botsLabel}>
            <button
              type="button"
              className="btn btn--ghost bots__play"
              disabled={!hasName || busy}
              onClick={() => run(() => connection.quickPlay(cleanName, botCount))}
            >
              {T.playBots(botCount)}
            </button>
            <div className="stepper">
              <button
                type="button"
                className="stepper__btn"
                aria-label={T.fewerBots}
                disabled={botCount <= 1}
                onClick={() => setBots(Math.max(1, botCount - 1))}
              >
                −
              </button>
              <output className="stepper__value" aria-live="polite">
                {botCount}
              </output>
              <button
                type="button"
                className="stepper__btn"
                aria-label={T.moreBots}
                disabled={botCount >= cap}
                onClick={() => setBots(Math.min(cap, botCount + 1))}
              >
                +
              </button>
            </div>
          </div>
        </div>

        <form className="join" onSubmit={join}>
          <label className="field">
            <span className="field__label">{T.joinTitle}</span>
            <span className="join__row">
              <input
                className="field__input field__input--code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder={T.codePlaceholder}
                aria-label={T.codeLabel}
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
              />
              <button type="submit" className="btn btn--ghost" disabled={!hasName || code.trim() === '' || busy}>
                {T.join}
              </button>
            </span>
          </label>
        </form>
      </div>

      {connection.kind === 'mock' && <p className="lobby__note">{T.mockNotice}</p>}
    </main>
  );
}
