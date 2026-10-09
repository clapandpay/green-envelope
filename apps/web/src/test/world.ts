// SPDX-License-Identifier: AGPL-3.0-or-later
// A world for screen tests: the **real** services, over a chain that lives in memory.
//
// There is no second implementation of `AppServices` any more. What a screen talks to here is
// `createServicesFrom` — the same function `createRealServices` calls — wired to a fake chain,
// a keystore that answers without a fingerprint sensor, and a `fetch` that serves the handful
// of routes the app asks for. A test reaches a situation by putting the chain into it
// (`fund`, `makeEnvelope`, `openOneShare`), not by asking a stand-in to pretend.

import { ChainError } from '@ge/chain';
import type { Coin } from '@ge/chia';
import { decodeAddress, MAINNET, sha256, TESTNET11 } from '@ge/chia';
import type { KeyStore, UnlockedWallet, WalletKind } from '@ge/wallet';
import { WalletError } from '@ge/wallet';
import type { NetworkName } from '../lib/network';
import { createLocalState } from '../services/local-state';
import { createServicesFrom } from '../services/real';
import type { AppServices, CreateEnvelopeInput, SentEnvelope } from '../services/types';
import { createFakeChain } from './fake-chain';

const text = (value: string) => new TextEncoder().encode(value);

/** How the keystore behaves, for the cases a screen has to handle. */
export interface KeyStoreScript {
  /** 'device' is a wallet the browser holds alone; 'passkey' is derived and comes back. */
  kind?: WalletKind;
  /** A wallet is already on this device, so opening unlocks instead of signing in. */
  exists?: boolean;
  /** The first prompt is dismissed, the way a cancelled Face ID sheet behaves. */
  cancelFirst?: boolean;
  /** The record's version; 2 unless a test is about an older wallet. */
  version?: 1 | 2;
  /** Every prompt is dismissed: the sign-in sheet and the create sheet after it. */
  cancelAll?: boolean;
  /** WebAuthn works but has no PRF here: no passkey wallet can be made or opened. */
  noPrf?: boolean;
  /** No passkey for this site: what a person who has never been here looks like. */
  noPasskey?: boolean;
  /**
   * Whether a passkey could be made here at all. Independent of `kind`: a browser-only wallet
   * on a phone that does support passkeys is exactly when securing it is worth offering.
   */
  passkeySupported?: boolean;
}

/** What `fetch` should answer, for the routes the app reaches for. */
export interface FetchScript {
  /** Euro price of one XCH; null serves a 503, which is "no price". */
  eurPerXch?: number | null;
  /** Answer of `POST /api/recipient`; null means "no suggestion". */
  pick?: string | null;
  /** Answer of `POST /api/handle-check`: the handle this one imitates. */
  imitates?: string | null;
  /** The XCHandles answer, by bare handle. A missing one is a 404. */
  handles?: Record<
    string,
    { puzzleHash?: string; expiresIn?: number; melted?: boolean; pendingTransfer?: boolean }
  >;
  /** The handle registry does not answer, while everything else still does. */
  handlesDown?: boolean;
  /** Every request fails, the way an offline phone does. */
  offline?: boolean;
}

export interface WorldOptions {
  network?: NetworkName;
  /** Share another world's chain, so two people can meet on it. */
  shared?: ReturnType<typeof createFakeChain>;
  seedName?: string;
  keyStore?: KeyStoreScript;
  fetch?: FetchScript;
  fee?: bigint;
}

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

/** A keystore that answers as scripted. Nothing here touches WebAuthn. */
function scriptedKeyStore(script: KeyStoreScript, seedName: string): KeyStore {
  const kind = script.kind ?? 'passkey';
  const seed = () => sha256(text(`seed of ${seedName}`));
  const unlocked = (): UnlockedWallet => ({ kind, version: 1, seed: seed(), entropy: null });
  let exists = script.exists ?? false;
  let prompts = 0;
  const prompt = () => {
    prompts += 1;
    if (script.cancelFirst === true && prompts === 1) throw new WalletError('cancelled');
    if (script.cancelAll === true) throw new WalletError('cancelled');
  };
  return {
    status: async () =>
      exists ? { kind, version: script.version ?? 2, restorable: kind === 'passkey' } : null,
    passkeySupported: async () => script.passkeySupported ?? true,
    create: async (opts) => {
      if (opts?.prefer === 'device') {
        exists = true;
        return { ...unlocked(), kind: 'device' };
      }
      prompt();
      if (script.noPrf === true) throw new WalletError('unsupported');
      exists = true;
      return unlocked();
    },
    unlock: async () => {
      prompt();
      return unlocked();
    },
    signIn: async () => {
      prompt();
      // The keystore's own two signals, and they are not the same: 'no_wallet' is an
      // authenticator that answered with no credential, 'cancelled' is a prompt somebody
      // dismissed. A screen treats them differently, so a script must be able to say which.
      if (script.noPasskey === true) throw new WalletError('no_wallet');
      exists = true;
      return unlocked();
    },
    secureWithPasskey: async () => unlocked(),
    importWallet: async (imported) => ({
      kind,
      version: 1,
      seed: new Uint8Array(imported),
      entropy: null,
    }),
    forget: async () => {
      exists = false;
    },
  };
}

const PUZZLE_HASH = 'a'.repeat(64);

/** A `fetch` that serves the routes the app asks for, and nothing else. */
function scriptedFetch(script: FetchScript, now: () => number): typeof fetch {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });

  return async (input) => {
    if (script.offline === true) throw new TypeError('offline');
    const url = String(input);

    if (url.includes('/api/price') || url.includes('coingecko')) {
      const eur = script.eurPerXch === undefined ? 25 : script.eurPerXch;
      return eur === null ? json({ eur: null }, 503) : json({ eur });
    }
    if (url.includes('/api/recipient')) {
      return json({ value: script.pick ?? null, confidence: script.pick ? 0.95 : 0 });
    }
    if (url.includes('/api/handle-check')) {
      return json({ imitates: script.imitates ?? null, probability: script.imitates ? 0.9 : 0.05 });
    }
    const handle = /\/handle\/([a-z0-9]+)$/.exec(url)?.[1];
    if (handle !== undefined) {
      if (script.handlesDown === true) return json({ code: 'upstream' }, 502);
      const entry = script.handles?.[handle];
      if (entry === undefined) return json({ code: 'not_found' }, 404);
      return json({
        handle,
        slot: { expiration: now() + (entry.expiresIn ?? 86_400) },
        resolved_singleton: {
          melted: entry.melted ?? false,
          nft: { p2_puzzle_hash: entry.puzzleHash ?? PUZZLE_HASH },
        },
        pending_transfer: entry.pendingTransfer === true ? { to: 'someone' } : null,
      });
    }
    return json({ code: 'not_found' }, 404);
  };
}

/** The real services, and the levers a test needs to put the world into a situation. */
export function createWorld(options: WorldOptions = {}) {
  const fake = options.shared ?? createFakeChain();
  // The chain can be taken away and given back, which is what a phone losing signal is. It
  // wraps the real client rather than replacing it, so what a screen sees is a real failure
  // from a real call.
  let down = 0;
  const flaky: typeof fake.chain = {
    coinRecordsByPuzzleHashes: (...args) =>
      spend() ? fake.chain.coinRecordsByPuzzleHashes(...args) : offline(),
    coinRecordByName: (...args) => (spend() ? fake.chain.coinRecordByName(...args) : offline()),
    pushTx: (...args) => (spend() ? fake.chain.pushTx(...args) : offline()),
    peakHeight: (...args) => (spend() ? fake.chain.peakHeight(...args) : offline()),
  };
  function spend(): boolean {
    if (down === 0) return true;
    if (down > 0) down -= 1;
    return false;
  }
  function offline(): never {
    throw new ChainError('network', 'offline');
  }
  const networkName = options.network ?? 'testnet11';
  const network = networkName === 'mainnet' ? MAINNET : TESTNET11;
  const now = () => 1_800_000_000;

  const services: AppServices = createServicesFrom({
    network,
    chain: flaky,
    keyStore: scriptedKeyStore(options.keyStore ?? {}, options.seedName ?? 'someone'),
    state: createLocalState(memoryStorage()),
    origin: 'https://ge.test',
    fetch: scriptedFetch(options.fetch ?? {}, now),
    now,
    fee: options.fee ?? 0n,
    handlesApi: networkName === 'mainnet' ? 'https://handles.test' : null,
    expirySeconds: 7 * 86_400,
    waiting: { intervalMs: 1, timeoutMs: 2_000, sleep: () => new Promise((r) => setTimeout(r, 1)) },
  });

  /** Puts `amount` into this wallet, the way a faucet would. */
  async function fund(amount: bigint): Promise<void> {
    const { address } = await services.wallet.ensure();
    const coin: Coin = {
      parentCoinInfo: sha256(text(`faucet ${address} ${amount}`)),
      puzzleHash: decodeAddress(address).puzzleHash,
      amount,
    };
    fake.add(coin);
  }

  /** Makes a real envelope on the chain and returns it, confirmed. */
  async function makeEnvelope(input: Partial<CreateEnvelopeInput> = {}): Promise<SentEnvelope> {
    const wanted: CreateEnvelopeInput = {
      total: 5_000_000_000n,
      shares: 2,
      mode: 'equal',
      from: 'Anna',
      message: null,
      ...input,
    };
    // Enough for the envelope and whatever else the test does afterwards.
    await fund(wanted.total * 2n + 1_000_000_000n);
    const sent = await services.envelopes.create(wanted);
    fake.farmBlock();
    return sent;
  }

  /**
   * Actually pays a handle, so it becomes one this person trusts. There is no shortcut for
   * this: the app only remembers a name after the send is on the chain, which is the whole
   * point of it — a name is trusted because money went to it, not because it was typed.
   */
  async function payHandle(handle: string, amount = 1_000_000_000n): Promise<void> {
    await fund(amount * 4n);
    await services.wallet.send(handle, amount);
    fake.farmBlock();
  }

  return {
    services,
    fake,
    fund,
    makeEnvelope,
    payHandle,
    network: networkName,
    /** The next `calls` chain calls fail; -1 is "until further notice". */
    goOffline: (calls = -1) => {
      down = calls;
    },
    comeBack: () => {
      down = 0;
    },
  };
}
