// SPDX-License-Identifier: AGPL-3.0-or-later
// Request bodies hold spend bundles and addresses: nothing in this module logs them.

/** Proxies one allow-listed RPC call; the caller has already checked the HTTP method. */
export type RpcProxy = (method: string, request: Request) => Promise<Response>;

/** Dependencies of `createRpcProxy`. */
export interface RpcDeps {
  readonly fetch: typeof fetch;
  /** Coinset-compatible base URLs without a trailing slash, tried in order. */
  readonly endpoints: readonly string[];
}

/** The full-node RPC methods the app needs; everything else is refused. */
export const RPC_METHODS: ReadonlySet<string> = new Set([
  'get_coin_records_by_puzzle_hashes',
  'get_coin_record_by_name',
  'get_coin_records_by_hint',
  'get_coin_records_by_parent_ids',
  'get_blockchain_state',
  'push_tx',
]);
/** Largest accepted request body. */
export const MAX_BODY_BYTES = 256 * 1024;
/** Timeout of one attempt against one endpoint. */
export const RPC_TIMEOUT_MS = 8000;

const JSON_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' } as const;

/** A JSON error in the shape of a full-node answer, so clients parse one format. */
export function rpcError(status: number, error: string): Response {
  return new Response(JSON.stringify({ success: false, error }), { status, headers: JSON_HEADERS });
}

/** True when the request declares a JSON body. */
export function isJsonContentType(request: Request): boolean {
  const type = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  return type === 'application/json';
}

function declaredLength(request: Request): number {
  const value = Number(request.headers.get('content-length') ?? '0');
  return Number.isFinite(value) ? value : 0;
}

function joinChunks(chunks: readonly Uint8Array[], total: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** Reads the body, giving up as soon as it exceeds `limit`; `null` means too large. */
export async function readLimitedBody(
  request: Request,
  limit: number,
): Promise<Uint8Array<ArrayBuffer> | null> {
  if (declaredLength(request) > limit) return null;
  if (request.body === null) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return joinChunks(chunks, total);
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
}

function isJsonObject(bytes: Uint8Array): boolean {
  try {
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  } catch {
    return false;
  }
}

// A node that answers `{"success": …}` has decided, whatever the HTTP status says.
function isNodeVerdict(text: string): boolean {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null && 'success' in value;
  } catch {
    return false;
  }
}

function passThrough(body: BodyInit | null, status: number): Response {
  return new Response(body, { status, headers: JSON_HEADERS });
}

/** Creates the proxy: allow-list, JSON only, 256 kB, 8 s per endpoint, fallback on transport failure or 5xx. */
export function createRpcProxy(deps: RpcDeps): RpcProxy {
  const attempt = async (url: string, body: Uint8Array<ArrayBuffer>): Promise<Response | null> =>
    deps
      .fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
      })
      .catch(() => null);

  // `push_tx` must not reach a second node once the first has given its verdict. A transport
  // failure is not a verdict, and pushing the identical bundle again is idempotent on Chia.
  const settle = async (method: string, response: Response): Promise<Response | null> => {
    if (response.status < 500) return passThrough(response.body, response.status);
    if (method !== 'push_tx') {
      await response.body?.cancel();
      return null;
    }
    const text = await response.text().catch(() => null);
    return text !== null && isNodeVerdict(text) ? passThrough(text, response.status) : null;
  };

  return async (method, request) => {
    if (!RPC_METHODS.has(method)) return rpcError(404, 'method_not_allowed');
    if (!isJsonContentType(request)) return rpcError(415, 'json_required');
    const body = await readLimitedBody(request, MAX_BODY_BYTES);
    if (body === null) return rpcError(413, 'body_too_large');
    if (!isJsonObject(body)) return rpcError(400, 'bad_json');

    for (const base of deps.endpoints) {
      const response = await attempt(`${base}/${method}`, body);
      const settled = response === null ? null : await settle(method, response);
      if (settled !== null) return settled;
    }
    return rpcError(502, 'upstream_unavailable');
  };
}
