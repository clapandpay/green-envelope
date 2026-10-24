# Contracts between packages

These signatures are fixed. Packages are built in parallel against them; change one only by
changing this file in the same commit and telling whoever depends on it.

Conventions everywhere: `Uint8Array` for bytes (never hex strings inside the code, hex only at
the JSON edge), `bigint` for mojo amounts, no default exports, no classes where a function does,
no `any`, errors are typed (`class XError extends Error { code: ... }`), every public function
has a one-line doc comment. All network and clock access is injectable for tests.

## `@ge/chia` (pure TypeScript, depends only on @noble/curves and @noble/hashes)

```ts
export type Bytes = Uint8Array;
export type SecretKey = Bytes; // 32 bytes, big-endian scalar
export type PublicKey = Bytes; // 48 bytes, compressed G1
export type Signature = Bytes; // 96 bytes, compressed G2

// bytes
export function toHex(b: Bytes): string; // lowercase, no 0x
export function fromHex(hex: string): Bytes; // accepts optional 0x, throws on bad input
export function concatBytes(...parts: Bytes[]): Bytes;
export function equalBytes(a: Bytes, b: Bytes): boolean;
export function sha256(...parts: Bytes[]): Bytes;
export function toBase64Url(b: Bytes): string;
export function fromBase64Url(s: string): Bytes;

// clvm (data only: no interpreter)
export type Clvm = Bytes | readonly [Clvm, Clvm]; // atom | pair
export const NIL: Bytes; // empty atom
export function intAtom(n: bigint | number): Bytes; // minimal signed big-endian, 0 -> NIL
export function list(...items: Clvm[]): Clvm; // proper list
export function serialize(v: Clvm): Bytes;
export function treeHash(v: Clvm): Bytes;
export function curryTreeHash(modHash: Bytes, ...argHashes: Bytes[]): Bytes;

// keys (BLS12-381, Chia's AugSchemeMPL: G1 public keys, G2 signatures)
export function keyGen(seed: Bytes): SecretKey; // EIP-2333 master key, seed >= 32 bytes
export function publicKey(sk: SecretKey): PublicKey;
export function deriveHardened(sk: SecretKey, index: number): SecretKey;
export function deriveUnhardened(sk: SecretKey, index: number): SecretKey;
export function deriveUnhardenedPublic(pk: PublicKey, index: number): PublicKey;
export function sign(sk: SecretKey, message: Bytes): Signature;
export function verify(pk: PublicKey, message: Bytes, sig: Signature): boolean;
export function aggregate(sigs: Signature[]): Signature; // [] -> the G2 infinity signature

// standard transaction (p2_delegated_puzzle_or_hidden_puzzle, default hidden puzzle)
export function syntheticSecretKey(sk: SecretKey): SecretKey;
export function syntheticPublicKey(pk: PublicKey): PublicKey;
export function standardPuzzleHash(syntheticPk: PublicKey): Bytes; // no CLVM run, curry hash only
export function standardPuzzleReveal(syntheticPk: PublicKey): Bytes; // serialized curried puzzle

// addresses
export function encodeAddress(puzzleHash: Bytes, prefix: string): string; // bech32m
export function decodeAddress(address: string): { puzzleHash: Bytes; prefix: string };

// coins and spends
export interface Coin { parentCoinInfo: Bytes; puzzleHash: Bytes; amount: bigint }
export function coinId(coin: Coin): Bytes;

export type Condition =
  | { kind: 'createCoin'; puzzleHash: Bytes; amount: bigint; memos?: Bytes[] }
  | { kind: 'reserveFee'; amount: bigint }
  | { kind: 'assertConcurrentSpend'; coinId: Bytes }
  | { kind: 'assertCoinAnnouncement'; announcementId: Bytes }
  | { kind: 'sendMessage'; mode: number; message: Bytes; receiverCoinId: Bytes }
  | { kind: 'assertBeforeSecondsAbsolute'; seconds: bigint };

export interface CoinSpend { coin: Coin; puzzleReveal: Bytes; solution: Bytes }
export interface SpendBundle { coinSpends: CoinSpend[]; aggregatedSignature: Signature }

export interface Network {
  name: 'mainnet' | 'testnet11';
  addressPrefix: 'xch' | 'txch';
  aggSigMeExtraData: Bytes; // genesis challenge
}
export const MAINNET: Network;
export const TESTNET11: Network;

/** One standard-transaction spend, unsigned. `syntheticPk` must own `coin.puzzleHash` (throws otherwise). */
export function spendStandardCoin(coin: Coin, syntheticPk: PublicKey, conditions: Condition[]): CoinSpend;
/** Signs each spend's AGG_SIG_ME with its synthetic secret key and aggregates. */
export function signSpends(
  spends: { coinSpend: CoinSpend; syntheticSk: SecretKey }[],
  network: Network,
): SpendBundle;

/** The JSON body shape of Chia's `push_tx` (snake_case, 0x-prefixed hex, amounts as numbers). */
export function spendBundleToJson(bundle: SpendBundle): unknown;
```

## `@ge/chain`

```ts
export interface CoinRecord {
  coin: Coin;
  confirmedHeight: number;
  spentHeight: number | null; // null = unspent
  timestamp: number; // unix seconds of confirmation
}
export type ChainErrorCode =
  | 'network' // endpoint unreachable or timed out on every endpoint
  | 'double_spend' // the coin is already spent or a conflicting spend is in the mempool
  | 'unknown_coin' // coin not found (not confirmed yet, or never existed)
  | 'rejected' // any other definitive rejection; `detail` has the node's error
  | 'bad_response';
export class ChainError extends Error { code: ChainErrorCode; detail?: string }

export interface ChainClient {
  coinRecordsByPuzzleHashes(puzzleHashes: Bytes[], opts?: { includeSpent?: boolean }): Promise<CoinRecord[]>;
  coinRecordByName(coinId: Bytes): Promise<CoinRecord | null>;
  coinRecordsByHint(hint: Bytes, opts?: { includeSpent?: boolean }): Promise<CoinRecord[]>;
  coinRecordsByParentIds(parentIds: Bytes[], opts?: { includeSpent?: boolean }): Promise<CoinRecord[]>;
  pushTx(bundle: SpendBundle): Promise<{ status: 'success' | 'pending' }>;
  peakHeight(): Promise<number>;
}
export function createChainClient(opts: {
  endpoints: string[]; // tried in order; Coinset-compatible base URLs
  fetch?: typeof fetch;
  timeoutMs?: number; // default 8000
}): ChainClient;
```

Coinset-compatible means Chia full-node RPC over HTTPS POST with JSON bodies:
`POST {base}/get_coin_records_by_puzzle_hashes {"puzzle_hashes":["0x.."],"include_spent_coins":true}`,
`POST {base}/push_tx {"spend_bundle":{...}}`, `POST {base}/get_blockchain_state {}`,
`POST {base}/get_coin_record_by_name {"name":"0x.."}`. Public bases: `https://api.coinset.org`
(mainnet), `https://testnet11.api.coinset.org` (testnet11).

## `@ge/vault` and `@ge/passkey-signer`

The wallet is a CHIP-0043 vault whose custody is a passkey (`docs/wallet-security.md`). No
private key of the wallet exists in JavaScript.

```ts
// @ge/passkey-signer
export function createPasskey(env, rp, label): Promise<{ credentialId: Bytes; publicKey: Bytes }>; // ES256 only
export function signChallenge(env, rp, challenge: Bytes, credentialId: Bytes | null): Promise<{ credentialId; assertion: Assertion }>;
export function findPasskey(env, rp): Promise<{ credentialId: Bytes; candidates: Bytes[] }>; // public key recovered from a signature
export function narrowKey(env, rp, credentialId, candidates): Promise<Bytes>;

// @ge/vault
export interface Assertion { authenticatorData: Bytes; clientDataJSON: Bytes; signature: Bytes /* r||s */ }
export interface VaultCoin { coin: Coin; launcherId: Bytes; publicKey: Bytes; lineage: LineageProof }
export function custodyHash(publicKey: Bytes): Bytes;      // also the setup address
export function moneyPuzzleHash(launcherId: Bytes): Bytes; // the wallet's address
export function launchVault(parentCoinId: Bytes, publicKey: Bytes): Launch; // conditions + launcher spend
export function buildVaultSpend(args: { vault: VaultCoin; money: Coin[]; outputs: Output[]; fee: bigint }): Unsigned<VaultCoin>;
export function buildSetupSpend(args: { publicKey: Bytes; coin: Coin; conditions: Condition[]; alsoSpend?: CoinSpend[] }): Unsigned;
// Unsigned = { challenge: Bytes; finish(assertion): SpendBundle; next }
```

## `@ge/wallet`

```ts
export interface VaultRecord { credentialId: Bytes; publicKey: Bytes; launcherId: Bytes | null }
export interface VaultKeyStore {
  status(): Promise<VaultRecord | null>;      // never prompts
  create(label: string): Promise<VaultRecord>; // one prompt
  find(): Promise<{ credentialId: Bytes; candidates: Bytes[] }>; // one prompt
  narrow(credentialId: Bytes, candidates: Bytes[]): Promise<Bytes>;
  remember(record: VaultRecord): Promise<void>;
  sign(challenge: Bytes): Promise<Assertion>; // one prompt
  setLauncher(launcherId: Bytes | null): Promise<void>;
  forget(): Promise<void>;
}
export function createVaultKeyStore(opts?: { rpId?: string; rpName?: string; storage?; env? }): VaultKeyStore;
export function currentVault(chain, publicKey, launcherId): Promise<VaultCoin | null>;
export function walletCoins(chain, publicKey, launcherId): Promise<{ money: Coin[]; setup: Coin[] }>;
```

`createKeyStore` (the old keystore, keys in the browser) remains only to move old wallets.

## `@ge/envelope` (the parts that need no chain)

```ts
export type SplitMode = 'random' | 'equal';
/** Amounts sum exactly to `total`; every share >= `floor`; random = each share uniform in [floor, 2 x mean of the remainder]. */
export function splitAmounts(total: bigint, shares: number, mode: SplitMode, opts?: { floor?: bigint; random?: () => number }): bigint[];

export interface EnvelopeLink { publicKey: PublicKey; secret: Bytes; shares?: number; from?: string; message?: string }
export function encodeLink(origin: string, link: EnvelopeLink): string; // {origin}/g/{pk b64url}?n=&from=&m=#{secret b64url}
export function decodeLink(url: string): EnvelopeLink; // throws EnvelopeError('bad_link')
export const MAX_SHARES = 100;
export const SECRET_BYTES = 16;
export function envelopeSeed(secret: Bytes): Bytes; // sha256("clapandpay:envelope:v1" || secret)
```

`n` is the share count: a hint that lets the opener and the preview server derive 5 addresses
instead of 100 (about 4 ms each). The chain stays the truth; a missing or damaged `n` means scan.

On top of `@ge/chia` and `@ge/chain` the package also exports `envelopeKeys`, `shareKey`,
`sharePuzzleHash(es)`, the pure builders `buildCreate`, `buildOpen`, `buildTakeBack`, `buildSend`
(every bundle they produce is a case in `packages/envelope/spend-cases.json` for the Rust
verifier), and the operations `inspectEnvelope`, `openEnvelope` (retries another share when a
race is lost), `waitForOutput` (a claim counts only once its output coin exists, because a node
may answer "pending" to a claim that later loses) and `takeBackEnvelope`.

`@ge/wallet` adds `selectCoins`. Envelope secrets are random (16 bytes); the sender's browser
keeps the link. A claim's destination may launch the claimer's vault (`To`, `Destination`).

## `apps/web` services seam

The screens never import chain or crypto code. They talk to `AppServices`
(`apps/web/src/services/types.ts`), which has a mock implementation for UI work and tests and a
real one wired to the packages.

## `apps/edge`

`export default { fetch(request: Request, env: Env): Promise<Response> }` and nothing
runtime-specific. Routes: `GET /g/:pk` (app shell with Open Graph tags and live share state),
`GET /api/price` (`{ eur: number, at: number }`, cached 60 s), `POST /api/rpc/:method`
(allow-listed proxy to the chain endpoints, including hint and parent lookups), everything else falls through to static assets.
