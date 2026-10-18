import { io } from 'socket.io-client';
import {
  CONNECTION_ERROR_MESSAGES,
  type Action,
  type ClientEventName,
  type ClientToServerEvents,
  type ConnectionErrorMessage,
  type JoinedRoom,
  type RoomView,
  type ServerToClientEvents,
} from '@moises/shared';
import { REQUEST_TIMEOUT_MS } from '../ui/constants';
import { sessionTokenStore, type TokenStore } from './token';
import type {
  ConnectionError,
  ConnectionErrorCode,
  ConnectionEvent,
  ConnectionListener,
  ConnectionStatus,
  GameConnection,
  RequestName,
  RequestResult,
} from './types';
import { checkBots, checkCode, checkName } from './validate';

// The real transport: Socket.IO to the game server at VITE_SERVER_URL, with the
// typed events of @moises/shared (docs/PROTOCOLO.md). This class only moves
// messages and keeps the session token; every decision (who you are, what is
// allowed, what happened in the game) comes from the server.

type Payload<E extends ClientEventName> = Parameters<ClientToServerEvents[E]>[0];
/** The Ack<T> the server answers for event E. */
type AckOf<E extends ClientEventName> = Parameters<Parameters<ClientToServerEvents[E]>[1]>[0];
type DataOf<E extends ClientEventName> = Extract<AckOf<E>, { ok: true }>['data'];

type Result<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: ConnectionError };

/**
 * The part of a socket.io-client Socket this class uses. The real one comes from
 * `io()`; tests pass a fake with the same shape.
 */
export interface SocketLike {
  readonly connected: boolean;
  /** True while the socket is open or trying to reconnect by itself. */
  readonly active: boolean;
  connect(): unknown;
  disconnect(): unknown;
  on<E extends keyof ServerToClientEvents>(event: E, listener: ServerToClientEvents[E]): unknown;
  on(event: 'connect', listener: () => void): unknown;
  on(event: 'disconnect', listener: (reason: string) => void): unknown;
  on(event: 'connect_error', listener: (error: Error) => void): unknown;
  timeout(ms: number): {
    emitWithAck<E extends ClientEventName>(event: E, payload: Payload<E>): Promise<AckOf<E>>;
  };
}

export interface SocketConnectionOptions {
  /** VITE_SERVER_URL. */
  readonly url: string;
  readonly tokens?: TokenStore;
  readonly createSocket?: (url: string) => SocketLike;
  readonly requestTimeoutMs?: number;
}

function defaultSocket(url: string): SocketLike {
  // WebSocket only, as docs/PROTOCOLO.md shows; reconnection is socket.io's own
  // (it retries forever with backoff). We open it ourselves in connect().
  // The typed client Socket has the same methods; its overloads are only wider than SocketLike's.
  return io(url, { transports: ['websocket'], autoConnect: false }) as unknown as SocketLike;
}

function isRefusal(message: string): message is ConnectionErrorMessage {
  return (CONNECTION_ERROR_MESSAGES as readonly string[]).includes(message);
}

function failure(code: ConnectionErrorCode, request: RequestName, message: string): { ok: false; error: ConnectionError } {
  return { ok: false, error: { code, request, message } };
}

export class SocketConnection implements GameConnection {
  readonly kind = 'socket' as const;
  private readonly socket: SocketLike;
  private readonly tokens: TokenStore;
  private readonly timeoutMs: number;
  private readonly listeners = new Set<ConnectionListener>();
  private status: ConnectionStatus = 'idle';
  private room: RoomView | null = null;
  /** Kept in memory too, so a dropped connection can resume even when storage is blocked. */
  private token: string | null;
  private everConnected = false;
  private replaced = false;
  private lastRefusal: ConnectionErrorMessage | null = null;

  constructor(options: SocketConnectionOptions) {
    this.tokens = options.tokens ?? sessionTokenStore();
    this.timeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
    this.token = this.tokens.load();
    this.socket = (options.createSocket ?? defaultSocket)(options.url);

    this.socket.on('connect', () => void this.onConnect());
    this.socket.on('disconnect', () => this.onDisconnect());
    this.socket.on('connect_error', (error) => this.onConnectError(error));
    this.socket.on('room:state', (room) => this.setRoom(room));
    this.socket.on('game:update', (update) => this.emit({ type: 'update', update }));
    this.socket.on('room:closed', (info) => {
      this.forgetSession();
      this.setRoom(null);
      this.emit({ type: 'roomClosed', info });
    });
    this.socket.on('session:replaced', () => {
      // The server disconnects this socket right after; it does not come back by itself.
      this.replaced = true;
      this.setStatus('replaced');
    });
  }

  // --- GameConnection ---------------------------------------------------------

  getStatus(): ConnectionStatus {
    return this.status;
  }

  /** Opens the connection; after a refusal, a server disconnect or "replaced", tries again (and takes the seat back). */
  connect(): void {
    if (this.socket.connected || (this.socket.active && !this.replaced)) return;
    this.replaced = false;
    this.lastRefusal = null;
    this.setStatus(this.everConnected ? 'reconnecting' : 'connecting');
    this.socket.connect();
  }

  disconnect(): void {
    this.socket.disconnect();
    this.setStatus('disconnected');
  }

  subscribe(listener: ConnectionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  createRoom(name: string): Promise<RequestResult> {
    const checked = checkName(name, 'room:create');
    if (!checked.ok) return Promise.resolve(this.refused(checked.error));
    return this.call('room:create', { name: checked.value }, (joined) => this.joined(joined));
  }

  joinRoom(code: string, name: string): Promise<RequestResult> {
    const checkedName = checkName(name, 'room:join');
    if (!checkedName.ok) return Promise.resolve(this.refused(checkedName.error));
    const checkedCode = checkCode(code);
    if (!checkedCode.ok) return Promise.resolve(this.refused(checkedCode.error));
    return this.call('room:join', { code: checkedCode.value, name: checkedName.value }, (joined) => this.joined(joined));
  }

  quickPlay(name: string, bots: number): Promise<RequestResult> {
    const checkedName = checkName(name, 'room:quickPlay');
    if (!checkedName.ok) return Promise.resolve(this.refused(checkedName.error));
    const checkedBots = checkBots(bots);
    if (!checkedBots.ok) return Promise.resolve(this.refused(checkedBots.error));
    return this.call('room:quickPlay', { name: checkedName.value, bots: checkedBots.value }, (joined) => this.joined(joined));
  }

  addBot(): Promise<RequestResult> {
    return this.call('room:addBot', {});
  }

  removeBot(botId: string): Promise<RequestResult> {
    return this.call('room:removeBot', { playerId: botId });
  }

  startGame(): Promise<RequestResult> {
    return this.call('room:start', {});
  }

  async leaveRoom(): Promise<RequestResult> {
    const result = await this.request('room:leave', {});
    // NOT_IN_ROOM: the server already forgot this seat, so leaving locally is right too.
    if (result.ok || result.error.code === 'NOT_IN_ROOM') {
      this.forgetSession();
      this.setRoom(null);
      return { ok: true };
    }
    return this.refused(result.error);
  }

  send(action: Action): Promise<RequestResult> {
    return this.call('game:action', action);
  }

  // --- internals ----------------------------------------------------------------

  private async onConnect(): Promise<void> {
    this.everConnected = true;
    this.lastRefusal = null;
    const token = this.token;
    if (token !== null) {
      // Back into the seat; the server answers with the room and then a full game snapshot.
      const resumed = await this.request('session:resume', { token });
      if (resumed.ok) {
        this.setRoom(resumed.data.room);
      } else if (resumed.error.code === 'INVALID_SESSION') {
        this.forgetSession();
        this.setRoom(null);
        this.emit({ type: 'sessionLost' });
      } else {
        // Try again on the next connection; meanwhile this socket is not seated.
        this.setRoom(null);
        this.emit({ type: 'error', error: resumed.error });
      }
    } else if (this.room !== null) {
      this.setRoom(null);
      this.emit({ type: 'sessionLost' });
    }
    if (this.socket.connected && !this.replaced) this.setStatus('connected');
  }

  private onDisconnect(): void {
    if (this.replaced) {
      this.setStatus('replaced');
      return;
    }
    this.setStatus(this.socket.active ? 'reconnecting' : 'disconnected');
  }

  private onConnectError(error: Error): void {
    const refusal = isRefusal(error.message) ? error.message : null;
    if (refusal !== null && refusal !== this.lastRefusal) {
      this.emit({ type: 'error', error: { code: refusal, request: 'connection', message: refusal.toLowerCase() } });
    }
    this.lastRefusal = refusal;
    if (!this.socket.active) this.setStatus('disconnected');
    else this.setStatus(this.everConnected ? 'reconnecting' : 'connecting');
  }

  private joined(joined: JoinedRoom): void {
    this.token = joined.token;
    this.tokens.save(joined.token);
    this.setRoom(joined.room);
  }

  private forgetSession(): void {
    this.token = null;
    this.tokens.clear();
  }

  /** Sends a request; a refusal is also published as an 'error' event. */
  private async call<E extends ClientEventName>(
    event: E,
    payload: Payload<E>,
    onOk?: (data: DataOf<E>) => void,
  ): Promise<RequestResult> {
    const result = await this.request(event, payload);
    if (!result.ok) return this.refused(result.error);
    onOk?.(result.data);
    return { ok: true };
  }

  private async request<E extends ClientEventName>(event: E, payload: Payload<E>): Promise<Result<DataOf<E>>> {
    // Never let socket.io buffer a request while offline: it would reach the
    // server after reconnecting, before the session is resumed.
    if (!this.socket.connected) return failure('NOT_CONNECTED', event, 'not connected');
    let ack: AckOf<E>;
    try {
      ack = await this.socket.timeout(this.timeoutMs).emitWithAck(event, payload);
    } catch {
      return this.socket.connected ? failure('TIMEOUT', event, 'no answer in time') : failure('NOT_CONNECTED', event, 'disconnected');
    }
    if (ack.ok) return { ok: true, data: ack.data as DataOf<E> };
    return failure(ack.error.code, event, ack.error.message);
  }

  private refused(error: ConnectionError): RequestResult {
    this.emit({ type: 'error', error });
    return { ok: false, error };
  }

  private setRoom(room: RoomView | null): void {
    this.room = room;
    this.emit({ type: 'room', room });
  }

  private setStatus(status: ConnectionStatus): void {
    if (status === this.status) return;
    this.status = status;
    this.emit({ type: 'status', status });
  }

  private emit(event: ConnectionEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
