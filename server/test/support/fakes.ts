import type { GameUpdate, RoomClosed, RoomView } from '@moises/shared';
import { loadServerConfig, type ServerConfig } from '../../src/config/env.js';
import type { Scheduler, Transport } from '../../src/rooms/manager.js';

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

/** Server settings for tests: silent, instant bots, plus overrides. */
export function testConfig(patch: DeepPartial<ServerConfig> = {}): ServerConfig {
  const base = loadServerConfig({ LOG_LEVEL: 'silent', BOT_DELAY_MIN_MS: '0', BOT_DELAY_MAX_MS: '0', PORT: '0', HOST: '127.0.0.1' });
  return {
    ...base,
    ...(patch as Partial<ServerConfig>),
    limits: {
      ...base.limits,
      ...(patch.limits as Partial<ServerConfig['limits']>),
      rateLimit: { ...base.limits.rateLimit, ...patch.limits?.rateLimit },
      joinFailures: { ...base.limits.joinFailures, ...patch.limits?.joinFailures },
    },
    rooms: { ...base.rooms, ...patch.rooms },
    bots: { ...base.bots, ...patch.bots },
  };
}

/** Manual clock and timers: time only moves when the test says so. */
export class FakeClock {
  now = 1_000_000;
  private readonly timers = new Map<number, { at: number; callback: () => void }>();
  private nextId = 1;

  readonly scheduler: Scheduler = {
    setTimeout: (callback, ms) => {
      const id = this.nextId++;
      this.timers.set(id, { at: this.now + Math.max(0, ms), callback });
      return id;
    },
    clearTimeout: (handle) => {
      this.timers.delete(handle as number);
    },
  };

  get pendingTimers(): number {
    return this.timers.size;
  }

  /** Moves time forward, firing every timer due on the way, in order. */
  advance(ms: number): void {
    const target = this.now + ms;
    for (;;) {
      let next: [number, { at: number; callback: () => void }] | null = null;
      for (const entry of this.timers) {
        if (entry[1].at <= target && (!next || entry[1].at < next[1].at)) next = entry;
      }
      if (!next) break;
      this.timers.delete(next[0]);
      this.now = Math.max(this.now, next[1].at);
      next[1].callback();
    }
    this.now = target;
  }
}

export type Sent =
  | { type: 'room:state'; data: RoomView }
  | { type: 'game:update'; data: GameUpdate }
  | { type: 'room:closed'; data: RoomClosed }
  | { type: 'session:replaced'; data: null };

interface SentData {
  'room:state': RoomView;
  'game:update': GameUpdate;
  'room:closed': RoomClosed;
  'session:replaced': null;
}

/** Records everything the manager sends, per socket. */
export class FakeTransport implements Transport {
  readonly sent = new Map<string, Sent[]>();

  private push(socketId: string, message: Sent): void {
    const list = this.sent.get(socketId) ?? [];
    list.push(structuredClone(message));
    this.sent.set(socketId, list);
  }

  roomState(socketId: string, room: RoomView): void {
    this.push(socketId, { type: 'room:state', data: room });
  }
  gameUpdate(socketId: string, update: GameUpdate): void {
    this.push(socketId, { type: 'game:update', data: update });
  }
  roomClosed(socketId: string, info: RoomClosed): void {
    this.push(socketId, { type: 'room:closed', data: info });
  }
  sessionReplaced(socketId: string): void {
    this.push(socketId, { type: 'session:replaced', data: null });
  }

  of(socketId: string): Sent[] {
    return this.sent.get(socketId) ?? [];
  }

  last<T extends keyof SentData>(socketId: string, type: T): SentData[T] | undefined {
    const list = this.of(socketId).filter((m) => m.type === type);
    const found = list[list.length - 1];
    return found ? (found.data as SentData[T]) : undefined;
  }

  clear(): void {
    this.sent.clear();
  }
}
