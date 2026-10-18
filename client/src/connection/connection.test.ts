import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Action } from '@moises/shared';
import { readConfig } from '../config';
import { MockConnection } from './mock';
import { ConnectionStore } from './store';
import type { ConnectionEvent } from './types';

function collect(connection: MockConnection) {
  const events: ConnectionEvent[] = [];
  connection.subscribe((e) => events.push(e));
  return events;
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

  it('runs the lobby: create, add bots, start', () => {
    const mock = new MockConnection();
    const events = collect(mock);
    mock.createRoom({ name: '  Gi ', mode: 'bots' });
    let room = events.at(-1)?.type === 'room' ? (events.at(-1) as { room: unknown }).room : null;
    expect(room).toMatchObject({ mode: 'bots', canStart: false, seats: [{ name: 'Gi', isHost: true, isYou: true }] });
    mock.addBot();
    room = (events.at(-1) as { room: unknown }).room;
    expect(room).toMatchObject({ canStart: true, seats: [{ name: 'Gi' }, { isBot: true }] });
    mock.startGame();
    const last = events.at(-1);
    expect(last?.type).toBe('view');
    if (last?.type === 'view') {
      expect(last.view.phase).toBe('arrange');
      expect(last.view.players.map((p) => p.name)).toEqual(['Gi', 'Bot Zé']);
    }
  });

  it('refuses an empty name with a typed error', () => {
    const mock = new MockConnection();
    const events = collect(mock);
    mock.createRoom({ name: '   ', mode: 'online' });
    expect(events).toEqual([{ type: 'error', error: { code: 'INVALID_NAME', message: 'empty name' } }]);
  });

  it('records the actions it receives and follows the demo script', () => {
    const mock = new MockConnection({ scenario: 'minha-vez', players: 3 });
    const events = collect(mock);
    mock.loadScenario('minha-vez', 3);
    mock.send({ type: 'draw' });
    expect(mock.sentActions()).toEqual([{ type: 'draw' }]);
    expect(mock.currentScenario()).toBe('comprada');
    const last = events.at(-1);
    expect(last?.type === 'view' && last.view.turn?.drawnCard).toBeTruthy();
  });

  it('rejects a malformed action instead of passing it on', () => {
    const mock = new MockConnection();
    const events = collect(mock);
    mock.send({ type: 'swapWithDrawn', slot: -1 } as unknown as Action);
    expect(mock.sentActions()).toEqual([]);
    expect(events[0]).toMatchObject({ type: 'error', error: { code: 'INVALID_ACTION' } });
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
  it('keeps the server clock offset of the last view', () => {
    const mock = new MockConnection({ now: () => 50_000, autoAdvance: false });
    const store = new ConnectionStore(mock, () => 10_000);
    mock.loadScenario('minha-vez', 2);
    expect(store.getSnapshot().clockOffset).toBe(40_000);
    expect(store.getSnapshot().view?.phase).toBe('playing');
  });

  it('remembers the last action sent and exposes errors as notices', () => {
    const mock = new MockConnection({ autoAdvance: false });
    const store = new ConnectionStore(mock);
    store.send({ type: 'callEnd' });
    expect(store.getSnapshot().lastSent).toEqual({ type: 'callEnd' });
    mock.createRoom({ name: '', mode: 'online' });
    const notice = store.getSnapshot().notice;
    expect(notice?.error.code).toBe('INVALID_NAME');
    store.dismissNotice(notice!.id);
    expect(store.getSnapshot().notice).toBeNull();
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
