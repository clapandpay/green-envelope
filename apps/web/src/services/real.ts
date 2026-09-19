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
  selectCoins,
  WalletError,
} from '@ge/wallet';
import { resolveHandle } from './handles';
import { createLocalState, type LocalState, type SentRecord } from './local-state';
import {
  type AppServices,
  type Balance,
  type EnvelopeView,
  type SentEnvelope,
  ServiceError,
  type WalletInfo,
} from './types';

/** Everything the real services need from the outside; all of it replaceable in tests. */
export interface RealDeps {
  network: Network;
  chain: ChainClient;
  keyStore: KeyStore;
  state: LocalState;
  /** Where envelope links point, e.g. https://clapandpay.com */
  origin: string;
  fetch: typeof fetch;
  /** Unix seconds. */
  now: () => number;
  /** Network fee per transaction in mojos; a share pays its own. */
  fee: bigint;
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

/** Reads `{ eur }` (our edge service) or `{ chia: { eur } }` (CoinGecko). */
export function priceIn(body: unknown): number | null {
  if (typeof body !== 'object' || body === null) return null;
  const direct = (body as { eur?: unknown }).eur;
  const nested = (body as { chia?: { eur?: unknown } }).chia?.eur;
  const eur = typeof direct === 'number' ? direct : nested;
  return typeof eur === 'number' && Number.isFinite(eur) && eur > 0 ? eur : null;
}

/** Builds the services from their dependencies. */
export function createServicesFrom(deps: RealDeps): AppServices {
  const { network, chain, keyStore, state, fee } = deps;
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

  async function unlocked(): Promise<Account> {
    if (account !== null) return account;
    const existing = await keyStore.status();
    const { kind, seed } = existing === null ? await keyStore.create() : await keyStore.unlock();
    account = accountFromSeed(seed, network);
    seed.fill(0);
    state.setWallet({ kind, address: account.address });
    return account;
  }

  async function spendable(owner: Account): Promise<Coin[]> {
    const records = await chain.coinRecordsByPuzzleHashes([owner.puzzleHash]);
    return records.map((record) => record.coin);
  }

  async function recipient(to: string): Promise<Bytes> {
    const text = to.trim();
    if (text.startsWith('@')) {
      // The handle registry exists on mainnet only.
      if (network.name !== 'mainnet') throw new ServiceError('invalid_recipient');
      return resolveHandle(text, deps.fetch);
    }
    try {
      const { puzzleHash, prefix } = decodeAddress(text);
      if (prefix === network.addressPrefix) return puzzleHash;
    } catch {
      // fall through
    }
    throw new ServiceError('invalid_recipient');
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
      current: async () => state.wallet(),

      ensure: () =>
        guarded(async (): Promise<WalletInfo> => {
          const owner = await unlocked();
          return state.wallet() ?? { kind: 'device', address: owner.address };
        }),

      balance: () =>
        guarded(async (): Promise<Balance> => {
          const info = state.wallet();
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
          const output: Coin = { parentCoinInfo: coinId(first), puzzleHash: toPuzzleHash, amount };
          return { confirmed: track(-(amount + fee), landed(first, output)) };
        }),

      // Moving a device wallet's money to a new passkey wallet needs a second key slot (TASK-042).
      canUpgradeToPasskey: async () => false,
      upgradeToPasskey: async () => {
        throw new ServiceError('unknown', 'not available yet');
      },
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
            link: encodeLink(deps.origin, {
              publicKey: keys.publicKey,
              secret,
              shares: input.shares,
              ...(input.from === null ? {} : { from: input.from }),
              ...(input.message === null ? {} : { message: input.message }),
            }),
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
          const info = state.wallet();
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
  const network = env.VITE_NETWORK === 'mainnet' ? MAINNET : TESTNET11;
  const direct =
    network.name === 'mainnet' ? 'https://api.coinset.org' : 'https://testnet11.api.coinset.org';
  const configured = String(env.VITE_CHAIN_ENDPOINTS ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
  return createServicesFrom({
    network,
    chain: createChainClient({ endpoints: configured.length > 0 ? configured : [direct] }),
    keyStore: createKeyStore({ rpName: 'Clap and Pay' }),
    state: createLocalState(localStorage),
    origin: String(env.VITE_PUBLIC_ORIGIN ?? location.origin),
    fetch: (input, init) => fetch(input, init),
    now: () => Math.floor(Date.now() / 1000),
    fee: BigInt(String(env.VITE_FEE_MOJOS ?? '0')),
    expirySeconds: WEEK,
  });
}
