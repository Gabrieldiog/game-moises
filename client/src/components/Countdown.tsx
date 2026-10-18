import { useState } from 'react';
import { secondsLeft } from '../game/clock';
import { T } from '../i18n/pt-BR';
import { cx } from './cx';

export interface CountdownProps {
  /** Server time (ms) when the phase / window ends. */
  readonly deadline: number;
  /** Current server time. */
  readonly now: number;
  /** What is ending ("Arrumação", "Reação"...). */
  readonly label: string;
  readonly tone?: 'calm' | 'hot';
  readonly className?: string;
}

/**
 * Seconds left until a server deadline, with a ring that empties. The full
 * length of the ring is the time left when this deadline was first seen, so no
 * duration has to be known in advance.
 */
export function Countdown({ deadline, now, label, tone = 'calm', className }: CountdownProps) {
  const [origin, setOrigin] = useState({ deadline, start: now });
  if (origin.deadline !== deadline) setOrigin({ deadline, start: now });
  const start = origin.deadline === deadline ? origin.start : now;

  const total = Math.max(1, deadline - start);
  const fraction = Math.min(1, Math.max(0, (deadline - now) / total));
  const secs = secondsLeft(deadline, now);
  const radius = 20;
  const circumference = 2 * Math.PI * radius;

  return (
    <div
      className={cx('countdown', `countdown--${tone}`, secs === 0 && 'is-over', className)}
      role="timer"
      aria-label={`${label}: ${T.secondsLeft(secs)}`}
    >
      <svg className="countdown__ring" viewBox="0 0 48 48" aria-hidden="true">
        <circle className="countdown__track" cx="24" cy="24" r={radius} />
        <circle
          className="countdown__bar"
          cx="24"
          cy="24"
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fraction)}
        />
      </svg>
      <span className="countdown__num" aria-hidden="true">
        {secs}
      </span>
    </div>
  );
}
