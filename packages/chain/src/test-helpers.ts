// SPDX-License-Identifier: AGPL-3.0-or-later
// A scripted fake `fetch` for the tests in this package.

/** One recorded request. */
export interface SeenRequest {
  url: string;
  method: string | undefined;
  body: unknown;
  contentType: string | null;
}

/** What the fake answers for one request: a response, or a function that throws or hangs. */
export type Reply = Response | ((signal: AbortSignal | null) => Promise<Response>);

/** A JSON response with the given status. */
export function json(body: unknown, status = 200): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
}

/** A reply that fails like an unreachable host. */
export const unreachable: Reply = () => Promise.reject(new TypeError('fetch failed'));

/** A reply that never answers until the request is aborted. */
export const hangs: Reply = (signal) =>
  new Promise((_, reject) => {
    signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  });

/** A fake fetch that routes by URL prefix and records every request. */
export function fakeFetch(routes: Record<string, Reply | Reply[]>): {
  fetch: typeof fetch;
  seen: SeenRequest[];
} {
  const seen: SeenRequest[] = [];
  const counters = new Map<string, number>();
  const fetchFn: typeof fetch = async (input, init) => {
    const url = String(input);
    const rawBody = init?.body;
    seen.push({
      url,
      method: init?.method,
      body: typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody,
      contentType: new Headers(init?.headers).get('content-type'),
    });
    const prefix = Object.keys(routes).find((p) => url.startsWith(p));
    const route = prefix === undefined ? undefined : routes[prefix];
    if (prefix === undefined || route === undefined) throw new TypeError(`no route for ${url}`);
    let reply: Reply | undefined;
    if (Array.isArray(route)) {
      const n = counters.get(prefix) ?? 0;
      counters.set(prefix, n + 1);
      reply = route[Math.min(n, route.length - 1)];
    } else {
      reply = route;
    }
    if (reply === undefined) throw new TypeError(`no reply for ${url}`);
    return typeof reply === 'function' ? reply(init?.signal ?? null) : reply.clone();
  };
  return { fetch: fetchFn, seen };
}
