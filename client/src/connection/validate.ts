import {
  PlayerNameInputSchema,
  QuickPlayPayloadSchema,
  RoomCodeSchema,
  TableSettingsSchema,
  type SetTableSettingsPayload,
} from '@moises/shared';
import type { ConnectionError, RequestName } from './types';

// Form checks with the same Zod schemas the server uses, so an obviously bad
// name or code gets a clear message before anything is sent. This is only a
// convenience: the server validates every payload again.

export type Checked<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: ConnectionError };

function refuse(code: ConnectionError['code'], request: RequestName, message: string): { ok: false; error: ConnectionError } {
  return { ok: false, error: { code, request, message } };
}

/** The name as the server will store it (normalized), or INVALID_NAME. */
export function checkName(raw: string, request: RequestName): Checked<string> {
  const parsed = PlayerNameInputSchema.safeParse(raw);
  return parsed.success ? { ok: true, value: parsed.data } : refuse('INVALID_NAME', request, 'invalid name');
}

/** The code in its canonical form (upper case, no spaces around), or INVALID_CODE. */
export function checkCode(raw: string): Checked<string> {
  const parsed = RoomCodeSchema.safeParse(raw);
  return parsed.success ? { ok: true, value: parsed.data } : refuse('INVALID_CODE', 'room:join', 'invalid room code');
}

/** Bot count within the protocol bounds (the room size limit is the server's). */
export function checkBots(bots: number): Checked<number> {
  const parsed = QuickPlayPayloadSchema.shape.bots.safeParse(bots);
  return parsed.success ? { ok: true, value: parsed.data } : refuse('BAD_REQUEST', 'room:quickPlay', 'invalid bot count');
}

/** Table settings in the shape the server accepts (bounds from the shared schema), or BAD_REQUEST. */
export function checkTable(settings: SetTableSettingsPayload): Checked<SetTableSettingsPayload> {
  const parsed = TableSettingsSchema.safeParse(settings);
  return parsed.success ? { ok: true, value: parsed.data } : refuse('BAD_REQUEST', 'room:setTable', 'invalid table settings');
}
