// SPDX-License-Identifier: AGPL-3.0-or-later
// What this browser remembers between visits. Everything here is either public (the wallet's
// address) or already in the sender's chat history (their own envelope links). Storage that
// refuses to work (private windows, some in-app browsers) degrades to memory for the session.
import type { WalletInfo } from './types';

/** One envelope this browser sent. Amounts are decimal strings: JSON has no bigint. */
export interface SentRecord {
  id: string;
  counter: number;
  link: string;
  createdAt: number;
  total: string;
  shares: number;
  takenBack: { amount: string; shares: number } | null;
}

/** The remembered state, behind functions so it can be faked. */
export interface LocalState {
  /**
   * The wallet remembered for `network`. A record made on another chain is not returned: an
   * address carries its chain in its prefix, and handing a `txch1…` to somebody on mainnet
   * gives them an address nobody can pay.
   */
  wallet(network: string): WalletInfo | null;
  setWallet(network: string, info: WalletInfo): void;
  /** Forgets the remembered wallet, whatever chain it was for. */
  clearWallet(): void;
  /**
   * The address of the wallet a passkey held before 24 words (TASK-128), for `network`, as
   * the old app remembered it. Public: its balance is read without a prompt.
   */
  earlierAddress(network: string): string | null;
  setEarlierAddress(network: string, address: string): void;
  /**
   * The address of this browser's wallet from before the passkey vault (its keys lived in the
   * browser), until its money has been moved into the vault.
   */
  legacyAddress(network: string): string | null;
  setLegacyAddress(network: string, address: string): void;
  /** Forgets both old addresses: the old wallet's money has moved. */
  clearLegacy(network: string): void;
  /** What this browser got out of envelope `id`, or null. */
  openedAmount(id: string): bigint | null;
  setOpened(id: string, amount: bigint): void;
  clearOpened(id: string): void;
  sent(): SentRecord[];
  /** Handles this browser has successfully paid, most recent first. */
  paidHandles(): string[];
  /** Remembers `handle` (bare, lowercase) as one this person has paid. */
  rememberPaidHandle(handle: string): void;
  addSent(record: SentRecord): void;
  markTakenBack(id: string, takenBack: NonNullable<SentRecord['takenBack']>): void;
  /** A fresh number for the next envelope's secret; never handed out twice. */
  nextEnvelopeCounter(): number;
}

const KEY = {
  wallet: 'ge.wallet',
  opened: 'ge.opened',
  sent: 'ge.sent',
  counter: 'ge.counter',
  paidHandles: 'ge.paidHandles',
  earlier: 'ge.earlier',
  legacy: 'ge.legacy',
};

/** How many paid handles are remembered; enough to be the person's circle, not their history. */
const MAX_PAID_HANDLES = 12;

/** Minimal storage: `localStorage`, or anything shaped like it. */
export type StringStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** Creates the state on top of `storage`. */
export function createLocalState(storage: StringStorage): LocalState {
  const memory = new Map<string, string>();

  function read<T>(key: string, fallback: T): T {
    try {
      const text = memory.get(key) ?? storage.getItem(key);
      return text === null ? fallback : (JSON.parse(text) as T);
    } catch {
      return fallback;
    }
  }

  function write(key: string, value: unknown): void {
    const text = JSON.stringify(value);
    memory.set(key, text);
    try {
      storage.setItem(key, text);
    } catch {
      // Kept in memory for this session.
    }
  }

  const opened = () => read<Record<string, string>>(KEY.opened, {});

  return {
    wallet: (network) => {
      const stored = read<(WalletInfo & { network?: string }) | null>(KEY.wallet, null);
      if (stored === null) return null;
      // A record written before this field existed, or on another chain: not this one's.
      if (stored.network !== network) return null;
      return { kind: stored.kind, address: stored.address };
    },
    setWallet: (network, info) => write(KEY.wallet, { ...info, network }),
    clearWallet: () => {
      write(KEY.wallet, null);
    },
    earlierAddress: (network) => {
      const stored = read<{ network: string; address: string } | null>(KEY.earlier, null);
      return stored !== null && stored.network === network ? stored.address : null;
    },
    setEarlierAddress: (network, address) => write(KEY.earlier, { network, address }),
    legacyAddress: (network) => {
      const stored = read<{ network: string; address: string } | null>(KEY.legacy, null);
      return stored !== null && stored.network === network ? stored.address : null;
    },
    setLegacyAddress: (network, address) => write(KEY.legacy, { network, address }),
    clearLegacy: (network) => {
      if (read<{ network: string } | null>(KEY.legacy, null)?.network === network) {
        write(KEY.legacy, null);
      }
      if (read<{ network: string } | null>(KEY.earlier, null)?.network === network) {
        write(KEY.earlier, null);
      }
    },

    openedAmount(id) {
      const amount = opened()[id];
      return amount === undefined ? null : BigInt(amount);
    },
    setOpened: (id, amount) => write(KEY.opened, { ...opened(), [id]: amount.toString() }),
    clearOpened(id) {
      const { [id]: _removed, ...rest } = opened();
      write(KEY.opened, rest);
    },

    paidHandles: () => read<string[]>(KEY.paidHandles, []),
    rememberPaidHandle: (handle) => {
      const kept = read<string[]>(KEY.paidHandles, []).filter((entry) => entry !== handle);
      write(KEY.paidHandles, [handle, ...kept].slice(0, MAX_PAID_HANDLES));
    },
    sent: () => read<SentRecord[]>(KEY.sent, []),
    addSent(record) {
      write(KEY.sent, [record, ...read<SentRecord[]>(KEY.sent, [])]);
    },
    markTakenBack(id, takenBack) {
      write(
        KEY.sent,
        read<SentRecord[]>(KEY.sent, []).map((r) => (r.id === id ? { ...r, takenBack } : r)),
      );
    },

    nextEnvelopeCounter() {
      const next = read<number>(KEY.counter, 0);
      write(KEY.counter, next + 1);
      return next;
    },
  };
}
