import { useState } from 'react';
import { PROTOCOL_LIMITS, type Rank, type SetTableSettingsPayload, type TableSettingsView } from '@moises/shared';
import { cx } from '../components/cx';
import type { RequestResult } from '../connection/types';
import { T } from '../i18n/pt-BR';
import { TURN_SECONDS_STEP } from '../ui/constants';

export interface TableSettingsProps {
  /** As the server has them now (RoomView.table). */
  readonly table: TableSettingsView;
  /** Ranks offered as power switches (see game/powerRanks.ts). */
  readonly powerRanks: readonly Rank[];
  /** Only the host edits; everyone else reads. */
  readonly editable: boolean;
  readonly onChange: (settings: SetTableSettingsPayload) => Promise<RequestResult>;
}

function toPayload(table: TableSettingsView): SetTableSettingsPayload {
  return { turnSeconds: table.turnSeconds, reactions: { ...table.reactions }, powers: [...table.powers] };
}

/**
 * "Configurações da mesa". Every change is sent at once with room:setTable;
 * the screen shows the change right away and settles on the server's answer
 * (the next room:state, or back to the server's values after a refusal).
 */
export function TableSettings({ table, powerRanks, editable, onChange }: TableSettingsProps) {
  const [draft, setDraft] = useState<{ base: TableSettingsView; value: SetTableSettingsPayload } | null>(null);
  // A new room:state from the server replaces any pending draft.
  const shown = draft !== null && draft.base === table ? draft.value : toPayload(table);

  const send = (next: SetTableSettingsPayload) => {
    setDraft({ base: table, value: next });
    void onChange(next).then((result) => {
      if (!result.ok) setDraft(null);
    });
  };

  const min = PROTOCOL_LIMITS.tableTurnSecondsMin;
  const max = PROTOCOL_LIMITS.tableTurnSecondsMax;
  const setSeconds = (delta: number) => {
    // Steps land on multiples of the step, inside the protocol bounds.
    const raw = delta > 0 ? Math.floor(shown.turnSeconds / TURN_SECONDS_STEP + 1) * TURN_SECONDS_STEP : Math.ceil(shown.turnSeconds / TURN_SECONDS_STEP - 1) * TURN_SECONDS_STEP;
    const turnSeconds = Math.min(max, Math.max(min, raw));
    if (turnSeconds !== shown.turnSeconds) send({ ...shown, turnSeconds });
  };
  const toggleReaction = (kind: 'matchOwn' | 'matchOpponent') =>
    send({ ...shown, reactions: { ...shown.reactions, [kind]: !shown.reactions[kind] } });
  const togglePower = (rank: Rank) => {
    const on = shown.powers.includes(rank);
    send({ ...shown, powers: powerRanks.filter((r) => (r === rank ? !on : shown.powers.includes(r))) });
  };

  const reactions = [
    { kind: 'matchOwn', label: T.shoutOwn, hint: T.shoutOwnHint },
    { kind: 'matchOpponent', label: T.shoutOpponent, hint: T.shoutOpponentHint },
  ] as const;

  return (
    <section className={cx('lobby__panel', 'tableset', !editable && 'is-readonly')} aria-labelledby="tableset-title">
      <div className="tableset__head">
        <h2 id="tableset-title" className="tableset__title">
          {T.tableTitle}
        </h2>
        {!editable && <p className="tableset__note">{T.tableReadOnly}</p>}
      </div>

      <div className="tableset__row">
        <span className="tableset__label" id="tableset-time">
          {T.turnSecondsLabel}
        </span>
        {editable ? (
          <div className="stepper" role="group" aria-labelledby="tableset-time">
            <button type="button" className="stepper__btn" aria-label={T.lessTime} disabled={shown.turnSeconds <= min} onClick={() => setSeconds(-1)}>
              −
            </button>
            <output className="stepper__value stepper__value--wide" aria-live="polite">
              {T.turnSecondsValue(shown.turnSeconds)}
            </output>
            <button type="button" className="stepper__btn" aria-label={T.moreTime} disabled={shown.turnSeconds >= max} onClick={() => setSeconds(1)}>
              +
            </button>
          </div>
        ) : (
          <strong className="tableset__value">{T.turnSecondsValue(shown.turnSeconds)}</strong>
        )}
      </div>

      <fieldset className="tableset__group">
        <legend className="tableset__label">{T.reactionsLabel}</legend>
        {reactions.map(({ kind, label, hint }) => {
          const on = shown.reactions[kind];
          return editable ? (
            <button key={kind} type="button" role="switch" aria-checked={on} className={cx('switch', on && 'is-on')} onClick={() => toggleReaction(kind)}>
              <span className="switch__text">
                <span className="switch__label">{label}</span>
                <span className="switch__hint">{hint}</span>
              </span>
              <span className="switch__track" aria-hidden="true">
                <span className="switch__thumb" />
              </span>
            </button>
          ) : (
            <p key={kind} className={cx('switch', 'switch--static', on && 'is-on')}>
              <span className="switch__text">
                <span className="switch__label">{label}</span>
                <span className="switch__hint">{hint}</span>
              </span>
              <span className="switch__state">{on ? T.on : T.off}</span>
            </p>
          );
        })}
      </fieldset>

      <fieldset className="tableset__group">
        <legend className="tableset__label">{T.powersLabel}</legend>
        <p className="tableset__hint">{T.powersHint}</p>
        {powerRanks.length === 0 ? (
          <p className="tableset__hint">{T.powersNone}</p>
        ) : (
          <ul className="ranks">
            {powerRanks.map((rank) => {
              const on = shown.powers.includes(rank);
              const label = T.rankShort(rank);
              return (
                <li key={rank}>
                  {editable ? (
                    <button type="button" className={cx('rank', on && 'is-on')} aria-pressed={on} onClick={() => togglePower(rank)}>
                      {label}
                    </button>
                  ) : (
                    <span className={cx('rank', 'rank--static', on && 'is-on')} aria-label={`${label}: ${on ? T.on : T.off}`}>
                      {label}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </fieldset>
    </section>
  );
}
