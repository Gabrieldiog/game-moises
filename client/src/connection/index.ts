import type { ClientConfig } from '../config';
import { MockConnection } from './mock';
import type { GameConnection } from './types';

export type { GameConnection } from './types';

/**
 * Picks the transport. The Socket.IO implementation is written together with
 * the server (it is not part of v0.3), so every build uses the local mock for
 * now, even when VITE_SERVER_URL is set; the UI says so to the player.
 */
export function createConnection(config: ClientConfig): { connection: GameConnection; mock: MockConnection | null } {
  if (config.serverUrl !== null) {
    console.warn('[moises] VITE_SERVER_URL is set, but the Socket.IO transport is not implemented yet; using the local mock.');
  }
  const mock = new MockConnection({
    ...(config.demo?.scenario ? { scenario: config.demo.scenario } : {}),
    ...(config.demo?.players ? { players: config.demo.players } : {}),
    ...(config.demo?.timeScale ? { timeScale: config.demo.timeScale } : {}),
  });
  return { connection: mock, mock };
}
