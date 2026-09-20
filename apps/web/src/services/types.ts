// SPDX-License-Identifier: AGPL-3.0-or-later
// The seam between screens and everything else. Screens import only from here.
// Amounts are mojos (1 XCH = 1_000_000_000_000 mojos) as bigint; the UI converts for display.

export type WalletKind = 'passkey' | 'device';

export interface WalletInfo {
  kind: WalletKind;
  address: string;
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
  | 'bad_request' // a connect link that did not come from the app, or came damaged
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
}

export interface OpenResult {
  amount: bigint;
  /** Resolves when the claim is confirmed on chain (about a minute). */
  confirmed: Promise<void>;
}

export interface CreateEnvelopeInput {
  total: bigint;
  shares: number;
  mode: 'random' | 'equal';
  from: string | null;
  message: string | null;
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

/** The Klimper app asking this page for the wallet. */
export interface ConnectRequest {
  /** Six digits the app shows too. */
  checkCode: string;
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
  /** Creates a wallet silently if none exists (passkey when possible), otherwise unlocks it. */
  ensure(): Promise<WalletInfo>;
  balance(): Promise<Balance>;
  /** `to` is an address or an @handle. */
  send(to: string, amount: bigint): Promise<{ confirmed: Promise<void> }>;
  /**
   * Opens a wallet that was made somewhere else (another browser, another phone) with the passkey
   * the phone already has. Never creates one: rejects with `no_wallet_here`.
   */
  signIn(): Promise<WalletInfo>;
  /**
   * Unlocks the wallet on this device, or opens the one this person already has elsewhere with
   * the passkey they already hold. **Never creates one**: rejects with `no_wallet_here` or
   * `wallet_cancelled`, which a screen cannot tell apart because WebAuthn cannot either.
   * `ensure()` is how a wallet is made, and it has to be asked for.
   */
  open(): Promise<WalletInfo>;
  /** Checks a `/connect` request (`location.search`). Rejects with `bad_request`. */
  connectRequest(search: string): Promise<ConnectRequest>;
  /**
   * Hands the wallet to the app that made the request, after a fresh unlock. The returned line
   * of text can only be read by that app.
   */
  connectApprove(search: string): Promise<string>;
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
  canUpgradeToPasskey(): Promise<boolean>;
  upgradeToPasskey(): Promise<WalletInfo>;
}

export interface EnvelopeService {
  inspect(link: string): Promise<EnvelopeView>;
  open(link: string): Promise<OpenResult>;
  create(input: CreateEnvelopeInput): Promise<SentEnvelope>;
  listSent(): Promise<SentEnvelope[]>;
  takeBack(id: string): Promise<{ amount: bigint; confirmed: Promise<void> }>;
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
