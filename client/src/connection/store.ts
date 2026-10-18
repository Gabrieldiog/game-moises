import type { Action, GameView, RoomClosedReason, RoomSettingsView, ServerGameEvent } from '@moises/shared';
import { clockOffset } from '../game/clock';
import type { ConnectionError, ConnectionStatus, GameConnection, RoomView } from './types';

export type NoticeContent =
  | { readonly kind: 'error'; readonly error: ConnectionError }
  | { readonly kind: 'roomClosed'; readonly reason: RoomClosedReason }
  | { readonly kind: 'sessionLost' };

export interface ConnectionNotice {
  readonly id: number;
  readonly content: NoticeContent;
}

export interface ConnectionSnapshot {
  readonly status: ConnectionStatus;
  readonly room: RoomView | null;
  readonly view: GameView | null;
  /** Public events of the last update, and a counter that grows with each update (drives animations only). */
  readonly events: readonly ServerGameEvent[];
  readonly eventsSeq: number;
  /** GameUpdate.turnDeadline of the last update (server clock). */
  readonly turnDeadline: number | null;
  /** view.now - Date.now() measured when the last update arrived. */
  readonly clockOffset: number;
  /** Room settings the server reported last (kept after leaving, to size pickers). */
  readonly knownSettings: RoomSettingsView | null;
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
      events: [],
      eventsSeq: 0,
      turnDeadline: null,
      clockOffset: 0,
      knownSettings: null,
      notice: null,
      lastSent: null,
    };
    this.unsubscribe = connection.subscribe((event) => {
      switch (event.type) {
        case 'status':
          this.set({ status: event.status });
          break;
        case 'room':
          this.set({
            room: event.room,
            ...(event.room === null ? { view: null, turnDeadline: null } : { knownSettings: event.room.settings }),
          });
          break;
        case 'update':
          this.set({
            view: event.update.view,
            events: event.update.events,
            eventsSeq: this.snapshot.eventsSeq + 1,
            turnDeadline: event.update.turnDeadline,
            clockOffset: clockOffset(event.update.view.now, this.localNow()),
          });
          break;
        case 'error':
          this.notify({ kind: 'error', error: event.error });
          break;
        case 'roomClosed':
          this.notify({ kind: 'roomClosed', reason: event.info.reason });
          break;
        case 'sessionLost':
          this.notify({ kind: 'sessionLost' });
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
    void this.connection.send(action);
  }

  /** Closes the final screen and goes back to the room (the server keeps the room in 'ended'). */
  dismissGame(): void {
    this.set({ view: null, turnDeadline: null });
  }

  dismissNotice(id: number): void {
    if (this.snapshot.notice?.id === id) this.set({ notice: null });
  }

  dispose(): void {
    this.unsubscribe();
    this.listeners.clear();
  }

  private notify(content: NoticeContent): void {
    this.noticeSeq += 1;
    this.set({ notice: { id: this.noticeSeq, content } });
  }

  private set(patch: Partial<ConnectionSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
}
