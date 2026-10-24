// SPDX-License-Identifier: AGPL-3.0-or-later
// A world for screen tests: the **real** services, over a chain that lives in memory.
//
// There is no second implementation of `AppServices` any more. What a screen talks to here is
// `createServicesFrom` — the same function `createRealServices` calls — wired to a fake chain,
// the real vault keystore over a software passkey (real P-256 signatures, no sensor), and a
// `fetch` that serves the handful of routes the app asks for. A test reaches a situation by putting the chain into it
// (`fund`, `makeEnvelope`, `openOneShare`), not by asking a stand-in to pretend.

import { ChainError } from '@ge/chain';
import type { Coin } from '@ge/chia';
import { decodeAddress, MAINNET, sha256, TESTNET11 } from '@ge/chia';
import { fakePasskeys } from '@ge/passkey-signer/fake';
import type { KeyStore, UnlockedWallet, VaultKeyStore, WalletKind } from '@ge/wallet';
import { accountFromSeed, createVaultKeyStore, memoryVaultStorage, WalletError } from '@ge/wallet';
import type { NetworkName } from '../lib/network';
import { createLocalState } from '../services/local-state';
import { createServicesFrom } from '../services/real';
import type { AppServices, CreateEnvelopeInput, SentEnvelope } from '../services/types';
import { createFakeChain } from './fake-chain';

const text = (value: string) => new TextEncoder().encode(value);

/** The seed a scripted passkey held before 24 words. */
export const earlierSeedOf = (name: string) => sha256(text(`earlier seed of ${name}`));

/** How the passkey behaves, for the cases a screen has to handle. */
export interface KeyStoreScript {
  /** This browser already knows its passkey, so opening needs no prompt. */
  exists?: boolean;
  /** The first prompt is dismissed, the way a cancelled Face ID sheet behaves. */
  cancelFirst?: boolean;
  /** Every prompt is dismissed: the sign-in sheet and the create sheet after it. */
  cancelAll?: boolean;
  /** No passkey can be made here (no ES256): what an unsupported browser looks like. */
  noPrf?: boolean;
  /** No passkey for this site on the phone: the default, named for the tests that rely on it. */
  noPasskey?: boolean;
  /**
   * An old wallet in this browser, from before the vault: its key lived here. 'device' was the
   * browser-only kind; `earlier` names a seed the old passkey also held (TASK-128).
   */
  legacy?: { kind?: WalletKind; earlier?: string };
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
  /** Who this is, when two worlds share a chain; only for reading the test. */
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

/** The seed of the old wallet a script names. */
const legacySeedOf = (name: string) => sha256(text(`legacy seed of ${name}`));

/** The keystore of an old wallet: it opens without a sensor and hands out its seed. */
function legacyKeyStore(legacy: NonNullable<KeyStoreScript['legacy']>): KeyStore {
  const kind = legacy.kind ?? 'passkey';
  let exists = true;
  const unlocked = async (): Promise<UnlockedWallet> => ({
    kind,
    version: 1,
    seed: legacySeedOf('old wallet'),
    entropy: null,
    ...(legacy.earlier === undefined ? {} : { earlierSeed: earlierSeedOf(legacy.earlier) }),
  });
  const gone = () => {
    throw new WalletError('no_wallet');
  };
  return {
    status: async () => (exists ? { kind, version: 1, restorable: kind === 'passkey' } : null),
    passkeySupported: async () => true,
    create: async () => gone(),
    unlock: async () => (exists ? unlocked() : gone()),
    signIn: async () => gone(),
    secureWithPasskey: async () => gone(),
    importWallet: async () => gone(),
    forget: async () => {
      exists = false;
    },
  };
}

/**
 * The real vault keystore over a software passkey. Prompts are counted, and the script decides
 * which of them are dismissed.
 */
function scriptedKeyStore(script: KeyStoreScript) {
  const fake = fakePasskeys(script.noPrf === true ? { noEs256: true } : {});
  const inner = createVaultKeyStore({ env: fake.env, storage: memoryVaultStorage() });
  let prompts = 0;
  const prompt = () => {
    prompts += 1;
    if (script.cancelFirst === true && prompts === 1) throw new WalletError('cancelled');
    if (script.cancelAll === true) throw new WalletError('cancelled');
  };
  // `exists`: the passkey and its record are there before the test starts, made silently.
  let primed = script.exists !== true;
  const prime = async () => {
    if (primed) return;
    primed = true;
    await inner.create('Clap and Pay wallet (existing)');
  };
  const keyStore: VaultKeyStore = {
    status: async () => {
      await prime();
      return inner.status();
    },
    passkeySupported: () => inner.passkeySupported(),
    create: async (label) => {
      await prime();
      prompt();
      return inner.create(label);
    },
    find: async () => {
      await prime();
      prompt();
      return inner.find();
    },
    narrow: async (credentialId, candidates) => {
      prompt();
      return inner.narrow(credentialId, candidates);
    },
    remember: (record) => inner.remember(record),
    sign: async (challenge) => {
      prompt();
      return inner.sign(challenge);
    },
    setLauncher: (launcherId) => inner.setLauncher(launcherId),
    forget: () => inner.forget(),
  };
  return { keyStore, prompts: () => prompts, passkeys: fake };
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
    coinRecordsByHint: (...args) => (spend() ? fake.chain.coinRecordsByHint(...args) : offline()),
    coinRecordsByParentIds: (...args) =>
      spend() ? fake.chain.coinRecordsByParentIds(...args) : offline(),
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
  const script = options.keyStore ?? {};
  const scripted = scriptedKeyStore(script);
  const state = createLocalState(memoryStorage());
  const legacyAccount =
    script.legacy === undefined ? null : accountFromSeed(legacySeedOf('old wallet'), network);
  if (legacyAccount !== null) {
    // What the old app remembered: its wallet, by address.
    state.setWallet(networkName, {
      kind: script.legacy?.kind ?? 'passkey',
      address: legacyAccount.address,
    });
  }

  const services: AppServices = createServicesFrom({
    network,
    chain: flaky,
    keyStore: scripted.keyStore,
    legacyKeyStore: script.legacy === undefined ? null : legacyKeyStore(script.legacy),
    state,
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
    /** How many times the passkey was asked (create, find, sign). */
    prompts: scripted.prompts,
    /** The software passkey behind the keystore. */
    passkeys: scripted.passkeys,
    /** Puts `amount` into the old wallet (`keyStore.legacy`); `earlier` its earlier address. */
    fundLegacy: (amount: bigint, which: 'wallet' | 'earlier' = 'wallet') => {
      const legacy = options.keyStore?.legacy;
      if (legacy === undefined || legacyAccount === null) throw new Error('no old wallet');
      const puzzleHash =
        which === 'wallet'
          ? legacyAccount.puzzleHash
          : accountFromSeed(earlierSeedOf(legacy.earlier ?? 'x'), network).puzzleHash;
      fake.add({
        parentCoinInfo: sha256(text(`faucet legacy ${which} ${amount} ${Math.random()}`)),
        puzzleHash,
        amount,
      });
    },
    /** The next `calls` chain calls fail; -1 is "until further notice". */
    goOffline: (calls = -1) => {
      down = calls;
    },
    comeBack: () => {
      down = 0;
    },
  };
}
