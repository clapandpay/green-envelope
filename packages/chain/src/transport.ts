// SPDX-License-Identifier: AGPL-3.0-or-later
// POST JSON with a timeout, endpoint fallback, and a memory of the last healthy endpoint.
import { ChainError, type ChainErrorCode } from './errors';
import { isJsonObject, type JsonObject, nodeFailure, parseBody } from './parse';

/** What a call decides about a `success: false` body: a value, a definitive error, or `null` = try the next endpoint. */
export type NodeErrorDecision<T> = { value: T } | ChainError | null;

/** One RPC call: what to send and how to read the answer. */
export interface RpcCall<T> {
  method: string;
  body: unknown;
  /** Turns a successful body into the result; throws `ChainError('bad_response')` on a wrong shape. */
  parse(body: JsonObject): T;
  /** Interprets the node's error text. Default: not definitive, try the next endpoint. */
  onNodeError?(detail: string): NodeErrorDecision<T>;
}

/** Sends RPC calls over the configured endpoints. */
export interface Transport {
  call<T>(rpc: RpcCall<T>): Promise<T>;
}

/** Options of `createTransport`; the same as the public client options. */
export interface TransportOptions {
  endpoints: string[];
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** `Authorization: Bearer` for the first endpoint only (a node that wants a key). */
  apiKey?: string | null;
}

/** Default per-request timeout in milliseconds. */
export const DEFAULT_TIMEOUT_MS = 8000;

// When every endpoint failed, report the most informative failure.
const RANK: Readonly<Record<ChainErrorCode, number>> = {
  network: 0,
  bad_response: 1,
  rejected: 2,
  unknown_coin: 3,
  double_spend: 3,
};

function moreInformative(a: ChainError | null, b: ChainError): ChainError {
  return a !== null && RANK[a.code] > RANK[b.code] ? a : b;
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Creates the transport. Endpoints are base URLs; trailing slashes are ignored. */
export function createTransport(opts: TransportOptions): Transport {
  const endpoints = opts.endpoints.map((e) => e.replace(/\/+$/, ''));
  if (endpoints.length === 0 || endpoints.some((e) => e === '')) {
    throw new TypeError('createChainClient needs at least one non-empty endpoint');
  }
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const injected = opts.fetch;
  // Never call a detached `window.fetch`: browsers throw "Illegal invocation".
  const doFetch: typeof fetch = injected ?? ((input, init) => globalThis.fetch(input, init));
  let healthy = 0;

  async function post(base: string, method: string, payload: string): Promise<JsonObject> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let status: number;
      let text: string;
      try {
        const keyed =
          base === endpoints[0] && opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {};
        const response = await doFetch(`${base}/${method}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json', ...keyed },
          body: payload,
          signal: controller.signal,
        });
        status = response.status;
        text = await response.text(); // still under the timeout
      } catch (cause) {
        const why = controller.signal.aborted ? `timed out after ${timeoutMs} ms` : describe(cause);
        throw new ChainError('network', `${base}: ${why}`);
      }
      if (status >= 500) throw new ChainError('network', `${base}: HTTP ${status}`);
      if (status >= 200 && status < 300) return parseBody(text);
      // Other statuses (400, 429, ...): only a node-style `success: false` body is meaningful.
      let body: unknown = null;
      try {
        body = parseBody(text);
      } catch {
        // not JSON: handled below
      }
      if (isJsonObject(body) && nodeFailure(body) !== null) return body;
      throw new ChainError('network', `${base}: HTTP ${status}`);
    } finally {
      clearTimeout(timer);
    }
  }

  async function call<T>(rpc: RpcCall<T>): Promise<T> {
    const payload = JSON.stringify(rpc.body);
    const first = healthy;
    let worst: ChainError | null = null;
    for (let step = 0; step < endpoints.length; step++) {
      // The last healthy endpoint first, then the others in their configured order.
      const index = step === 0 ? first : step <= first ? step - 1 : step;
      const base = endpoints[index];
      if (base === undefined) continue;
      try {
        const body = await post(base, rpc.method, payload);
        const failure = nodeFailure(body);
        if (failure === null) {
          const value = rpc.parse(body);
          healthy = index;
          return value;
        }
        const decision = rpc.onNodeError?.(failure) ?? null;
        if (decision !== null) {
          healthy = index; // a node that gives a definitive answer is a working node
          if (decision instanceof ChainError) throw decision;
          return decision.value;
        }
        worst = moreInformative(worst, new ChainError('rejected', failure));
      } catch (error) {
        if (!(error instanceof ChainError)) throw error;
        if (error.code !== 'network' && error.code !== 'bad_response') throw error; // definitive
        worst = moreInformative(worst, error);
      }
    }
    throw worst ?? new ChainError('network', 'no endpoint answered');
  }

  return { call };
}
