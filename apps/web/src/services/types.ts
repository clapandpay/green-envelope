// SPDX-License-Identifier: AGPL-3.0-or-later
// The seam between screens and everything else. Screens import only from here.
// Amounts are mojos (1 XCH = 1_000_000_000_000 mojos) as bigint; the UI converts for display.

export type WalletKind = 'passkey' | 'device';

export interface WalletInfo {
  kind: WalletKind;
  address: string;
}

/** How the network fee is chosen: asked of the network per transaction, or a fixed amount. */
export type FeePolicy = { mode: 'auto' } | { mode: 'fixed'; mojos: bigint };

/** The fee setting, and what a send would cost with it right now. */
export interface FeeInfo {
  policy: FeePolicy;
  /** The fee of a typical send now, in mojos; for `auto`, the network's current estimate. */
  current: bigint;
}

export interface Balance {
  confirmed: bigint;
  /** Incoming or outgoing amounts the network has accepted but not yet confirmed. */
  pending: bigint;
}

export type ServiceErrorCode =
  | 'bad_link'
  | 'envelope_not_ready' // the link is ahead of the network: sent seconds ago, not landed yet
  | 'envelope_empty' // every share is opened
  | 'envelope_expired' // taken back by the sender
  | 'already_opened' // this browser already opened a share of this envelope
  | 'insufficient_funds'
  | 'invalid_recipient'
  | 'handle_not_found' // nobody has this @name
  | 'handle_expired' // the name lapsed and can be claimed by anyone
  | 'handle_not_payable' // the name exists but owns nothing that can take money
  | 'handles_unavailable' // the registry did not answer; an address still works
  | 'handles_mainnet_only' // @names live on the real network only
  | 'no_wallet_here' // nothing to open on this device: no wallet in this browser, no passkey
  | 'passkey_unavailable' // no passkey can be made or used here: say so; never a browser-only wallet
  | 'wallet_settling' // the vault's last transaction is not confirmed yet: try again in a minute
  | 'wallet_cancelled' // the user dismissed the passkey prompt
  | 'network'
  | 'unknown';

export class ServiceError extends Error {
  constructor(
    public readonly code: ServiceErrorCode,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export interface EnvelopeView {
  id: string;
  from: string | null;
  message: string | null;
  sharesTotal: number;
  sharesLeft: number;
  /** Set when this browser already opened a share. */
  openedAmount: bigint | null;
  /**
   * The coin that paid for the envelope (hex): every share is a child of it, so its page on a
   * block explorer shows all shares and which are opened. Null when not known.
   */
  fundingCoinId: string | null;
}

export interface OpenResult {
  amount: bigint;
  /** The coin the money lands in (hex): what a block explorer shows. */
  coinId: string;
  /** Resolves when the claim is confirmed on chain (about a minute). */
  confirmed: Promise<void>;
}

export interface CreateEnvelopeInput {
  total: bigint;
  shares: number;
  mode: 'random' | 'equal';
  from: string | null;
  message: string | null;
  /** The quoted network fee (`quotePayment`), so the fee shown is the fee paid. */
  fee?: bigint;
}

export interface SentEnvelope {
  id: string;
  link: string;
  createdAt: number; // unix seconds
  expiresAt: number;
  total: bigint;
  sharesTotal: number;
  sharesOpened: number;
  amountOpened: bigint;
  status: 'pending' | 'active' | 'finished' | 'taken_back';
}

/** What an `@name` stands for, and whether it is dressed up as one you already trust. */
export interface HandleLookup {
  /** Bare and lowercase, without the `@`. */
  handle: string;
  /** The address the money would go to, in full, to show before sending. */
  address: string;
  /** An ownership change is queued on chain: it may be about to change hands. */
  pendingTransfer: boolean;
  /**
   * A handle this person has paid before that this one appears to imitate, or null.
   * Null also means "we could not check": an absent warning is never an all-clear.
   */
  imitates: string | null;
}

/** Which of several pasted candidates is the recipient; `value` null means "none of them". */
export interface RecipientPick {
  value: string | null;
  /** 0 to 1. Low means the screen should ask rather than fill the field. */
  confidence: number;
}

export interface WalletService {
  /** Null when this device has no wallet yet. Never prompts. */
  current(): Promise<WalletInfo | null>;
  /**
   * The wallet of this browser, made if there is none. Never prompts when this browser already
   * knows its passkey: opening needs public data only. Otherwise one tap: the passkey the phone
   * already has for this site, else a new one (the phone's own sheet asks). Rejects with
   * `passkey_unavailable` when no passkey can be made here; never makes a browser-only wallet.
   */
  ensure(): Promise<WalletInfo>;
  /**
   * Money in this person's old wallet (one from before the passkey vault: its keys lived in the
   * browser), or null when there is none. Never prompts.
   */
  earlier(): Promise<{ address: string; balance: bigint } | null>;
  /**
   * Moves the old wallet's money into this one: the old key is opened one last time, and the
   * transaction also launches the vault when there is none yet. `more` is true when coins were
   * left for another move (a transaction takes at most 50).
   */
  moveEarlier(): Promise<{ amount: bigint; confirmed: Promise<void>; more: boolean }>;
  /** The network fee setting and what a send costs with it now. Never prompts. */
  fee(): Promise<FeeInfo>;
  /** Chooses the network fee for this network: automatic, or a fixed amount. */
  setFee(policy: FeePolicy): Promise<FeeInfo>;
  /** Whether `makeNew` is possible: there is a passkey here to replace. */
  canMakeNew(): Promise<boolean>;
  /**
   * Makes a new passkey and uses it here instead of the current one ("create a new passkey").
   * The old passkey and its vault are untouched; signing in with it brings them back.
   */
  makeNew(): Promise<WalletInfo>;
  balance(): Promise<Balance>;
  /**
   * The network fee of paying `amount` (or everything, `'all'`) now, and what arrives. Shown
   * before every payment, and handed back to it: the fee shown is the fee paid. Never prompts.
   */
  quotePayment(amount: bigint | 'all'): Promise<{ fee: bigint; arriving: bigint }>;
  /**
   * `to` is an address or an @handle. One passkey prompt. `fee`: the quoted fee. `address`: for
   * an @handle, the address the person was shown and confirmed; it is what gets paid, so a
   * registry that answers differently the second time cannot redirect the money.
   */
  send(
    to: string,
    amount: bigint,
    fee?: bigint,
    address?: string,
  ): Promise<{ confirmed: Promise<void>; coinId: string }>;
  /**
   * Sends everything to `address` (Klimper's receive address), in one prompt per 50 coins.
   * Rejects with `invalid_recipient` for an address of another network.
   */
  moveToKlimper(
    address: string,
    fee?: bigint,
  ): Promise<{ amount: bigint; confirmed: Promise<void>; more: boolean; coinId: string }>;
  /**
   * Opens the wallet of this browser, or finds the one this person has elsewhere with the
   * passkey they hold. **Never creates one**: rejects with `no_wallet_here` or
   * `wallet_cancelled`, which a screen cannot tell apart because WebAuthn cannot either.
   */
  open(): Promise<WalletInfo>;
  /**
   * Chooses between recipients found in one pasted block of text. Only asked when the browser
   * found more than one; resolves to null when there is no suggestion, and the screen then asks
   * the person. Never invents a recipient: the answer is always one of `candidates`.
   */
  pickRecipient(text: string, candidates: readonly string[]): Promise<RecipientPick | null>;
  /**
   * Resolves an `@name` to the address it pays, and screens it against the names this person
   * has paid before. Rejects with the `handle_*` code that says what is actually wrong.
   */
  lookupHandle(input: string): Promise<HandleLookup>;
  /**
   * Whether this wallet comes back after `forget()`: always, for a passkey vault (sign in with
   * the passkey). False only for an old wallet whose key lived in this browser alone.
   */
  canRestoreElsewhere(): Promise<boolean>;
  /** Forgets the wallet on this device. Ask first: see `canRestoreElsewhere`. */
  forget(): Promise<void>;
}

export interface EnvelopeService {
  inspect(link: string): Promise<EnvelopeView>;
  open(link: string): Promise<OpenResult>;
  create(input: CreateEnvelopeInput): Promise<SentEnvelope>;
  listSent(): Promise<SentEnvelope[]>;
  /** The network fee of taking `id` back now, paid out of the unopened shares. */
  quoteTakeBack(id: string): Promise<bigint>;
  takeBack(id: string, fee?: bigint): Promise<{ amount: bigint; confirmed: Promise<void> }>;
  /**
   * Removes a finished or taken-back envelope from this browser's list. Refuses one that is
   * still open: its stored link is the only way to take it back.
   */
  remove(id: string): Promise<void>;
}

export interface PriceService {
  /** Null when no price is available; the UI then shows XCH only. */
  eurPerXch(): Promise<number | null>;
}

export interface AppServices {
  network: 'mainnet' | 'testnet11';
  wallet: WalletService;
  envelopes: EnvelopeService;
  price: PriceService;
}
