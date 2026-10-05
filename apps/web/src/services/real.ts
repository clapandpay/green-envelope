// SPDX-License-Identifier: AGPL-3.0-or-later
// The services wired to @ge/wallet, @ge/envelope and @ge/chain. Screens never see this file's
// imports; they see `AppServices`.
import { type ChainClient, ChainError, createChainClient } from '@ge/chain';
import {
  type Bytes,
  type Coin,
  coinId,
  decodeAddress,
  MAINNET,
  type Network,
  TESTNET11,
  toBase64Url,
  toHex,
} from '@ge/chia';
import {
  buildCreate,
  buildSend,
  decodeLink,
  EnvelopeError,
  type EnvelopeLink,
  encodeLink,
  envelopeKeys,
  inspectEnvelope,
  openEnvelope,
  splitAmounts,
  takeBackEnvelope,
  type Waiting,
  waitForOutput,
} from '@ge/envelope';
import {
  type Account,
  accountFromSeed,
  createKeyStore,
  envelopeSecret,
  type KeyStore,
  masterSecretKey,
  selectCoins,
  WalletError,
  type WalletKind,
} from '@ge/wallet';
import { builtNetwork, type NetworkName, resolveNetwork, withNetwork } from '../lib/network';
import { relyingPartyId } from '../lib/relying-party';
import { handlesApiFor, parseHandle, resolveHandle } from './handles';
import { createLocalState, type LocalState, type SentRecord } from './local-state';
import {
  type AppServices,
  type Balance,
  type EnvelopeView,
  type HandleLookup,
  type RecipientPick,
  type SentEnvelope,
  ServiceError,
  type WalletInfo,
} from './types';

/** `{ rpId }` where the passkey belongs to clapandpay.com, nothing where the browser decides. */
function rpIdOption(hostname: string): { rpId?: string } {
  const rpId = relyingPartyId(hostname);
  return rpId === undefined ? {} : { rpId };
}

/** Everything the real services need from the outside; all of it replaceable in tests. */
export interface RealDeps {
  network: Network;
  chain: ChainClient;
  keyStore: KeyStore;
  state: LocalState;
  /** Where envelope links point, e.g. https://envelope.clapandpay.com */
  origin: string;
  fetch: typeof fetch;
  /** Unix seconds. */
  now: () => number;
  /** Network fee per transaction in mojos; a share pays its own. */
  fee: bigint;
  /** Where `@names` are resolved, or null when no registry indexes this chain. */
  handlesApi?: string | null;
  expirySeconds: number;
  /** How confirmations are polled; tests make it instant. */
  waiting?: Waiting;
}

const WEEK = 7 * 24 * 60 * 60;
/** A share must still be worth opening after it has paid its fee. */
const MIN_SHARE_AFTER_FEE = 1000n;
const PRICE_SOURCES = [
  '/api/price',
  'https://api.coingecko.com/api/v3/simple/price?ids=chia&vs_currencies=eur',
];

/** Every failure a screen can see is a `ServiceError`. */
export function toServiceError(error: unknown): ServiceError {
  if (error instanceof ServiceError) return error;
  if (error instanceof WalletError) {
    if (error.code === 'cancelled') return new ServiceError('wallet_cancelled');
    if (error.code === 'no_wallet' || error.code === 'unsupported') {
      return new ServiceError('no_wallet_here');
    }
    if (error.code === 'insufficient_funds') return new ServiceError('insufficient_funds');
  }
  if (error instanceof EnvelopeError) {
    if (error.code === 'bad_link') return new ServiceError('bad_link');
    if (error.code === 'not_found') return new ServiceError('envelope_not_ready');
    if (error.code === 'envelope_empty') return new ServiceError('envelope_empty');
    if (error.code === 'insufficient_funds' || error.code === 'amount_too_small') {
      return new ServiceError('insufficient_funds');
    }
  }
  if (error instanceof ChainError && (error.code === 'network' || error.code === 'bad_response')) {
    return new ServiceError('network');
  }
  return new ServiceError('unknown', error instanceof Error ? error.message : String(error));
}

async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw toServiceError(error);
  }
}

/**
 * The fee when a deployment does not name one, per network.
 *
 * Zero is fine on a quiet chain and is what a test chain always is. On mainnet it is the thing
 * that gets dropped first when the mempool fills, and a green envelope that will not open for
 * an hour is worse than one that costs a thousandth of a cent to open. So mainnet has a floor
 * and testnet does not.
 *
 * A millionth of an XCH is a tenth of a percent of the smallest share this app will make
 * (`MIN_SHARE_MOJOS`, 0.001 XCH), and the opener pays it out of their own share. It is a dial:
 * `VITE_FEE_MOJOS` overrides it, and a busy chain may want more.
 */
export const DEFAULT_FEE_MOJOS: Readonly<Record<NetworkName, bigint>> = {
  mainnet: 1_000_000n,
  testnet11: 0n,
};

/**
 * The configured fee, or the network's default. A value that is not a whole number of mojos is
 * ignored rather than thrown: a typo in a deployment variable must not take the app down, and
 * falling back to the default keeps transactions moving.
 */
export function feeFromEnv(value: string | undefined, network: NetworkName): bigint {
  const text = (value ?? '').trim();
  if (!/^\d+$/.test(text)) return DEFAULT_FEE_MOJOS[network];
  return BigInt(text);
}

/** Reads the edge's recipient answer; null unless it names one of the candidates we offered. */
export function readPick(body: unknown, candidates: readonly string[]): RecipientPick | null {
  if (typeof body !== 'object' || body === null) return null;
  const { value, confidence } = body as { value?: unknown; confidence?: unknown };
  const strength = typeof confidence === 'number' && Number.isFinite(confidence) ? confidence : 0;
  if (value === null) return { value: null, confidence: strength };
  if (typeof value !== 'string' || !candidates.includes(value)) return null;
  return { value, confidence: strength };
}

/** Reads `{ eur }` (our edge service) or `{ chia: { eur } }` (CoinGecko). */
export function priceIn(body: unknown): number | null {
  if (typeof body !== 'object' || body === null) return null;
  const direct = (body as { eur?: unknown }).eur;
  const nested = (body as { chia?: { eur?: unknown } }).chia?.eur;
  const eur = typeof direct === 'number' ? direct : nested;
  return typeof eur === 'number' && Number.isFinite(eur) && eur > 0 ? eur : null;
}

/** Only the connect page needs the handoff code, so it stays out of the claim route's bundle. */
async function readConnectRequest(search: string) {
  const { HandoffError, parseHandoffRequest } = await import('@ge/handoff');
  try {
    return await parseHandoffRequest(search);
  } catch (error) {
    throw error instanceof HandoffError ? new ServiceError('bad_request') : error;
  }
}

/** Builds the services from their dependencies. */
export function createServicesFrom(deps: RealDeps): AppServices {
  const { network, chain, keyStore, state, fee } = deps;
  const handlesApi = deps.handlesApi ?? null;
  let account: Account | null = null;
  /** Accepted by the network, not confirmed yet: positive is on its way in. */
  let pending = 0n;

  const landed = (spent: Coin, output: Coin) => waitForOutput(chain, spent, output, deps.waiting);

  function track(amount: bigint, done: Promise<void>): Promise<void> {
    pending += amount;
    const settle = () => {
      pending -= amount;
    };
    done.then(settle, settle);
    return done;
  }

  /** Remembers an unlocked wallet as the current one and reports it. Wipes the seed. */
  function adopt(unlockedWallet: { kind: WalletKind; seed: Uint8Array }): WalletInfo {
    account = accountFromSeed(unlockedWallet.seed, network);
    unlockedWallet.seed.fill(0);
    const info: WalletInfo = { kind: unlockedWallet.kind, address: account.address };
    state.setWallet(network.name, info);
    return info;
  }

  async function unlocked(): Promise<Account> {
    if (account !== null) return account;
    const existing = await keyStore.status();
    const { kind, seed } = existing === null ? await keyStore.create() : await keyStore.unlock();
    account = accountFromSeed(seed, network);
    seed.fill(0);
    state.setWallet(network.name, { kind, address: account.address });
    return account;
  }

  async function spendable(owner: Account): Promise<Coin[]> {
    const records = await chain.coinRecordsByPuzzleHashes([owner.puzzleHash]);
    return records.map((record) => record.coin);
  }

  async function recipient(to: string): Promise<Bytes> {
    const text = to.trim();
    if (text.startsWith('@')) {
      // No registry indexes this chain; say that rather than blaming the spelling.
      if (handlesApi === null) throw new ServiceError('handles_mainnet_only');
      const resolved = await resolveHandle(
        text,
        network.addressPrefix,
        deps.fetch,
        deps.now(),
        handlesApi,
      );
      // Deliberately not remembered here. This runs at the start of `send`, before a coin is
      // chosen or a bundle pushed, so recording it here would mark a name as trusted merely
      // for having been typed — including the lookalike a person saw the warning about and
      // backed out of, which would then never be warned about again. `send` remembers it
      // after the push.
      return resolved.puzzleHash;
    }
    try {
      const { puzzleHash, prefix } = decodeAddress(text);
      if (prefix === network.addressPrefix) return puzzleHash;
    } catch {
      // fall through
    }
    throw new ServiceError('invalid_recipient');
  }

  /** Screens a handle against the ones already paid. Never throws: a warning is optional. */
  async function screenHandle(handle: string): Promise<string | null> {
    const known = state.paidHandles().map((entry) => `@${entry}`);
    if (known.length === 0 || known.includes(`@${handle}`)) return null;
    try {
      const response = await deps.fetch(`${deps.origin}/api/handle-check`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ handle: `@${handle}`, known }),
      });
      if (!response.ok) return null;
      const body: unknown = await response.json();
      const imitates = (body as { imitates?: unknown }).imitates;
      return typeof imitates === 'string' && known.includes(imitates) ? imitates : null;
    } catch {
      return null;
    }
  }

  function view(id: string, link: EnvelopeLink, total: number, left: number): EnvelopeView {
    return {
      id,
      from: link.from ?? null,
      message: link.message ?? null,
      sharesTotal: total,
      sharesLeft: left,
      openedAmount: state.openedAmount(id),
    };
  }

  async function describe(record: SentRecord): Promise<SentEnvelope> {
    const total = BigInt(record.total);
    const base = {
      id: record.id,
      link: record.link,
      createdAt: record.createdAt,
      expiresAt: record.createdAt + deps.expirySeconds,
      total,
      sharesTotal: record.shares,
    };
    if (record.takenBack !== null) {
      // What the sender swept back was not opened by anybody.
      return {
        ...base,
        sharesOpened: record.shares - record.takenBack.shares,
        amountOpened: total - BigInt(record.takenBack.amount),
        status: 'taken_back',
      };
    }
    const shares = await inspectEnvelope(chain, decodeLink(record.link).publicKey, record.shares);
    const opened = shares.filter((share) => share.opened);
    return {
      ...base,
      sharesOpened: opened.length,
      amountOpened: opened.reduce((sum, share) => sum + share.coin.amount, 0n),
      status:
        shares.length === 0 ? 'pending' : opened.length === shares.length ? 'finished' : 'active',
    };
  }

  return {
    network: network.name,

    wallet: {
      current: async () => state.wallet(network.name),

      ensure: () =>
        guarded(async (): Promise<WalletInfo> => {
          const owner = await unlocked();
          return state.wallet(network.name) ?? { kind: 'device', address: owner.address };
        }),

      balance: () =>
        guarded(async (): Promise<Balance> => {
          const info = state.wallet(network.name);
          if (info === null) return { confirmed: 0n, pending: 0n };
          // The address is public: reading the balance never needs the key or a prompt.
          const { puzzleHash } = decodeAddress(info.address);
          const records = await chain.coinRecordsByPuzzleHashes([puzzleHash]);
          return { confirmed: records.reduce((sum, r) => sum + r.coin.amount, 0n), pending };
        }),

      send: (to, amount) =>
        guarded(async () => {
          const toPuzzleHash = await recipient(to);
          const owner = await unlocked();
          const coins = selectCoins(await spendable(owner), amount + fee);
          const first = coins[0];
          if (first === undefined) throw new ServiceError('insufficient_funds');
          const bundle = buildSend({
            inputs: coins.map((coin) => ({ coin, signer: owner })),
            toPuzzleHash,
            amount,
            changePuzzleHash: owner.puzzleHash,
            fee,
            network,
          });
          await chain.pushTx(bundle);
          // Accepted by the network: this is the first moment the name has been paid, and the
          // only one that should make it a name this person trusts.
          const handle = parseHandle(to);
          if (to.trim().startsWith('@') && handle !== null) state.rememberPaidHandle(handle);
          const output: Coin = { parentCoinInfo: coinId(first), puzzleHash: toPuzzleHash, amount };
          return { confirmed: track(-(amount + fee), landed(first, output)) };
        }),

      // One tap on the envelope: unlock what is on this device, otherwise open the wallet this
      // person already has somewhere else.
      //
      // It never creates. WebAuthn answers "there is no passkey here" and "you dismissed the
      // prompt" with the same NotAllowedError, so a keystore cannot tell a new person from a
      // hesitant one, and guessing wrong either way is bad: guess "new" and a returning person
      // gets a second, empty wallet while their money sits in the first; guess "hesitant" and
      // a new person never gets a wallet at all. Making one is a separate, asked-for step.
      open: () =>
        guarded(async (): Promise<WalletInfo> => {
          if ((await keyStore.status()) !== null) return adopt(await keyStore.unlock());
          return adopt(await keyStore.signIn());
        }),

      connectRequest: (search) =>
        guarded(async () => ({ checkCode: (await readConnectRequest(search)).checkCode })),

      connectApprove: (search) =>
        guarded(async () => {
          const request = await readConnectRequest(search);
          const { sealHandoffResponse } = await import('@ge/handoff');
          // Always a fresh prompt: handing over the wallet is never done on a remembered unlock.
          const { kind, seed } = await keyStore.signIn();
          const owner = accountFromSeed(seed, network);
          const master = masterSecretKey(seed);
          seed.fill(0);
          state.setWallet(network.name, { kind, address: owner.address });
          try {
            return await sealHandoffResponse(request, {
              v: 1,
              network: network.name,
              address: owner.address,
              masterSk: toHex(master),
            });
          } finally {
            master.fill(0);
          }
        }),

      lookupHandle: (input) =>
        guarded(async (): Promise<HandleLookup> => {
          if (handlesApi === null) throw new ServiceError('handles_mainnet_only');
          const resolved = await resolveHandle(
            input,
            network.addressPrefix,
            deps.fetch,
            deps.now(),
            handlesApi,
          );
          // Resolution is the answer; the screen is an extra sentence on top of it, so a
          // failure there must not fail the lookup.
          return {
            handle: resolved.handle,
            address: resolved.address,
            pendingTransfer: resolved.pendingTransfer,
            imitates: await screenHandle(resolved.handle),
          };
        }),

      pickRecipient: async (text, candidates) => {
        if (candidates.length < 2) return null;
        try {
          const response = await deps.fetch(`${deps.origin}/api/recipient`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              text,
              candidates,
              ...(account === null ? {} : { ownAddress: account.address }),
            }),
          });
          if (!response.ok) return null;
          const body: unknown = await response.json();
          return readPick(body, candidates);
        } catch {
          // A suggestion is a convenience; without it the screen simply asks.
          return null;
        }
      },

      // A device wallet lives in this browser and dies with it. Behind a passkey it is the
      // same wallet, the same address and the same money, with a face or finger in front of
      // it: the seed is kept wrapped by a key only the passkey can derive. Nothing moves, so
      // there is no transaction here and nothing to lose in the middle.
      canRestoreElsewhere: () =>
        guarded(async () => (await keyStore.status())?.restorable === true),

      forget: () =>
        guarded(async () => {
          await keyStore.forget();
          state.clearWallet();
          // The unlocked key is gone with the record; nothing may keep signing with it.
          account = null;
        }),

      canUpgradeToPasskey: () =>
        guarded(async () => {
          const stored = await keyStore.status();
          return stored?.kind === 'device' && (await keyStore.passkeySupported());
        }),
      upgradeToPasskey: () =>
        guarded(async (): Promise<WalletInfo> => adopt(await keyStore.secureWithPasskey())),
    },

    envelopes: {
      inspect: (url) =>
        guarded(async () => {
          const link = decodeLink(url);
          const id = toBase64Url(link.publicKey);
          const shares = await inspectEnvelope(chain, link.publicKey, link.shares);
          if (shares.length === 0) throw new ServiceError('envelope_not_ready');
          return view(id, link, shares.length, shares.filter((share) => !share.opened).length);
        }),

      open: (url) =>
        guarded(async () => {
          const link = decodeLink(url);
          const id = toBase64Url(link.publicKey);
          if (state.openedAmount(id) !== null) throw new ServiceError('already_opened');
          const keys = envelopeKeys(link.secret);
          const owner = await unlocked();
          const opened = await openEnvelope({
            chain,
            envelopeSk: keys.secretKey,
            envelopePk: keys.publicKey,
            ...(link.shares === undefined ? {} : { sharesHint: link.shares }),
            toPuzzleHash: owner.puzzleHash,
            fee,
            network,
          });
          state.setOpened(id, opened.received);
          const confirmed = landed(opened.share.coin, opened.output).catch((error: unknown) => {
            // Somebody else's claim of the same share won after all: let this person try again.
            if (error instanceof EnvelopeError && error.code === 'lost_race') {
              state.clearOpened(id);
            }
            throw toServiceError(error);
          });
          return { amount: opened.received, confirmed: track(opened.received, confirmed) };
        }),

      create: (input) =>
        guarded(async (): Promise<SentEnvelope> => {
          const owner = await unlocked();
          const amounts = splitAmounts(input.total, input.shares, input.mode, {
            floor: fee + MIN_SHARE_AFTER_FEE,
          });
          const coins = selectCoins(await spendable(owner), input.total + fee);
          const first = coins[0];
          if (first === undefined) throw new ServiceError('insufficient_funds');
          const counter = state.nextEnvelopeCounter();
          const secret = envelopeSecret(owner, counter);
          const keys = envelopeKeys(secret);
          const created = buildCreate({
            inputs: coins.map((coin) => ({ coin, signer: owner })),
            envelopePk: keys.publicKey,
            amounts,
            changePuzzleHash: owner.puzzleHash,
            fee,
            network,
          });
          await chain.pushTx(created.bundle);
          const record: SentRecord = {
            id: toBase64Url(keys.publicKey),
            counter,
            link: withNetwork(
              encodeLink(deps.origin, {
                publicKey: keys.publicKey,
                secret,
                shares: input.shares,
                ...(input.from === null ? {} : { from: input.from }),
                ...(input.message === null ? {} : { message: input.message }),
              }),
              network.name,
            ),
            createdAt: deps.now(),
            total: input.total.toString(),
            shares: input.shares,
            takenBack: null,
          };
          state.addSent(record);
          const firstShare = created.shares[0];
          if (firstShare !== undefined) {
            track(-(input.total + fee), landed(first, firstShare.coin)).catch(() => {});
          }
          return {
            id: record.id,
            link: record.link,
            createdAt: record.createdAt,
            expiresAt: record.createdAt + deps.expirySeconds,
            total: input.total,
            sharesTotal: input.shares,
            sharesOpened: 0,
            amountOpened: 0n,
            status: 'pending',
          };
        }),

      listSent: () => guarded(() => Promise.all(state.sent().map(describe))),

      takeBack: (id) =>
        guarded(async () => {
          const record = state.sent().find((entry) => entry.id === id);
          const info = state.wallet(network.name);
          if (record === undefined || info === null) throw new ServiceError('unknown');
          // The envelope's own secret signs; the wallet key is not needed, so no prompt.
          const link = decodeLink(record.link);
          const keys = envelopeKeys(link.secret);
          const unopened = (await inspectEnvelope(chain, keys.publicKey, record.shares)).filter(
            (share) => !share.opened,
          );
          const back = await takeBackEnvelope({
            chain,
            envelopeSk: keys.secretKey,
            envelopePk: keys.publicKey,
            sharesHint: record.shares,
            toPuzzleHash: decodeAddress(info.address).puzzleHash,
            fee,
            network,
          });
          state.markTakenBack(id, {
            amount: (back.received + fee).toString(),
            shares: unopened.length,
          });
          const confirmed = landed(back.spent, back.output);
          return { amount: back.received, confirmed: track(back.received, confirmed) };
        }),
    },

    price: {
      eurPerXch: async () => {
        for (const url of PRICE_SOURCES) {
          try {
            const response = await deps.fetch(url, { signal: AbortSignal.timeout(4000) });
            if (!response.ok) continue;
            const eur = priceIn(await response.json());
            if (eur !== null) return eur;
          } catch {
            // try the next source
          }
        }
        return null;
      },
    },
  };
}

/** The real services for this build, configured from `import.meta.env`. */
export function createRealServices(): AppServices {
  const env = import.meta.env;
  // The link decides (`?net=testnet`), then the build, then mainnet. See lib/network.ts.
  const network =
    resolveNetwork(location.search, env.VITE_NETWORK) === 'testnet11' ? TESTNET11 : MAINNET;
  const direct =
    network.name === 'mainnet' ? 'https://api.coinset.org' : 'https://testnet11.api.coinset.org';
  // Configured endpoints belong to the chain the build was made for. When a link has moved the
  // app to another one, they are the wrong nodes: bundles signed against one genesis challenge
  // would be pushed to the other, and balances read from a chain the money is not on. Only the
  // build's own network keeps them.
  const built = builtNetwork(env.VITE_NETWORK);
  const configured =
    network.name === built
      ? String(env.VITE_CHAIN_ENDPOINTS ?? '')
          .split(',')
          .map((entry) => entry.trim())
          .filter((entry) => entry !== '')
      : [];
  return createServicesFrom({
    network,
    chain: createChainClient({ endpoints: configured.length > 0 ? configured : [direct] }),
    keyStore: createKeyStore({ rpName: 'Clap and Pay', ...rpIdOption(location.hostname) }),
    state: createLocalState(localStorage),
    origin: String(env.VITE_PUBLIC_ORIGIN ?? location.origin),
    fetch: (input, init) => fetch(input, init),
    now: () => Math.floor(Date.now() / 1000),
    fee: feeFromEnv(env.VITE_FEE_MOJOS, network.name),
    handlesApi: handlesApiFor(network.name, env.VITE_HANDLES_API),
    expirySeconds: WEEK,
  });
}
