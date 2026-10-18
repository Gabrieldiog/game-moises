import type { Action, GameError, GameView, PlayerId } from '@moises/shared';

// Transport contract between the UI and whatever talks to the game server.
// The UI only depends on this interface: today it is backed by a local mock
// (./mock.ts); the Socket.IO implementation plugs in later without UI changes.

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

// --- lobby -------------------------------------------------------------------
// PROVISÓRIO: o protocolo de salas ainda não existe em shared/ (é parte da
// v0.2 do servidor). Estes tipos descrevem o que a tela de lobby precisa; quando
// o servidor publicar os tipos oficiais em @moises/shared, eles substituem estes.
// Tudo que é regra (limites de jogadores, se pode começar) vem do servidor.

export type RoomMode = 'online' | 'bots';

export interface RoomSeat {
  readonly id: PlayerId;
  readonly name: string;
  readonly isBot: boolean;
  readonly isHost: boolean;
  readonly isYou: boolean;
}

export interface RoomView {
  readonly code: string;
  readonly mode: RoomMode;
  /** In seat order. */
  readonly seats: readonly RoomSeat[];
  readonly minPlayers: number;
  readonly maxPlayers: number;
  /** Decided by the server (enough players, you are the host, ...). */
  readonly canStart: boolean;
  /** Decided by the server (free seat, you are the host, ...). */
  readonly canAddBot: boolean;
}

export const LOBBY_ERROR_CODES = [
  'ROOM_NOT_FOUND',
  'ROOM_FULL',
  'GAME_ALREADY_STARTED',
  'NOT_HOST',
  'INVALID_NAME',
  'NOT_CONNECTED',
] as const;
export type LobbyErrorCode = (typeof LOBBY_ERROR_CODES)[number];

export interface LobbyError {
  readonly code: LobbyErrorCode;
  readonly message: string;
}

export type ConnectionError = GameError | LobbyError;

// --- events and interface ---------------------------------------------------

export type ConnectionEvent =
  | { readonly type: 'status'; readonly status: ConnectionStatus }
  | { readonly type: 'room'; readonly room: RoomView | null }
  | { readonly type: 'view'; readonly view: GameView }
  | { readonly type: 'error'; readonly error: ConnectionError };

export type ConnectionListener = (event: ConnectionEvent) => void;

export interface CreateRoomRequest {
  readonly name: string;
  readonly mode: RoomMode;
}

export interface JoinRoomRequest {
  readonly code: string;
  readonly name: string;
}

export interface GameConnection {
  /** Which implementation is behind the interface (shown to the player when it is not a real server). */
  readonly kind: 'mock' | 'socket';
  getStatus(): ConnectionStatus;
  connect(): void;
  disconnect(): void;
  /** Returns an unsubscribe function. */
  subscribe(listener: ConnectionListener): () => void;

  createRoom(request: CreateRoomRequest): void;
  joinRoom(request: JoinRoomRequest): void;
  addBot(): void;
  removeBot(botId: PlayerId): void;
  startGame(): void;
  leaveRoom(): void;

  /** Sends one game action. The server validates everything; the answer arrives as a new view or an error. */
  send(action: Action): void;
}
