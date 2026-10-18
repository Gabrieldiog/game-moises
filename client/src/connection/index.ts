import type { ClientConfig } from '../config';
import { MockConnection } from './mock';
import { SocketConnection } from './socket';
import type { GameConnection } from './types';

export type { GameConnection } from './types';

/**
 * Picks the transport:
 * - VITE_SERVER_URL set (and no ?demo=): the real server over Socket.IO;
 * - otherwise: the local demo match (mock), as before. `?demo=<cena>` always
 *   opens the demo, even in a build that has a server URL.
 */
export function createConnection(config: ClientConfig): { connection: GameConnection; mock: MockConnection | null } {
  if (config.serverUrl !== null && config.demo === null) {
    return { connection: new SocketConnection({ url: config.serverUrl }), mock: null };
  }
  const mock = new MockConnection({
    ...(config.demo?.scenario ? { scenario: config.demo.scenario } : {}),
    ...(config.demo?.players ? { players: config.demo.players } : {}),
    ...(config.demo?.timeScale ? { timeScale: config.demo.timeScale } : {}),
  });
  return { connection: mock, mock };
}
