import type {
  Action,
  ClientEventName,
  GameUpdate,
  RoomClosed,
  RoomView,
  ServerErrorCode,
  SetTableSettingsPayload,
} from '@moises/shared';

// Transport contract between the UI and whatever talks to the game server.
// The UI only depends on this interface. Two implementations:
// - SocketConnection (./socket.ts): the real server over Socket.IO (VITE_SERVER_URL);
// - MockConnection (./mock.ts): local demo match, no server (no VITE_SERVER_URL, or ?demo=).
// Room and game data use the official protocol types from @moises/shared.

export type { RoomView } from '@moises/shared';

/**
 * idle: not started; connecting: first connection; connected: ready (session resumed if there was one);
 * reconnecting: lost the connection, trying again by itself; disconnected: gave up (offline,
 * refused by the server); replaced: another tab or device took over this seat.
 */
export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'replaced';

/** Problems detected on this side of the wire (the server never sends these). */
export const CLIENT_ERROR_CODES = [
  /** Not connected to the server right now. */
  'NOT_CONNECTED',
  /** The server did not answer in time. */
  'TIMEOUT',
  /** The name is empty or too long after normalizing (checked with the shared schema before sending). */
  'INVALID_NAME',
  /** The room code does not have the format of a code (shared schema). */
  'INVALID_CODE',
  /** Connection refused: the server is full (connect_error SERVER_FULL). */
  'SERVER_FULL',
  /** Connection refused: too many connections from this address (connect_error TOO_MANY_CONNECTIONS). */
  'TOO_MANY_CONNECTIONS',
] as const;
export type ClientErrorCode = (typeof CLIENT_ERROR_CODES)[number];

export type ConnectionErrorCode = ServerErrorCode | ClientErrorCode;

/** Which request a refusal answers ('connection' for the transport itself). */
export type RequestName = ClientEventName | 'connection';

export interface ConnectionError {
  readonly code: ConnectionErrorCode;
  /** The same code can mean different things for different requests (RATE_LIMITED on room:join...). */
  readonly request: RequestName;
  /** Developer-facing text (English). Players see the Portuguese text for `code`. */
  readonly message: string;
}

export type RequestResult = { readonly ok: true } | { readonly ok: false; readonly error: ConnectionError };

// --- events and interface ---------------------------------------------------

export type ConnectionEvent =
  | { readonly type: 'status'; readonly status: ConnectionStatus }
  /** The room as the server sees it; null = not in a room any more (left, closed, session expired). */
  | { readonly type: 'room'; readonly room: RoomView | null }
  | { readonly type: 'update'; readonly update: GameUpdate }
  | { readonly type: 'error'; readonly error: ConnectionError }
  | { readonly type: 'roomClosed'; readonly info: RoomClosed }
  /** A saved seat could not be resumed (room closed or you left meanwhile). */
  | { readonly type: 'sessionLost' };

export type ConnectionListener = (event: ConnectionEvent) => void;

export interface GameConnection {
  /** Which implementation is behind the interface (shown to the player when it is not a real server). */
  readonly kind: 'mock' | 'socket';
  getStatus(): ConnectionStatus;
  connect(): void;
  disconnect(): void;
  /** Returns an unsubscribe function. */
  subscribe(listener: ConnectionListener): () => void;

  // Requests resolve when the server answered. A refusal is also published as an
  // 'error' event, so callers only need the result to know when to stop waiting.
  createRoom(name: string): Promise<RequestResult>;
  joinRoom(code: string, name: string): Promise<RequestResult>;
  /** "Jogar contra bots": a room with `bots` bots that starts at once. */
  quickPlay(name: string, bots: number): Promise<RequestResult>;
  addBot(): Promise<RequestResult>;
  removeBot(botId: string): Promise<RequestResult>;
  startGame(): Promise<RequestResult>;
  /** "Configurações da mesa" (host only, outside a game). The server validates and answers with a new room:state. */
  setTable(settings: SetTableSettingsPayload): Promise<RequestResult>;
  leaveRoom(): Promise<RequestResult>;

  /** Sends one game action. The server validates everything; the answer arrives as a new update or an error. */
  send(action: Action): Promise<RequestResult>;
}
