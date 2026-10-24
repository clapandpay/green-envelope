// SPDX-License-Identifier: AGPL-3.0-or-later
// Local development entry: `node --experimental-strip-types src/node.ts`. Serves the built web
// app (`apps/web/dist`) and the preview images (`apps/edge/assets`) as static assets.
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { registerHooks } from 'node:module';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};
const ASSET_ROOTS = ['../../web/dist', '../assets'].map((relative) =>
  fileURLToPath(new URL(relative, import.meta.url)),
);
// Larger than the proxy's limit on purpose: the handler is what enforces and reports it.
const MAX_BUFFERED_BODY = 1024 * 1024;

// The workspace imports its TypeScript sources without file extensions, which Node does not
// resolve by itself: retry a failed relative import as `.ts`, then as `/index.ts`.
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (!specifier.startsWith('.')) throw error;
      try {
        return nextResolve(`${specifier}.ts`, context);
      } catch {
        return nextResolve(`${specifier}/index.ts`, context);
      }
    }
  },
});

async function readAsset(root: string, path: string): Promise<Response | null> {
  const file = normalize(join(root, path));
  if (!file.startsWith(root + sep)) return null;
  const bytes = await readFile(file).catch(() => null);
  if (bytes === null) return null;
  const type = CONTENT_TYPES[extname(file)] ?? 'application/octet-stream';
  return new Response(new Uint8Array(bytes), {
    headers: { 'content-type': type, 'cache-control': 'no-cache' },
  });
}

/** Static assets from the local build output; `/` is `index.html`, as on the asset hosts. */
async function assets(request: Request): Promise<Response> {
  const { pathname } = new URL(request.url);
  const path = decodeURIComponent(pathname.endsWith('/') ? `${pathname}index.html` : pathname);
  for (const root of ASSET_ROOTS) {
    const response = await readAsset(root, path);
    if (response !== null) return response;
  }
  return new Response('not found', { status: 404 });
}

async function readBody(message: IncomingMessage): Promise<Uint8Array<ArrayBuffer> | null> {
  if (message.method === 'GET' || message.method === 'HEAD') return null;
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of message) {
    const buffer: Buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    total += buffer.length;
    if (total > MAX_BUFFERED_BODY) break;
    chunks.push(buffer);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

async function toRequest(message: IncomingMessage): Promise<Request> {
  const url = new URL(message.url ?? '/', `http://${message.headers.host ?? 'localhost'}`);
  const headers = new Headers();
  for (const [name, value] of Object.entries(message.headers)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }
  return new Request(url, {
    method: message.method ?? 'GET',
    headers,
    body: await readBody(message),
  });
}

async function send(response: Response, out: ServerResponse): Promise<void> {
  out.writeHead(response.status, Object.fromEntries(response.headers));
  out.end(Buffer.from(await response.arrayBuffer()));
}

const { handlerFromEnv } = await import('./index');
const handler = handlerFromEnv({
  CHAIN_ENDPOINTS: process.env.CHAIN_ENDPOINTS,
  CHAIN_API_KEY: process.env.CHAIN_API_KEY,
  PUBLIC_CHAIN_ENDPOINTS: process.env.PUBLIC_CHAIN_ENDPOINTS,
  PUBLIC_CHAIN_API_KEY: process.env.PUBLIC_CHAIN_API_KEY,
  NETWORK: process.env.NETWORK,
  PUBLIC_ORIGIN: process.env.PUBLIC_ORIGIN,
  BASE_URL: process.env.BASE_URL,
  TYPESAFE_API_KEY: process.env.TYPESAFE_API_KEY,
  ASSETS: { fetch: assets },
});
// `PORT` when it is set. Without it: 80, which is what ONCE (once.com) and most one-click hosts
// expect, and 8787 as well, the port this image has always used, so a reverse proxy set up for
// it keeps working. Docker lets a non-root user bind port 80 inside a container.
const ports = process.env.PORT === undefined ? [80, 8787] : [Number(process.env.PORT)];

for (const port of ports) {
  createServer((message, out) => {
    toRequest(message)
      .then(handler)
      .then((response) => send(response, out))
      .catch(() => {
        out.writeHead(400).end();
      });
  })
    .on('error', (error) => {
      // A second, optional port that cannot be had (outside Docker, port 80 needs root) is not
      // a reason to stop serving on the other one.
      if (ports.length > 1) console.warn(`edge: not listening on ${port}: ${error.message}`);
      else throw error;
    })
    .listen(port, () => {
      console.log(`edge: http://localhost:${port}`);
    });
}
