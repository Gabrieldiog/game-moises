import { useEffect, useId, useRef, useState } from 'react';
import { T } from '../i18n/pt-BR';
import { sounds } from '../sound/sounds';
import { useSoundSettings } from '../sound/useSound';
import { cx } from './cx';
import { Icon } from './Icon';

/** Sound button: one tap opens mute and volume. Remembered on this device. */
export function SoundControl() {
  const settings = useSoundSettings();
  const [open, setOpen] = useState(false);
  const id = useId();
  const wrap = useRef<HTMLDivElement | null>(null);
  const off = settings.muted || settings.volume === 0;

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="soundctl" ref={wrap}>
      <button
        type="button"
        className={cx('iconbtn', 'iconbtn--felt', off && 'is-off')}
        aria-label={`${T.soundSettings} (${off ? T.soundOff : T.soundOn})`}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name={off ? 'mute' : 'sound'} />
      </button>
      {open && (
        <div className="soundctl__pop" id={id} role="group" aria-label={T.sound}>
          <button
            type="button"
            className={cx('btn', off ? 'btn--primary' : 'btn--ghost', 'soundctl__mute')}
            aria-pressed={!off}
            onClick={() => (off ? sounds().setVolume(settings.volume === 0 ? 0.6 : settings.volume) : sounds().setMuted(true))}
          >
            {off ? T.soundUnmute : T.soundMute}
          </button>
          <label className="soundctl__vol">
            <span>{T.soundVolume}</span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={Math.round((settings.muted ? 0 : settings.volume) * 100)}
              onChange={(e) => {
                sounds().setVolume(Number(e.target.value) / 100);
                sounds().play('flip');
              }}
            />
          </label>
        </div>
      )}
    </div>
  );
}
