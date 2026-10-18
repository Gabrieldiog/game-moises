// Table sounds (Kenney CC0, see public/sounds/CREDITS.md) with the Web Audio API.
// Files are fetched as soon as the board is created; they are decoded and can
// only play after the first tap or key press (browser autoplay rules).
// Mute and volume are a per-device convenience kept in localStorage.

export const SOUND_NAMES = ['draw', 'flip', 'discard', 'swap', 'shout', 'hit', 'miss', 'turn', 'win', 'tick', 'tock'] as const;
export type SoundName = (typeof SOUND_NAMES)[number];

export interface SoundSettings {
  readonly muted: boolean;
  /** 0..1 */
  readonly volume: number;
}

const STORAGE_KEY = 'moises.som';
/** Sounds stay in the background: the slider's top is this loud. */
const MAX_GAIN = 0.55;
const DEFAULT_SETTINGS: SoundSettings = { muted: false, volume: 0.6 };

export interface PlayOptions {
  /** Playback rate (pitch); the clock ticks a little higher at the very end. */
  readonly rate?: number;
  /** Extra gain for this sound, 0..1. */
  readonly gain?: number;
}

function readSettings(): SoundSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<SoundSettings>;
    const volume = typeof parsed.volume === 'number' && parsed.volume >= 0 && parsed.volume <= 1 ? parsed.volume : DEFAULT_SETTINGS.volume;
    return { muted: parsed.muted === true, volume };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(settings: SoundSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Only a convenience.
  }
}

function pickExtension(): 'ogg' | 'mp3' {
  try {
    const probe = document.createElement('audio');
    return probe.canPlayType('audio/ogg; codecs="vorbis"') !== '' ? 'ogg' : 'mp3';
  } catch {
    return 'mp3';
  }
}

type AudioCtor = typeof AudioContext;

function audioContextCtor(): AudioCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

export class SoundBoard {
  private settings: SoundSettings = readSettings();
  private readonly listeners = new Set<() => void>();
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly raw = new Map<SoundName, Promise<ArrayBuffer | null>>();
  private readonly buffers = new Map<SoundName, AudioBuffer>();
  private unlocked = false;

  constructor(private readonly baseUrl: string) {}

  /** Starts downloading every file (small: about 60 KB in total). Safe to call more than once. */
  preload(): void {
    if (this.raw.size > 0 || typeof fetch !== 'function' || audioContextCtor() === null) return;
    const ext = pickExtension();
    for (const name of SOUND_NAMES) {
      this.raw.set(
        name,
        fetch(`${this.baseUrl}sounds/${name}.${ext}`)
          .then((res) => (res.ok ? res.arrayBuffer() : null))
          .catch(() => null),
      );
    }
  }

  /** Call from a user gesture: creates the audio context and decodes the files. */
  unlock(): void {
    if (this.unlocked) return;
    const Ctor = audioContextCtor();
    if (!Ctor) return;
    try {
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.applyGain();
      void this.ctx.resume();
      this.unlocked = true;
    } catch {
      this.ctx = null;
      return;
    }
    this.preload();
    for (const [name, pending] of this.raw) {
      void pending.then((data) => {
        if (!data || !this.ctx) return;
        // decodeAudioData detaches the buffer, so decode a copy.
        this.ctx.decodeAudioData(data.slice(0)).then(
          (buffer) => this.buffers.set(name, buffer),
          () => undefined,
        );
      });
    }
  }

  play(name: SoundName, options: PlayOptions = {}): void {
    if (this.settings.muted || !this.ctx || !this.master) return;
    const buffer = this.buffers.get(name);
    if (!buffer) return;
    try {
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = options.rate ?? 1;
      if (options.gain !== undefined) {
        const gain = this.ctx.createGain();
        gain.gain.value = options.gain;
        source.connect(gain).connect(this.master);
      } else {
        source.connect(this.master);
      }
      source.start();
    } catch {
      // A sound never breaks the game.
    }
  }

  getSettings = (): SoundSettings => this.settings;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  setMuted(muted: boolean): void {
    this.update({ ...this.settings, muted });
  }

  setVolume(volume: number): void {
    const v = Math.min(1, Math.max(0, volume));
    this.update({ muted: v === 0, volume: v });
  }

  private update(settings: SoundSettings): void {
    this.settings = settings;
    saveSettings(settings);
    this.applyGain();
    for (const listener of this.listeners) listener();
  }

  private applyGain(): void {
    if (this.master) this.master.gain.value = this.settings.muted ? 0 : this.settings.volume * MAX_GAIN;
  }
}

let board: SoundBoard | null = null;

/** The page's sound board; created on first use. */
export function sounds(): SoundBoard {
  if (!board) {
    board = new SoundBoard(import.meta.env.BASE_URL);
    if (typeof document !== 'undefined') {
      const unlock = () => {
        board?.unlock();
        document.removeEventListener('pointerdown', unlock, true);
        document.removeEventListener('keydown', unlock, true);
      };
      document.addEventListener('pointerdown', unlock, true);
      document.addEventListener('keydown', unlock, true);
    }
  }
  return board;
}

/**
 * Clock ticks for the last seconds of a countdown, faster near the end:
 * every second from 5 s, every half second from 3 s, every quarter from 1.5 s.
 * Returns the gap (ms) between ticks for `remaining`, or null when silent.
 */
export function tickInterval(remaining: number, from = 5_000): number | null {
  if (remaining <= 0 || remaining > from) return null;
  if (remaining > 3_000) return 1_000;
  if (remaining > 1_500) return 500;
  return 250;
}
