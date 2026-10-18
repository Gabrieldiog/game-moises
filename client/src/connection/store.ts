import type { Action, GameView } from '@moises/shared';
import { clockOffset } from '../game/clock';
import type { ConnectionError, ConnectionStatus, GameConnection, RoomView } from './types';

export interface ConnectionNotice {
  readonly id: number;
  readonly error: ConnectionError;
}

export interface ConnectionSnapshot {
  readonly status: ConnectionStatus;
  readonly room: RoomView | null;
  readonly view: GameView | null;
  /** view.now - Date.now() measured when the last view arrived. */
  readonly clockOffset: number;
  readonly notice: ConnectionNotice | null;
  readonly lastSent: Action | null;
}

/**
 * Keeps the latest state pushed by a GameConnection in one immutable snapshot,
 * ready for React's useSyncExternalStore.
 */
export class ConnectionStore {
  private snapshot: ConnectionSnapshot;
  private readonly listeners = new Set<() => void>();
  private noticeSeq = 0;
  private readonly unsubscribe: () => void;

  constructor(
    readonly connection: GameConnection,
    private readonly localNow: () => number = Date.now,
  ) {
    this.snapshot = {
      status: connection.getStatus(),
      room: null,
      view: null,
      clockOffset: 0,
      notice: null,
      lastSent: null,
    };
    this.unsubscribe = connection.subscribe((event) => {
      switch (event.type) {
        case 'status':
          this.set({ status: event.status });
          break;
        case 'room':
          this.set({ room: event.room, ...(event.room === null ? { view: null } : {}) });
          break;
        case 'view':
          this.set({ view: event.view, clockOffset: clockOffset(event.view.now, this.localNow()) });
          break;
        case 'error':
          this.noticeSeq += 1;
          this.set({ notice: { id: this.noticeSeq, error: event.error } });
          break;
      }
    });
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): ConnectionSnapshot => this.snapshot;

  send(action: Action): void {
    this.set({ lastSent: action });
    this.connection.send(action);
  }

  dismissNotice(id: number): void {
    if (this.snapshot.notice?.id === id) this.set({ notice: null });
  }

  dispose(): void {
    this.unsubscribe();
    this.listeners.clear();
  }

  private set(patch: Partial<ConnectionSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
}
