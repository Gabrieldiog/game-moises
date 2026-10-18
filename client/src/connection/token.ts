import { SESSION_TOKEN_PATTERN } from '@moises/shared';

// The session token is the only way back into a seat after a reload or a
// dropped connection. It is kept per tab (sessionStorage), as docs/PROTOCOLO.md
// recommends, and never goes into the URL or a log. Storage can be missing or
// throw (private mode, blocked site data): then the seat simply cannot be
// resumed after a reload, and everything else keeps working.

export interface TokenStore {
  load(): string | null;
  save(token: string): void;
  clear(): void;
}

export const SESSION_TOKEN_KEY = 'moises.sessao';

export function sessionTokenStore(key: string = SESSION_TOKEN_KEY): TokenStore {
  return {
    load() {
      try {
        const token = window.sessionStorage.getItem(key);
        return token !== null && SESSION_TOKEN_PATTERN.test(token) ? token : null;
      } catch {
        return null;
      }
    },
    save(token) {
      try {
        window.sessionStorage.setItem(key, token);
      } catch {
        // Without storage the seat only survives while this page stays open.
      }
    },
    clear() {
      try {
        window.sessionStorage.removeItem(key);
      } catch {
        // Nothing to clear.
      }
    },
  };
}

/** In-memory store (tests, or when the page must not touch storage). */
export function memoryTokenStore(initial: string | null = null): TokenStore & { current(): string | null } {
  let token = initial;
  return {
    load: () => token,
    save: (value) => {
      token = value;
    },
    clear: () => {
      token = null;
    },
    current: () => token,
  };
}
