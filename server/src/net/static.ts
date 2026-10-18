import { createReadStream, statSync, type Stats } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';

// Serves the built client (client/dist) from the same origin as the game
// server, so production needs a single port. Read-only: GET and HEAD only,
// no directory listings, no dotfiles, nothing outside the root.

const MIME: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

/**
 * Same-origin policy of the app: scripts and styles from the page's own
 * origin (React sets inline style attributes, hence 'unsafe-inline' for
 * styles only), images/fonts may be data: URIs, Socket.IO connects back to
 * the same origin (HTTP and WebSocket), nothing may frame the page.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

function fileStats(path: string): Stats | null {
  try {
    const stats = statSync(path);
    return stats.isFile() ? stats : null;
  } catch {
    return null;
  }
}

export type StaticHandler = (req: IncomingMessage, res: ServerResponse, pathname: string) => boolean;

/**
 * Returns a handler that answers the request and returns true, or returns
 * false when it is not a static request (so the caller answers 404).
 * Throws at startup if `dir` has no index.html (fail fast).
 */
export function createStaticHandler(dir: string): StaticHandler {
  const root = resolve(dir);
  const indexPath = join(root, 'index.html');
  if (!fileStats(indexPath)) throw new Error(`STATIC_DIR "${dir}" has no index.html (run "npm run build" first)`);

  const send = (req: IncomingMessage, res: ServerResponse, path: string, stats: Stats, cache: string): void => {
    const etag = `W/"${stats.size.toString(16)}-${Math.floor(stats.mtimeMs).toString(16)}"`;
    const headers = {
      ...SECURITY_HEADERS,
      'Content-Type': MIME[extname(path).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': cache,
      ETag: etag,
    };
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers);
      res.end();
      return;
    }
    res.writeHead(200, { ...headers, 'Content-Length': stats.size });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    const stream = createReadStream(path);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  };

  const notFound = (req: IncomingMessage, res: ServerResponse): void => {
    const body = JSON.stringify({ error: 'NOT_FOUND' });
    res.writeHead(404, {
      ...SECURITY_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  };

  return (req, res, pathname) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;

    let decoded: string;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      notFound(req, res);
      return true;
    }
    // Never serve dotfiles, NUL bytes or backslashes.
    if (decoded.includes('\0') || decoded.includes('\\') || decoded.split('/').some((part) => part.startsWith('.'))) {
      notFound(req, res);
      return true;
    }

    const target = resolve(root, `.${decoded}`);
    if (target !== root && !target.startsWith(root + sep)) {
      notFound(req, res);
      return true;
    }

    const isIndex = target === root || target === indexPath;
    const stats = isIndex ? null : fileStats(target);
    if (stats) {
      // Vite emits content-hashed files under /assets/: safe to cache forever.
      const hashed = decoded.startsWith('/assets/');
      send(req, res, target, stats, hashed ? 'public, max-age=31536000, immutable' : 'public, max-age=3600');
      return true;
    }

    // A path with a file extension that does not exist is a real 404; any other
    // path is a client-side route and gets the app shell (never cached).
    if (!isIndex && extname(decoded) !== '') {
      notFound(req, res);
      return true;
    }
    const index = fileStats(indexPath);
    if (!index) {
      notFound(req, res);
      return true;
    }
    send(req, res, indexPath, index, 'no-store');
    return true;
  };
}
