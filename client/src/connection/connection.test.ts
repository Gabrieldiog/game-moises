import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Action, RoomView } from '@moises/shared';
import { readConfig } from '../config';
import { MockConnection } from './mock';
import { ConnectionStore } from './store';
import type { ConnectionEvent } from './types';

function collect(connection: MockConnection) {
  const events: ConnectionEvent[] = [];
  connection.subscribe((e) => events.push(e));
  return events;
}

function lastRoom(events: readonly ConnectionEvent[]): RoomView | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e?.type === 'room') return e.room;
  }
  return null;
}

describe('MockConnection', () => {
  afterEach(() => vi.useRealTimers());

  it('connects asynchronously', async () => {
    const mock = new MockConnection();
    const events = collect(mock);
    mock.connect();
    expect(mock.getStatus()).toBe('connecting');
    await Promise.resolve();
    expect(events.map((e) => e.type === 'status' && e.status)).toEqual(['connecting', 'connected']);
  });

  it('runs the lobby in the RoomView shape: create, add bots, start', async () => {
    const mock = new MockConnection({ autoAdvance: false });
    const events = collect(mock);
    await mock.createRoom('  Gi ');
    let room = lastRoom(events);
    expect(room).toMatchObject({ status: 'lobby', members: [{ name: 'Gi', isHost: true, isBot: false }], queue: [] });
    expect(room?.table.reactions).toEqual({ matchOwn: true, matchOpponent: true });
    expect(room?.hostId).toBe(room?.you);
    await mock.addBot();
    room = lastRoom(events);
    expect(room?.members.map((m) => m.isBot)).toEqual([false, true]);
    await mock.startGame();
    const last = events.at(-1);
    expect(last?.type).toBe('update');
    if (last?.type === 'update') {
      expect(last.update.view.phase).toBe('arrange');
      expect(last.update.view.players.map((p) => p.name)).toEqual(['Gi', 'Bot 1']);
    }
    expect(lastRoom(events)?.status).toBe('playing');
  });

  it('quick play starts at once with the bots asked for', async () => {
    const mock = new MockConnection({ autoAdvance: false });
    const events = collect(mock);
    expect((await mock.quickPlay('Gi', 2)).ok).toBe(true);
    expect(lastRoom(events)?.members).toHaveLength(3);
    expect((await new MockConnection().quickPlay('Gi', 9)).ok).toBe(false);
  });

  it('applies table settings for the host and refuses bad ones', async () => {
    const mock = new MockConnection({ autoAdvance: false });
    const events = collect(mock);
    await mock.createRoom('Gi');
    const ok = await mock.setTable({ turnSeconds: 30, reactions: { matchOwn: false, matchOpponent: true }, powers: ['Q', '7'] });
    expect(ok.ok).toBe(true);
    expect(lastRoom(events)?.table).toEqual({ turnSeconds: 30, reactions: { matchOwn: false, matchOpponent: true }, powers: ['7', 'Q'] });
    const tooFast = await mock.setTable({ turnSeconds: 2, reactions: { matchOwn: true, matchOpponent: true }, powers: [] });
    expect(tooFast).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST', request: 'room:setTable' } });
    const noPower = await mock.setTable({ turnSeconds: 10, reactions: { matchOwn: true, matchOpponent: true }, powers: ['A'] });
    expect(noPower.ok).toBe(false);
  });

  it('refuses an empty name with a typed error', async () => {
    const mock = new MockConnection();
    const events = collect(mock);
    await mock.createRoom('   ');
    expect(events).toEqual([{ type: 'error', error: { code: 'INVALID_NAME', request: 'room:create', message: 'invalid name' } }]);
  });

  it('records the actions it receives and follows the demo script', () => {
    const mock = new MockConnection({ scenario: 'minha-vez', players: 3 });
    const events = collect(mock);
    mock.loadScenario('minha-vez', 3);
    void mock.send({ type: 'draw' });
    expect(mock.sentActions()).toEqual([{ type: 'draw' }]);
    expect(mock.currentScenario()).toBe('comprada');
    const last = events.at(-1);
    expect(last?.type === 'update' && last.update.view.turn?.drawnCard).toBeTruthy();
  });

  it('rejects a malformed action instead of passing it on', () => {
    const mock = new MockConnection();
    const events = collect(mock);
    void mock.send({ type: 'swapWithDrawn', slot: -1 } as unknown as Action);
    expect(mock.sentActions()).toEqual([]);
    expect(events[0]).toMatchObject({ type: 'error', error: { code: 'BAD_REQUEST', request: 'game:action' } });
  });

  it('moves on when a demo deadline passes', () => {
    vi.useFakeTimers();
    const mock = new MockConnection({ now: () => 0 });
    mock.loadScenario('arrumacao', 2);
    vi.advanceTimersByTime(60_000);
    expect(mock.currentScenario()).toBe('minha-vez');
  });
});

describe('ConnectionStore', () => {
  it('keeps the server clock offset and the turn deadline of the last update', () => {
    const mock = new MockConnection({ now: () => 50_000, autoAdvance: false });
    const store = new ConnectionStore(mock, () => 10_000);
    mock.loadScenario('minha-vez', 2);
    expect(store.getSnapshot().clockOffset).toBe(40_000);
    expect(store.getSnapshot().view?.phase).toBe('playing');
    expect(store.getSnapshot().turnDeadline).toBeGreaterThan(50_000);
  });

  it('remembers the last action sent and exposes errors as notices', async () => {
    const mock = new MockConnection({ autoAdvance: false });
    const store = new ConnectionStore(mock);
    store.send({ type: 'callEnd' });
    expect(store.getSnapshot().lastSent).toEqual({ type: 'callEnd' });
    await mock.createRoom('');
    const notice = store.getSnapshot().notice;
    expect(notice?.content).toMatchObject({ kind: 'error', error: { code: 'INVALID_NAME' } });
    store.dismissNotice(notice!.id);
    expect(store.getSnapshot().notice).toBeNull();
  });

  it('leaving the room clears the game', async () => {
    const mock = new MockConnection({ autoAdvance: false });
    const store = new ConnectionStore(mock);
    await mock.quickPlay('Gi', 1);
    expect(store.getSnapshot().view).not.toBeNull();
    await mock.leaveRoom();
    expect(store.getSnapshot()).toMatchObject({ room: null, view: null, turnDeadline: null });
  });
});

describe('readConfig', () => {
  it('reads the server URL from the environment, empty meaning none', () => {
    expect(readConfig({ DEV: false, VITE_SERVER_URL: '  ' }, '').serverUrl).toBeNull();
    expect(readConfig({ DEV: false, VITE_SERVER_URL: 'https://x.example' }, '').serverUrl).toBe('https://x.example');
  });

  it('turns demo tools on in dev or with ?demo=', () => {
    expect(readConfig({ DEV: false }, '').demoTools).toBe(false);
    expect(readConfig({ DEV: true }, '').demoTools).toBe(true);
    const config = readConfig({ DEV: false }, '?demo=reacao&jogadores=4&tempo=3');
    expect(config.demoTools).toBe(true);
    expect(config.demo).toEqual({ scenario: 'reacao', players: 4, timeScale: 3 });
    expect(readConfig({ DEV: false }, '?demo=nada').demo?.scenario).toBeNull();
  });
});
