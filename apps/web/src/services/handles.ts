// SPDX-License-Identifier: AGPL-3.0-or-later
// "@anna" instead of an address, through XCHandles (https://docs.xchandles.com/api). A handle
// points to an NFT; whoever holds that NFT is paid. Same rules as Klimper's resolver
// (clap-and-pay-wiki/architecture/handles.md).
import { type Bytes, fromHex } from '@ge/chia';
import { ServiceError } from './types';

const API = 'https://api.xchandles.com';
const HANDLE = /^[a-z0-9]{3,63}$/;

interface HandleResponse {
  handle?: unknown;
  slot?: { expiration?: unknown };
  resolved_singleton?: { melted?: unknown; nft?: { p2_puzzle_hash?: unknown } | null } | null;
}

/** The puzzle hash a handle pays to. Throws `ServiceError('invalid_recipient')` or `('network')`. */
export async function resolveHandle(input: string, fetchFn: typeof fetch): Promise<Bytes> {
  const handle = input.trim().replace(/^@/, '').toLowerCase();
  if (!HANDLE.test(handle)) throw new ServiceError('invalid_recipient');

  let response: Response;
  try {
    response = await fetchFn(`${API}/handle/${handle}`, { signal: AbortSignal.timeout(8000) });
  } catch {
    throw new ServiceError('network');
  }
  if (response.status === 400 || response.status === 404 || response.status === 410) {
    throw new ServiceError('invalid_recipient');
  }
  if (!response.ok) throw new ServiceError('network');

  const data = (await response.json().catch(() => null)) as HandleResponse | null;
  const puzzleHash = data?.resolved_singleton?.nft?.p2_puzzle_hash;
  const expiration = data?.slot?.expiration;
  if (
    data?.handle !== handle ||
    data.resolved_singleton?.melted !== false ||
    typeof puzzleHash !== 'string' ||
    !/^[0-9a-f]{64}$/.test(puzzleHash) ||
    typeof expiration !== 'number' ||
    expiration * 1000 <= Date.now()
  ) {
    throw new ServiceError('invalid_recipient');
  }
  return fromHex(puzzleHash);
}
