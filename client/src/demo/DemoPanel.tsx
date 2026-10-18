import { useState } from 'react';
import type { Action } from '@moises/shared';
import type { MockConnection } from '../connection/mock';
import { cx } from '../components/cx';
import { T } from '../i18n/pt-BR';
import { DEMO_PLAYER_COUNTS, SCENARIOS, type ScenarioId } from './fixtures';

export interface DemoPanelProps {
  readonly mock: MockConnection;
  readonly lastSent: Action | null;
  readonly initialPlayers: number;
  /** Rendered inside the status bar during a match, floating on lobby screens. */
  readonly placement: 'inline' | 'floating';
}

function syncUrl(scenario: ScenarioId, players: number): void {
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('demo', scenario);
    url.searchParams.set('jogadores', String(players));
    window.history.replaceState(null, '', url);
  } catch {
    // URL sync is a convenience only.
  }
}

/** Dev / ?demo= only: jump to any moment of a match with 2 to 6 players. */
export function DemoPanel({ mock, lastSent, initialPlayers, placement }: DemoPanelProps) {
  const [open, setOpen] = useState(false);
  const [players, setPlayers] = useState(initialPlayers);
  const current = mock.currentScenario();

  const load = (scenario: ScenarioId, count: number) => {
    mock.loadScenario(scenario, count);
    syncUrl(scenario, count);
  };

  return (
    <>
      <button
        type="button"
        className={cx('demo-toggle', `demo-toggle--${placement}`)}
        aria-expanded={open}
        aria-controls="demo-panel"
        onClick={() => setOpen((v) => !v)}
      >
        {T.demoButton}
      </button>
      {open && (
        <div className="demo" id="demo-panel" role="dialog" aria-modal="false" aria-labelledby="demo-title">
          <div className="demo__head">
            <h2 id="demo-title" className="demo__title">
              {T.demoTitle}
            </h2>
            <button type="button" className="btn btn--link" onClick={() => setOpen(false)}>
              {T.demoClose}
            </button>
          </div>
          <fieldset className="demo__players">
            <legend>{T.demoPlayers}</legend>
            {DEMO_PLAYER_COUNTS.map((n) => (
              <button
                key={n}
                type="button"
                className={cx('demo__count', n === players && 'is-on')}
                aria-pressed={n === players}
                onClick={() => {
                  setPlayers(n);
                  if (current) load(current, n);
                }}
              >
                {n}
              </button>
            ))}
          </fieldset>
          <ul className="demo__list">
            {SCENARIOS.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className={cx('demo__scene', s.id === current && 'is-on')}
                  aria-current={s.id === current ? 'true' : undefined}
                  onClick={() => load(s.id, players)}
                >
                  {s.label}
                </button>
              </li>
            ))}
          </ul>
          <div className="demo__foot">
            {current && (
              <button type="button" className="btn btn--ghost" onClick={() => load(current, players)}>
                {T.demoReload}
              </button>
            )}
            <p className="demo__sent">
              {T.demoLastSent}: <code>{lastSent ? JSON.stringify(lastSent) : T.demoNone}</code>
            </p>
          </div>
        </div>
      )}
    </>
  );
}
