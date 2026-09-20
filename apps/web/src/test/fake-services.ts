// SPDX-License-Identifier: AGPL-3.0-or-later
// An in-memory AppServices, for tests only. Deterministic: no Math.random, no wall-clock
// decisions. Behaviour is switched with flags passed in code.
//
// This lives under test/ and nothing in the app imports it. It used to be reachable at runtime
// through `?mock=` and a build flag, which meant the app a person was looking at might not be
// the app at all. The app now has one set of services: the real ones.
import type { NetworkName } from '../lib/network';
import {
  type AppServices,
  type Balance,
  type CreateEnvelopeInput,
  type EnvelopeView,
  type HandleLookup,
  type RecipientPick,
  type SentEnvelope,
  ServiceError,
  type WalletInfo,
} from '../services/types';

export const FAKE_FLAGS = [
  'empty', // every share of the envelope is opened
  'expired', // the sender took the envelope back
  'already', // this browser opened it before
  'bad', // the link is broken
  'slow', // 2.5 s per call, 20 s to confirm
  'offline', // every call fails with `network`
  'nopick', // the recipient suggestion is unavailable
  'nohandles', // the handle registry does not answer
  'flaky', // the first look at an envelope fails with `network`, everything after works
  'cancel', // the first passkey prompt is dismissed
  'noprice', // no euro price
  'funded', // a wallet with money and two sent envelopes exists
  'device', // the wallet is a device wallet that can be secured with a passkey
  'mainnet', // no testnet badge
  'nopasskey', // this device has no wallet and no passkey to sign in with
] as const;
export type FakeFlag = (typeof FAKE_FLAGS)[number];

export interface FakeOptions {
  flags?: Iterable<FakeFlag>;
  /** Delay of every call. Default 400 ms (slow: 2500 ms). */
  latencyMs?: number;
  /** Time until a `confirmed` promise resolves. Default 6 s (slow: 20 s). */
  confirmMs?: number;
  origin?: string;
  now?: () => number;
  /** Which chain the demo pretends to be on. Default: the `mainnet` flag, else testnet11. */
  network?: NetworkName;
}

const XCH = 1_000_000_000_000n;
const MOCK_EUR_PER_XCH = 25;
const WEEK_SECONDS = 7 * 24 * 60 * 60;
const FAKE_ADDRESS = 'txch1h7kq3m0p9fj2u8s4x6w5e7r9t0y2a4c6d8g0l3n5v7z9k2m4p6q8s0sq4u';
// The demo envelope: 20 € at the mock price, five shares, two already gone. The next is 7.40 €.
const DEMO_SHARES = [296_000_000_000n, 180_000_000_000n, 124_000_000_000n];
const DEMO_TOTAL_SHARES = 5;

interface StoredEnvelope {
  from: string | null;
  message: string | null;
  /** Unopened share amounts, next to be opened first. */
  left: bigint[];
  sharesTotal: number;
  takenBack: boolean;
  sent: SentEnvelope | null;
}

/** Small deterministic generator (mulberry32) so random splits are repeatable. */
function generator(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The WeChat rule, simplified: each share is between a floor and twice the mean of the rest. */
export function mockSplit(total: bigint, shares: number, mode: 'random' | 'equal', seed = 1) {
  const count = BigInt(shares);
  if (mode === 'equal') {
    const each = total / count;
    return Array.from({ length: shares }, (_, i) => (i === 0 ? total - each * (count - 1n) : each));
  }
  const random = generator(seed);
  const floor = total / (count * 10n);
  const amounts: bigint[] = [];
  let rest = total;
  for (let i = shares; i > 1; i--) {
    const others = BigInt(i - 1);
    const span = (rest * 2n) / BigInt(i) - floor;
    let amount = floor + (span * BigInt(Math.floor(random() * 10_000))) / 10_000n;
    if (rest - amount < floor * others) amount = rest - floor * others;
    amounts.push(amount);
    rest -= amount;
  }
  amounts.push(rest);
  return amounts;
}

function sum(amounts: readonly bigint[]): bigint {
  return amounts.reduce((a, b) => a + b, 0n);
}

/** Creates the mock. All state lives in the returned object's closure. */

export function createFakeServices(options: FakeOptions = {}): AppServices {
  const flags = new Set(options.flags ?? []);
  const slow = flags.has('slow');
  const latencyMs = options.latencyMs ?? (slow ? 2500 : 400);
  const confirmMs = options.confirmMs ?? (slow ? 20_000 : 6000);
  const origin = options.origin ?? 'https://clapandpay.com';
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));
  const network = options.network ?? (flags.has('mainnet') ? 'mainnet' : 'testnet11');

  let wallet: WalletInfo | null = null;
  let confirmed = 0n;
  let pending = 0n;
  let inspections = 0;
  let prompts = 0;
  let counter = 0;
  const envelopes = new Map<string, StoredEnvelope>();
  const openedHere = new Map<string, bigint>();

  const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  async function call<T>(work: () => T | PromiseLike<T>): Promise<T> {
    await wait(latencyMs);
    if (flags.has('offline')) {
      throw new ServiceError('network');
    }
    return work();
  }

  /** Money that shows as pending first and as confirmed after `confirmMs`. */
  function arrive(amount: bigint): Promise<void> {
    pending += amount;
    return wait(confirmMs).then(() => {
      pending -= amount;
      confirmed += amount;
    });
  }

  function newWallet(): WalletInfo {
    return { kind: flags.has('device') ? 'device' : 'passkey', address: FAKE_ADDRESS };
  }

  function store(input: CreateEnvelopeInput): SentEnvelope {
    counter += 1;
    const id = `mock${counter.toString().padStart(4, '0')}`;
    const query = new URLSearchParams();
    if (input.from) query.set('from', input.from);
    if (input.message) query.set('m', input.message);
    const search = query.toString() === '' ? '' : `?${query}`;
    const sent: SentEnvelope = {
      id,
      link: `${origin}/g/${id}${search}#c2VjcmV0LW1vY2s`,
      createdAt: now(),
      expiresAt: now() + WEEK_SECONDS,
      total: input.total,
      sharesTotal: input.shares,
      sharesOpened: 0,
      amountOpened: 0n,
      status: 'pending',
    };
    envelopes.set(id, {
      from: input.from,
      message: input.message,
      left: mockSplit(input.total, input.shares, input.mode, counter),
      sharesTotal: input.shares,
      takenBack: false,
      sent,
    });
    return sent;
  }

  function lookup(link: string): { id: string; envelope: StoredEnvelope } {
    let url: URL;
    try {
      url = new URL(link, origin);
    } catch {
      throw new ServiceError('bad_link');
    }
    const id = /^\/g\/([A-Za-z0-9_-]{4,})$/.exec(url.pathname)?.[1];
    if (!id || flags.has('bad')) throw new ServiceError('bad_link');
    let envelope = envelopes.get(id);
    if (!envelope) {
      envelope = {
        from: url.searchParams.get('from') ?? 'Anna',
        message: url.searchParams.get('m') ?? 'Happy birthday! 🎂',
        left: flags.has('empty') ? [] : [...DEMO_SHARES],
        sharesTotal: DEMO_TOTAL_SHARES,
        takenBack: flags.has('expired'),
        sent: null,
      };
      envelopes.set(id, envelope);
      if (flags.has('already')) openedHere.set(id, DEMO_SHARES[0] ?? 0n);
    }
    return { id, envelope };
  }

  function view(id: string, envelope: StoredEnvelope): EnvelopeView {
    return {
      id,
      from: envelope.from,
      message: envelope.message,
      sharesTotal: envelope.sharesTotal,
      sharesLeft: envelope.left.length,
      openedAmount: openedHere.get(id) ?? null,
    };
  }

  if (flags.has('funded')) {
    wallet = newWallet();
    confirmed = (XCH * 3n) / 2n;
    const first = store({
      total: XCH / 5n,
      shares: 5,
      mode: 'random',
      from: 'Anna',
      message: 'Prost!',
    });
    first.status = 'active';
    first.sharesOpened = 3;
    const opened = envelopes.get(first.id)?.left.splice(0, 3) ?? [];
    first.amountOpened = sum(opened);
    const second = store({
      total: XCH / 10n,
      shares: 2,
      mode: 'equal',
      from: 'Anna',
      message: null,
    });
    second.status = 'finished';
    second.sharesOpened = 2;
    second.amountOpened = second.total;
    envelopes.get(second.id)?.left.splice(0);
  }

  return {
    network,
    wallet: {
      current: () => call(() => wallet),
      ensure: () =>
        call(() => {
          prompts += 1;
          if (flags.has('cancel') && prompts === 1) throw new ServiceError('wallet_cancelled');
          wallet ??= newWallet();
          return wallet;
        }),
      // Opens what exists; never makes one. `nopasskey` is a device with nothing on it, which
      // is what a person who has never been here looks like — and what WebAuthn cannot tell
      // apart from a dismissed prompt.
      open: () =>
        call(() => {
          prompts += 1;
          if (flags.has('cancel') && prompts === 1) throw new ServiceError('wallet_cancelled');
          if (wallet === null && flags.has('nopasskey')) throw new ServiceError('no_wallet_here');
          wallet ??= newWallet();
          return wallet;
        }),
      balance: () => call((): Balance => ({ confirmed, pending })),
      send: (to, amount) =>
        call(() => {
          if (!/^(@[\w.-]{2,30}|t?xch1[a-z0-9]{20,})$/i.test(to.trim())) {
            throw new ServiceError('invalid_recipient');
          }
          if (amount <= 0n || amount > confirmed) throw new ServiceError('insufficient_funds');
          confirmed -= amount;
          return { confirmed: wait(confirmMs) };
        }),
      connectRequest: (search) =>
        call(() => {
          const key = new URLSearchParams(search).get('k') ?? '';
          if (flags.has('bad') || key.length < 20) throw new ServiceError('bad_request');
          return { checkCode: '481 516'.replace(' ', '') };
        }),
      connectApprove: (search) =>
        call(() => {
          prompts += 1;
          if (flags.has('cancel') && prompts === 1) throw new ServiceError('wallet_cancelled');
          if (wallet === null && flags.has('nopasskey')) throw new ServiceError('no_wallet_here');
          wallet ??= newWallet();
          return `cp1.${btoa(`mock handoff for ${search.length} ${wallet.address}`).replace(/=+$/, '')}`;
        }),
      // A small cast of stand-in handles, enough to show every state the screen can be in.
      lookupHandle: (input) =>
        call((): HandleLookup => {
          const handle = input.trim().replace(/^@/, '').toLowerCase();
          if (network !== 'mainnet') throw new ServiceError('handles_mainnet_only');
          if (handle === 'gone') throw new ServiceError('handle_not_found');
          if (handle === 'lapsed') throw new ServiceError('handle_expired');
          if (handle === 'empty') throw new ServiceError('handle_not_payable');
          if (flags.has('nohandles')) throw new ServiceError('handles_unavailable');
          if (!/^[a-z0-9]{3,63}$/.test(handle)) throw new ServiceError('invalid_recipient');
          return {
            handle,
            address: FAKE_ADDRESS,
            pendingTransfer: handle === 'moving',
            // `@c1apandpay` is the demo's lookalike: one character off a handle already paid.
            imitates: handle === 'c1apandpay' ? '@clapandpay' : null,
          };
        }),

      // No judgment behind this one: the last candidate mentioned is the usual intent ("not
      // that one, this one"), which is enough to exercise the screen.
      pickRecipient: (_text, candidates) =>
        call((): RecipientPick | null => {
          if (candidates.length < 2) return null;
          if (flags.has('nopick')) return null;
          return { value: candidates[candidates.length - 1] ?? null, confidence: 0.92 };
        }),

      canUpgradeToPasskey: () => call(() => wallet?.kind === 'device'),
      upgradeToPasskey: () =>
        call(() => {
          wallet = { kind: 'passkey', address: FAKE_ADDRESS };
          return wallet;
        }),
    },
    envelopes: {
      inspect: (link) =>
        call(() => {
          inspections += 1;
          if (flags.has('flaky') && inspections === 1) throw new ServiceError('network');
          const { id, envelope } = lookup(link);
          if (openedHere.has(id)) return view(id, envelope);
          if (envelope.takenBack) throw new ServiceError('envelope_expired');
          return view(id, envelope);
        }),
      open: (link) =>
        call(() => {
          const { id, envelope } = lookup(link);
          if (openedHere.has(id)) throw new ServiceError('already_opened');
          if (envelope.takenBack) throw new ServiceError('envelope_expired');
          const amount = envelope.left.shift();
          if (amount === undefined) throw new ServiceError('envelope_empty');
          openedHere.set(id, amount);
          const { sent } = envelope;
          if (sent) {
            sent.sharesOpened += 1;
            sent.amountOpened += amount;
            if (envelope.left.length === 0) sent.status = 'finished';
          }
          return { amount, confirmed: arrive(amount) };
        }),
      create: (input) =>
        call(() => {
          if (input.total <= 0n || input.total > confirmed) {
            throw new ServiceError('insufficient_funds');
          }
          confirmed -= input.total;
          const sent = store(input);
          void wait(confirmMs).then(() => {
            if (sent.status === 'pending') sent.status = 'active';
          });
          return { ...sent };
        }),
      listSent: () =>
        call(() =>
          [...envelopes.values()]
            .flatMap((envelope) => (envelope.sent ? [{ ...envelope.sent }] : []))
            .reverse(),
        ),
      takeBack: (id) =>
        call(() => {
          const envelope = envelopes.get(id);
          if (!envelope?.sent || envelope.takenBack) throw new ServiceError('envelope_expired');
          const amount = sum(envelope.left.splice(0));
          envelope.takenBack = true;
          envelope.sent.status = 'taken_back';
          return { amount, confirmed: arrive(amount) };
        }),
    },
    price: {
      eurPerXch: () => call(() => (flags.has('noprice') ? null : MOCK_EUR_PER_XCH)),
    },
  };
}
