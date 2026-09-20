// SPDX-License-Identifier: AGPL-3.0-or-later
// "@anna" instead of an address, through XCHandles (https://docs.xchandles.com/api). A handle is
// a slot in an on-chain registry pointing at an NFT; whoever holds that NFT is paid. Same rules
// as Klimper's resolver (clap-and-pay-wiki/architecture/handles.md).
//
// A handle can fail in ways that are not the person's fault and that read very differently:
// nobody owns it, it lapsed, it owns no NFT to pay, the registry is down. Each gets its own code,
// because "check the spelling" is wrong advice for three of the four.
import { type Bytes, encodeAddress, fromHex } from '@ge/chia';
import { ServiceError } from './types';

const API = 'https://api.xchandles.com';
const BARE_HANDLE = /^[a-z0-9]{3,63}$/;
const PUZZLE_HASH = /^[0-9a-f]{64}$/;
const TIMEOUT_MS = 8000;

/** What a handle stands for, in full. */
export interface ResolvedHandle {
  /** Bare and lowercase, without the `@`. */
  handle: string;
  /** Where the money actually goes. */
  puzzleHash: Bytes;
  /** The same thing as an address, to show the person before they send. */
  address: string;
  /** Unix seconds. */
  expiration: number;
  /** An ownership change is queued on chain: the address may be about to change hands. */
  pendingTransfer: boolean;
}

interface HandleResponse {
  handle?: unknown;
  slot?: { expiration?: unknown };
  resolved_singleton?: { melted?: unknown; nft?: { p2_puzzle_hash?: unknown } | null } | null;
  pending_transfer?: unknown;
}

/** The bare handle for `@anna` or `anna`, or null when it cannot be one. Pure. */
export function parseHandle(input: string): string | null {
  const bare = input.trim().replace(/^@/, '').toLowerCase();
  return BARE_HANDLE.test(bare) ? bare : null;
}

/** Reads the registry's answer. Throws the `ServiceError` that says what is actually wrong. */
export function readHandle(
  handle: string,
  data: HandleResponse | null,
  prefix: string,
  nowSeconds: number,
): ResolvedHandle {
  if (data === null || data.handle !== handle) throw new ServiceError('handle_not_found');

  const expiration = data.slot?.expiration;
  if (typeof expiration !== 'number' || !Number.isFinite(expiration)) {
    throw new ServiceError('handle_not_found');
  }
  if (expiration <= nowSeconds) throw new ServiceError('handle_expired');

  // Melted, missing, or pointing at no payable puzzle: the name exists but cannot take money.
  const singleton = data.resolved_singleton;
  const puzzleHash = singleton?.nft?.p2_puzzle_hash;
  if (
    singleton === null ||
    singleton === undefined ||
    singleton.melted !== false ||
    typeof puzzleHash !== 'string' ||
    !PUZZLE_HASH.test(puzzleHash)
  ) {
    throw new ServiceError('handle_not_payable');
  }

  const bytes = fromHex(puzzleHash);
  return {
    handle,
    puzzleHash: bytes,
    address: encodeAddress(bytes, prefix),
    expiration,
    pendingTransfer: data.pending_transfer != null && data.pending_transfer !== false,
  };
}

/** Looks a handle up in the registry. Throws `ServiceError` with the reason. */
export async function resolveHandle(
  input: string,
  prefix: string,
  fetchFn: typeof fetch,
  nowSeconds: number,
): Promise<ResolvedHandle> {
  const handle = parseHandle(input);
  if (handle === null) throw new ServiceError('invalid_recipient');

  let response: Response;
  try {
    response = await fetchFn(`${API}/handle/${handle}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new ServiceError('handles_unavailable');
  }
  if (response.status === 404 || response.status === 410) {
    throw new ServiceError('handle_not_found');
  }
  if (response.status === 400) throw new ServiceError('invalid_recipient');
  if (!response.ok) throw new ServiceError('handles_unavailable');

  const data = (await response.json().catch(() => null)) as HandleResponse | null;
  return readHandle(handle, data, prefix, nowSeconds);
}
