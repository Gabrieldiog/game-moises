import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, connect, startServer } from './support/net.js';
import { createGameServer } from '../src/net/server.js';
import { fastRules } from './support/net.js';
import { testConfig } from './support/fakes.js';

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'moises-static-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Moises</title>');
  writeFileSync(join(dir, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  writeFileSync(join(dir, 'assets', 'index-abc123.js'), 'console.log(1)');
  writeFileSync(join(dir, '.secret'), 'x');
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));
afterEach(cleanup);

/** Raw request, so the path reaches the server exactly as written (fetch normalises "..").*/
function raw(url: string, path: string): Promise<{ status: number; body: string }> {
  const { hostname, port } = new URL(url);
  return new Promise((resolve, reject) => {
    const req = request({ hostname, port, path, method: 'GET' }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('static client', () => {
  it('is off by default', async () => {
    const { url } = await startServer();
    expect((await fetch(`${url}/`)).status).toBe(404);
  });

  it('serves index.html with no-store and security headers', async () => {
    const { url } = await startServer({ staticDir: dir });
    const res = await fetch(`${url}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Moises');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBeTruthy();
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("'unsafe-eval'");
  });

  it('caches hashed assets as immutable and other files briefly, with ETag/304', async () => {
    const { url } = await startServer({ staticDir: dir });
    const asset = await fetch(`${url}/assets/index-abc123.js`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(asset.headers.get('content-type')).toContain('text/javascript');
    const icon = await fetch(`${url}/favicon.svg`);
    expect(icon.headers.get('cache-control')).toBe('public, max-age=3600');
    expect(icon.headers.get('content-type')).toBe('image/svg+xml');
    const again = await fetch(`${url}/favicon.svg`, { headers: { 'if-none-match': icon.headers.get('etag') ?? '' } });
    expect(again.status).toBe(304);
    const head = await fetch(`${url}/favicon.svg`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
  });

  it('falls back to the app shell for routes, 404 for missing files', async () => {
    const { url } = await startServer({ staticDir: dir });
    const route = await fetch(`${url}/sala/ABC234`);
    expect(route.status).toBe(200);
    expect(route.headers.get('cache-control')).toBe('no-store');
    expect((await fetch(`${url}/assets/missing.js`)).status).toBe(404);
    expect((await fetch(`${url}/index.html`)).headers.get('cache-control')).toBe('no-store');
  });

  it('refuses traversal, dotfiles and non-GET methods', async () => {
    const { url } = await startServer({ staticDir: dir });
    for (const path of ['/../package.json', '/%2e%2e/package.json', '/assets/../../package.json', '/.secret', '/%00', '/%E0%A4%A']) {
      const res = await raw(url, path);
      expect(res.status, path).toBe(404);
      expect(res.body, path).not.toContain('moises');
    }
    expect((await fetch(`${url}/`, { method: 'POST' })).status).toBe(404);
  });

  it('keeps /health and Socket.IO working on the same port', async () => {
    const { url } = await startServer({ staticDir: dir });
    expect(await (await fetch(`${url}/health`)).json()).toEqual({ status: 'ok' });
    const client = await connect(url);
    expect(client.connected).toBe(true);
  });

  it('fails fast when the folder has no index.html', () => {
    expect(() => createGameServer({ config: testConfig({ staticDir: tmpdir() }), rules: fastRules() })).toThrow(/index\.html/);
  });
});
