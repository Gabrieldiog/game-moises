import { useState, type FormEvent } from 'react';
import { PROTOCOL_LIMITS } from '@moises/shared';
import { faceUrl } from '../components/CardView';
import backUrl from '../assets/card-back.svg';
import type { GameConnection } from '../connection/types';
import { T } from '../i18n/pt-BR';

export interface HomeProps {
  readonly connection: GameConnection;
  readonly initialName?: string;
  readonly onName?: (name: string) => void;
}

/** First screen: your name, then create a room, join one with a code, or play against bots. */
export function Home({ connection, initialName = '', onName }: HomeProps) {
  const [name, setName] = useState(initialName);
  const [code, setCode] = useState('');
  const cleanName = name.trim();
  const hasName = cleanName.length >= PROTOCOL_LIMITS.playerNameMinLength;

  const remember = () => onName?.(cleanName);

  const join = (event: FormEvent) => {
    event.preventDefault();
    if (!hasName || code.trim() === '') return;
    remember();
    connection.joinRoom({ code, name: cleanName });
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
            disabled={!hasName}
            onClick={() => {
              remember();
              connection.createRoom({ name: cleanName, mode: 'online' });
            }}
          >
            {T.createRoom}
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            disabled={!hasName}
            onClick={() => {
              remember();
              connection.createRoom({ name: cleanName, mode: 'bots' });
            }}
          >
            {T.playBots}
          </button>
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
              <button type="submit" className="btn btn--ghost" disabled={!hasName || code.trim() === ''}>
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
