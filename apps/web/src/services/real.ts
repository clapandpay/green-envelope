// SPDX-License-Identifier: AGPL-3.0-or-later
// The services wired to @ge/wallet, @ge/vault, @ge/envelope and @ge/chain. Screens never see
// this file's imports; they see `AppServices`.
//
// The wallet is a passkey vault: no private key of the wallet ever exists here. Opening it needs
// public data only (no prompt); every spend is built here, signed by the passkey (one prompt),
// and checked on-chain. Envelope shares are the exception by design: their keys are in the link.
import { type ChainClient, ChainError, createChainClient } from '@ge/chain';
import {
  type Bytes,
  type Coin,
  type Condition,
  coinId,
  decodeAddress,
  encodeAddress,
  MAINNET,
  type Network,
  TESTNET11,
  toBase64Url,
  toHex,
} from '@ge/chia';
import {
  buildSweep,
  type Destination,
  decodeLink,
  EnvelopeError,
  type EnvelopeLink,
  encodeLink,
  envelopeKeys,
  inspectEnvelope,
  openEnvelope,
  SECRET_BYTES,
  sharePuzzleHash,
  splitAmounts,
  type To,
  takeBackEnvelope,
  type Waiting,
  waitForOutput,
} from '@ge/envelope';
import {
  buildSetupSpend,
  buildVaultSpend,
  launchVault,
  moneyPuzzleHash,
  type Output,
  setupPuzzleHash,
  VaultError,
} from '@ge/vault';
import {
  type Account,
  accountFromSeed,
  createKeyStore,
  createVaultKeyStore,
  currentVault,
  findLauncherId,
  type KeyStore,
  keyWithMoney,
  MAX_INPUTS,
  selectCoins,
  type VaultKeyStore,
  type VaultRecord,
  WalletError,
  walletCoins,
  wipeUnlocked as wipe,
} from '@ge/wallet';
import {
  builtNetwork,
  type NetworkName,
  networkFromSearch,
  resolveNetwork,
  withNetwork,
} from '../lib/network';
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
  keyStore: VaultKeyStore;
  /** The keystore of wallets from before the vault (keys in the browser), for moving them. */
  legacyKeyStore?: KeyStore | null;
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
    if (error.code === 'no_wallet') return new ServiceError('no_wallet_here');
    if (error.code === 'unsupported') return new ServiceError('passkey_unavailable');
    if (error.code === 'insufficient_funds') return new ServiceError('insufficient_funds');
  }
  if (error instanceof VaultError) {
    if (error.code === 'insufficient_funds' || error.code === 'no_coins') {
      return new ServiceError('insufficient_funds');
    }
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

/** Builds the services from their dependencies. */
export function createServicesFrom(deps: RealDeps): AppServices {
  const { network, chain, keyStore, state, fee } = deps;
  const legacy = deps.legacyKeyStore ?? null;
  const handlesApi = deps.handlesApi ?? null;
  /** Accepted by the network, not confirmed yet: positive is on its way in. */
  let pending = 0n;

  const landed = (spent: Coin, output: Coin) => waitForOutput(chain, spent, output, deps.waiting);
  const address = (puzzleHash: Bytes) => encodeAddress(puzzleHash, network.addressPrefix);

  function track(amount: bigint, done: Promise<void>): Promise<void> {
    pending += amount;
    const settle = () => {
      pending -= amount;
    };
    done.then(settle, settle);
    return done;
  }

  /**
   * The passkey's user name: date and time (UTC) tell one wallet from another in the passkey
   * list, even two made the same day (audit M-2).
   */
  function walletLabel(): string {
    const made = new Date(deps.now() * 1000).toISOString();
    return `Clap and Pay wallet ${made.slice(0, 10)} ${made.slice(11, 16)}`;
  }

  /**
   * Where this wallet's money is received. The vault's address once the vault exists on the
   * chain; until then the setup address, which the passkey alone controls. Never the address
   * of a vault that is still being launched: if that launch lost a race, money sent there
   * would be locked for good.
   */
  async function receivingPuzzleHash(record: VaultRecord): Promise<Bytes> {
    if (record.launcherId !== null) {
      const vault = await currentVault(chain, record.publicKey, record.launcherId);
      if (vault !== null) return moneyPuzzleHash(record.launcherId);
    }
    return setupPuzzleHash(record.publicKey);
  }

  /** Remembers the record as this browser's wallet and reports it. */
  async function adopt(record: VaultRecord): Promise<WalletInfo> {
    const info: WalletInfo = {
      kind: 'passkey',
      address: address(await receivingPuzzleHash(record)),
    };
    state.setWallet(network.name, info);
    return info;
  }

  /** The record of this browser, or the passkey this person already has, found with one prompt. */
  async function signIn(): Promise<VaultRecord> {
    const found = await keyStore.find();
    const match = await keyWithMoney(chain, found.candidates);
    let record: VaultRecord;
    if (match !== null) {
      record = { credentialId: found.credentialId, ...match };
    } else {
      // Nothing on the chain tells the two candidate keys apart: a passkey that never held
      // money. A second signature settles it.
      const [only] = found.candidates;
      const publicKey =
        found.candidates.length === 1 && only !== undefined
          ? only
          : await keyStore.narrow(found.credentialId, found.candidates);
      record = { credentialId: found.credentialId, publicKey, launcherId: null };
    }
    await keyStore.remember(record);
    return record;
  }

  /** The one tap: the wallet here, else the passkey the phone has, else a new one. */
  /**
   * This browser's record, with this network's vault filled in from the chain when it is not
   * known here yet (another network was used first, or an older record). A launch is never
   * made for a passkey that already has a vault.
   */
  async function knownRecord(): Promise<VaultRecord | null> {
    const record = await keyStore.status();
    if (record === null || record.launcherId !== null) return record;
    const launcherId = await findLauncherId(chain, record.publicKey);
    if (launcherId === null) return record;
    await keyStore.setLauncher(launcherId);
    return { ...record, launcherId };
  }

  async function ensureRecord(): Promise<VaultRecord> {
    const here = await knownRecord();
    if (here !== null) return here;
    try {
      return await signIn();
    } catch (error) {
      // 'cancelled' is also what a phone without a passkey for this site says. Either way the
      // phone's create sheet comes next, and that sheet is the person's own yes or no.
      if (!(error instanceof WalletError) || error.code !== 'cancelled') throw error;
    }
    return keyStore.create(walletLabel());
  }

  async function requireRecord(): Promise<VaultRecord> {
    const record = await knownRecord();
    if (record === null) throw new ServiceError('no_wallet_here');
    return record;
  }

  /** CREATE_COIN conditions for outputs, hinted to their receivers. */
  function payments(outputs: Output[]): Condition[] {
    return outputs.map((output) => ({
      kind: 'createCoin',
      puzzleHash: output.puzzleHash,
      amount: output.amount,
      memos: [output.puzzleHash],
    }));
  }

  /**
   * Pays `outputs` (plus the fee) out of the wallet, with one passkey prompt. `all` spends every
   * coin (up to 50) and pays their whole value, minus the fee, to the first output instead.
   * Returns the coin the first output becomes, to wait for.
   */
  async function pay(
    outputs: Output[],
    opts: { all?: boolean } = {},
  ): Promise<{ first: Coin; firstOutput: Coin; total: bigint; more: boolean }> {
    const record = await requireRecord();
    const { money, setup } = await walletCoins(chain, record.publicKey, record.launcherId);
    const vault =
      record.launcherId === null
        ? null
        : await currentVault(chain, record.publicKey, record.launcherId);

    if (vault !== null && money.length > 0) {
      const wanted = outputs.reduce((sum, o) => sum + o.amount, 0n) + fee;
      const coins = opts.all === true ? money.slice(0, MAX_INPUTS) : selectCoins(money, wanted);
      const total = coins.reduce((sum, coin) => sum + coin.amount, 0n);
      const plan = opts.all === true ? sweepTo(outputs, total) : outputs;
      const unsigned = buildVaultSpend({ vault, money: coins, outputs: plan, fee });
      const bundle = unsigned.finish(await keyStore.sign(unsigned.challenge));
      await chain.pushTx(bundle);
      const first = coins[0];
      const out = plan[0];
      if (first === undefined || out === undefined) throw new ServiceError('unknown');
      return {
        first,
        firstOutput: {
          parentCoinInfo: coinId(first),
          puzzleHash: out.puzzleHash,
          amount: out.amount,
        },
        total: plan.reduce((sum, o) => sum + o.amount, 0n),
        more: opts.all === true && money.length > coins.length,
      };
    }

    if (record.launcherId !== null && vault === null && money.length + setup.length > 0) {
      // Launched, not confirmed yet: the vault cannot sign before it exists.
      throw new ServiceError('wallet_settling');
    }

    // No vault yet: one coin at the setup address pays, and launches the vault on the way.
    const wanted = outputs.reduce((sum, o) => sum + o.amount, 0n) + fee + 1n;
    const coin =
      opts.all === true
        ? setup.reduce<Coin | undefined>(
            (a, b) => (a === undefined || b.amount > a.amount ? b : a),
            undefined,
          )
        : setup.filter((c) => c.amount >= wanted).sort((a, b) => (a.amount < b.amount ? -1 : 1))[0];
    if (coin === undefined) {
      throw new ServiceError(
        setup.length > 0 && opts.all !== true ? 'insufficient_funds' : 'insufficient_funds',
      );
    }
    const launch = launchVault(coinId(coin), record.publicKey);
    const plan = opts.all === true ? sweepTo(outputs, coin.amount - 1n) : outputs;
    const paid = plan.reduce((sum, o) => sum + o.amount, 0n);
    const change = coin.amount - 1n - paid - fee;
    if (change < 0n) throw new ServiceError('insufficient_funds');
    const conditions: Condition[] = [
      ...launch.conditions,
      ...payments(plan),
      ...(change > 0n ? payments([{ puzzleHash: launch.moneyPuzzleHash, amount: change }]) : []),
      ...(fee > 0n ? [{ kind: 'reserveFee' as const, amount: fee }] : []),
    ];
    const unsigned = buildSetupSpend({
      publicKey: record.publicKey,
      coin,
      conditions,
      alsoSpend: [launch.launcherSpend],
    });
    const bundle = unsigned.finish(await keyStore.sign(unsigned.challenge));
    await chain.pushTx(bundle);
    await keyStore.setLauncher(launch.launcherId);
    const out = plan[0];
    if (out === undefined) throw new ServiceError('unknown');
    return {
      first: coin,
      firstOutput: { parentCoinInfo: coinId(coin), puzzleHash: out.puzzleHash, amount: out.amount },
      total: paid,
      more: opts.all === true && setup.length > 1,
    };
  }

  /** Everything (minus the fee) to the first output's address. */
  function sweepTo(outputs: Output[], total: bigint): Output[] {
    const [target] = outputs;
    if (target === undefined) throw new ServiceError('unknown');
    const amount = total - fee;
    if (amount <= 0n) throw new ServiceError('insufficient_funds');
    return [{ puzzleHash: target.puzzleHash, amount }];
  }

  /**
   * Where a claim sends a share: the vault's address once it exists; otherwise the claim also
   * launches it, paid out of the share (1 mojo), so the money is visible at once and the vault
   * is there from the next block. While a launch is still unconfirmed, claims go to the setup
   * address instead, so no money can be sent to a vault that might never exist.
   */
  async function claimDestination(
    record: VaultRecord,
  ): Promise<{ to: To; launches: Map<string, Bytes> }> {
    const launches = new Map<string, Bytes>();
    if (record.launcherId !== null) {
      const vault = await currentVault(chain, record.publicKey, record.launcherId);
      return {
        to: vault !== null ? moneyPuzzleHash(record.launcherId) : setupPuzzleHash(record.publicKey),
        launches,
      };
    }
    const to = (spent: Coin): Destination => {
      const launch = launchVault(coinId(spent), record.publicKey);
      launches.set(toHex(coinId(spent)), launch.launcherId);
      return {
        puzzleHash: launch.moneyPuzzleHash,
        conditions: launch.conditions,
        spends: [launch.launcherSpend],
        cost: 1n,
      };
    };
    return { to, launches };
  }

  /**
   * The envelopes this browser made on this network. Where one site serves both networks
   * (localhost), the list holds both; a link says its chain (`net=` on testnet).
   */
  function sentHere(): SentRecord[] {
    return state.sent().filter((record) => {
      try {
        return (networkFromSearch(new URL(record.link).search) ?? 'mainnet') === network.name;
      } catch {
        return false;
      }
    });
  }

  /** The addresses of an old wallet (keys in the browser), from what the old app remembered. */
  function legacyAddresses(): string[] {
    const out: string[] = [];
    const earlier = state.earlierAddress(network.name);
    if (earlier !== null) out.push(earlier);
    const old = state.legacyAddress(network.name);
    if (old !== null) out.push(old);
    return [...new Set(out)];
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
      current: async () => {
        // A wallet from the time before the vault: remember its address for the move, and let
        // the first tap make the new wallet.
        const info = state.wallet(network.name);
        if (info !== null && (await keyStore.status()) === null && legacy !== null) {
          if ((await legacy.status()) !== null) {
            state.setLegacyAddress(network.name, info.address);
            state.clearWallet();
            return null;
          }
        }
        return info;
      },

      ensure: () =>
        guarded(async (): Promise<WalletInfo> => {
          try {
            return await adopt(await ensureRecord());
          } catch (error) {
            const mapped = toServiceError(error);
            if (mapped.code === 'no_wallet_here') throw new ServiceError('passkey_unavailable');
            throw mapped;
          }
        }),

      earlier: () =>
        guarded(async () => {
          const addresses = legacyAddresses();
          if (addresses.length === 0) return null;
          const records = await chain.coinRecordsByPuzzleHashes(
            addresses.map((a) => decodeAddress(a).puzzleHash),
          );
          const balance = records.reduce((sum, record) => sum + record.coin.amount, 0n);
          const [first] = addresses;
          return balance > 0n && first !== undefined ? { address: first, balance } : null;
        }),

      moveEarlier: () =>
        guarded(async () => {
          if (legacy === null || (await legacy.status()) === null) {
            throw new ServiceError('unknown', 'there is no old wallet here');
          }
          const record = await ensureRecord();
          // The old key, one last time: it signs the move and is wiped at once.
          const opened = await legacy.unlock();
          const olds: Account[] = [];
          try {
            olds.push(accountFromSeed(opened.seed, network));
            if (opened.earlierSeed !== undefined) {
              olds.push(accountFromSeed(opened.earlierSeed, network));
            }
          } finally {
            wipe(opened);
          }
          try {
            const records = await chain.coinRecordsByPuzzleHashes(olds.map((o) => o.puzzleHash));
            const inputs = records
              .map((r) => r.coin)
              .sort((a, b) => (a.amount < b.amount ? 1 : a.amount > b.amount ? -1 : 0))
              .slice(0, MAX_INPUTS)
              .map((coin) => {
                const owner = olds.find((o) => toHex(o.puzzleHash) === toHex(coin.puzzleHash));
                if (owner === undefined) throw new ServiceError('unknown');
                return { coin, signer: owner };
              });
            const first = inputs[0];
            if (first === undefined) throw new ServiceError('insufficient_funds');
            const { to, launches } = await claimDestination(record);
            const { bundle, amount, destination } = buildSweep({
              inputs,
              toPuzzleHash: to,
              fee,
              network,
            });
            await chain.pushTx(bundle);
            const launched = launches.get(toHex(coinId(first.coin)));
            if (launched !== undefined) await keyStore.setLauncher(launched);
            const output: Coin = {
              parentCoinInfo: coinId(first.coin),
              puzzleHash: destination.puzzleHash,
              amount,
            };
            const more = records.length > inputs.length;
            const confirmed = track(amount, landed(first.coin, output)).then(async () => {
              if (!more && legacy !== null) {
                await legacy.forget();
                state.clearLegacy(network.name);
              }
            });
            return { amount, confirmed, more };
          } finally {
            for (const old of olds) {
              old.syntheticSk.fill(0);
              old.envelopeRoot.fill(0);
            }
          }
        }),

      canMakeNew: () => guarded(async () => (await keyStore.status()) !== null),

      makeNew: () =>
        guarded(async (): Promise<WalletInfo> => adopt(await keyStore.create(walletLabel()))),

      balance: () =>
        guarded(async (): Promise<Balance> => {
          const record = await knownRecord();
          if (record === null) return { confirmed: 0n, pending: 0n };
          // Public data only: reading the balance never needs the passkey.
          const { money, setup } = await walletCoins(chain, record.publicKey, record.launcherId);
          const confirmed = [...money, ...setup].reduce((sum, coin) => sum + coin.amount, 0n);
          // The address shown moves to the vault's once the vault is on the chain.
          await adopt(record);
          return { confirmed, pending };
        }),

      send: (to, amount) =>
        guarded(async () => {
          const toPuzzleHash = await recipient(to);
          const { first, firstOutput } = await pay([{ puzzleHash: toPuzzleHash, amount }]);
          // Accepted by the network: this is the first moment the name has been paid, and the
          // only one that should make it a name this person trusts.
          const handle = parseHandle(to);
          if (to.trim().startsWith('@') && handle !== null) state.rememberPaidHandle(handle);
          return { confirmed: track(-(amount + fee), landed(first, firstOutput)) };
        }),

      moveToKlimper: (to) =>
        guarded(async () => {
          let puzzleHash: Bytes;
          try {
            const decoded = decodeAddress(to.trim());
            if (decoded.prefix !== network.addressPrefix) throw new Error('other network');
            puzzleHash = decoded.puzzleHash;
          } catch {
            throw new ServiceError('invalid_recipient');
          }
          const { first, firstOutput, total, more } = await pay([{ puzzleHash, amount: 0n }], {
            all: true,
          });
          return {
            amount: total,
            confirmed: track(-(total + fee), landed(first, firstOutput)),
            more,
          };
        }),

      // One tap on the envelope: the wallet of this browser, otherwise the one this person
      // already has somewhere else. It never creates: WebAuthn answers "there is no passkey
      // here" and "you dismissed the prompt" with the same NotAllowedError, so a keystore
      // cannot tell a new person from a hesitant one. Making one is a separate, asked-for step.
      open: () =>
        guarded(async (): Promise<WalletInfo> => {
          const here = await knownRecord();
          if (here !== null) return adopt(here);
          return adopt(await signIn());
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
              ...(state.wallet(network.name) === null
                ? {}
                : { ownAddress: state.wallet(network.name)?.address }),
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

      canRestoreElsewhere: () => guarded(async () => (await keyStore.status()) !== null),

      forget: () =>
        guarded(async () => {
          await keyStore.forget();
          state.clearWallet();
        }),
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
          // A prompt only for a person without a wallet here: claiming needs an address, and
          // the share's own key (from the link) signs.
          const record = await ensureRecord();
          const { to, launches } = await claimDestination(record);
          const opened = await openEnvelope({
            chain,
            envelopeSk: keys.secretKey,
            envelopePk: keys.publicKey,
            ...(link.shares === undefined ? {} : { sharesHint: link.shares }),
            toPuzzleHash: to,
            fee,
            network,
          });
          const launched = launches.get(toHex(coinId(opened.share.coin)));
          if (launched !== undefined) await keyStore.setLauncher(launched);
          await adopt(await requireRecord());
          state.setOpened(id, opened.received);
          const confirmed = landed(opened.share.coin, opened.output).catch(
            async (error: unknown) => {
              // Somebody else's claim of the same share won after all: let this person try
              // again, and forget a launch that never happened.
              if (error instanceof EnvelopeError && error.code === 'lost_race') {
                state.clearOpened(id);
                if (launched !== undefined) await keyStore.setLauncher(null);
              }
              throw toServiceError(error);
            },
          );
          return { amount: opened.received, confirmed: track(opened.received, confirmed) };
        }),

      create: (input) =>
        guarded(async (): Promise<SentEnvelope> => {
          const amounts = splitAmounts(input.total, input.shares, input.mode, {
            floor: fee + MIN_SHARE_AFTER_FEE,
          });
          // A random secret: nothing about an envelope is derived from the wallet any more.
          // The link is kept below; it is how this browser takes the envelope back.
          const secret = globalThis.crypto.getRandomValues(new Uint8Array(SECRET_BYTES));
          const keys = envelopeKeys(secret);
          const { first, firstOutput } = await pay(
            amounts.map((amount, index) => ({
              puzzleHash: sharePuzzleHash(keys.publicKey, index),
              amount,
            })),
          );
          const counter = state.nextEnvelopeCounter();
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
          track(-(input.total + fee), landed(first, firstOutput)).catch(() => {});
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

      listSent: () => guarded(() => Promise.all(sentHere().map(describe))),

      takeBack: (id) =>
        guarded(async () => {
          const record = sentHere().find((entry) => entry.id === id);
          const wallet = await knownRecord();
          if (record === undefined || wallet === null) throw new ServiceError('unknown');
          // The envelope's own secret signs; the wallet's passkey is not needed, so no prompt.
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
            toPuzzleHash: await receivingPuzzleHash(wallet),
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
    keyStore: createVaultKeyStore({
      network: network.name,
      rpName: 'Clap and Pay',
      ...rpIdOption(location.hostname),
    }),
    legacyKeyStore: createKeyStore({ rpName: 'Clap and Pay', ...rpIdOption(location.hostname) }),
    state: createLocalState(localStorage),
    origin: String(env.VITE_PUBLIC_ORIGIN ?? location.origin),
    fetch: (input, init) => fetch(input, init),
    now: () => Math.floor(Date.now() / 1000),
    fee: feeFromEnv(env.VITE_FEE_MOJOS, network.name),
    handlesApi: handlesApiFor(network.name, env.VITE_HANDLES_API),
    expirySeconds: WEEK,
  });
}
