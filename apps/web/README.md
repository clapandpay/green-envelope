# apps/web

The claim page and the small wallet. Preact, no router library, no state library.

```sh
pnpm dev            # the real app on testnet11
pnpm --filter web build
pnpm --filter web size   # the claim route must stay under 100 kB gzipped
```

## There is one app

Real services, a real passkey and a real chain, in development and in the release alike. No
build flag and no query parameter can put anything else in their place, so what is on screen is
always the app.

Development differs in one respect only: `.env.development` points it at testnet11, so a
mistake while building costs nothing. Add `?net=main` when you mean mainnet.

The in-memory services that used to back a demo now live in `src/test/fake-services.ts` and are
imported by tests alone. Screen tests use them; `src/services/open.test.ts` and
`src/services/real.test.ts` drive the real services over a fake chain instead.

## Which chain

Mainnet unless something says otherwise. In order of precedence:

1. `?net=testnet` in the address (also `test`, `testnet11`, `main`, `mainnet`)
2. `VITE_NETWORK` at build time
3. mainnet

`net` is sticky across in-app navigation, like `mock`, and **an envelope made on a test chain
carries `net=testnet` in its own link** — otherwise the link would open on mainnet and find
nothing there. Nothing in the interface offers the choice; a small badge in the footer is the
only sign that a test chain is in use.

## Environment

| Variable | Default | |
| --- | --- | --- |
| `VITE_NETWORK` | `mainnet` | `mainnet` or `testnet11`; `?net=` overrides it per link |
| `VITE_CHAIN_ENDPOINTS` | the public Coinset URL of the network | comma-separated, tried in order |
| `VITE_PUBLIC_ORIGIN` | the origin of the page | origin written into the links this app makes |
| `VITE_FEE_MOJOS` | `1000000` on mainnet, `0` on testnet11 | fee added to each transaction, in mojos |
| `VITE_HANDLES_API` | XCHandles on mainnet, none on testnet11 | handle registry base URL |

## The fee

Zero is fine on a quiet chain, and a test chain is always quiet. On mainnet a zero-fee
transaction is the first thing dropped when the mempool fills, and an envelope that will not
open for an hour is worse than one that costs a thousandth of a cent — so mainnet has a floor of
a millionth of an XCH and testnet does not.

That is a tenth of a percent of the smallest share this app will make, and the person opening a
share pays it out of that share. `VITE_FEE_MOJOS` overrides it either way; a value that is not a
whole number of mojos is ignored in favour of the default, because a typo in a deployment
variable should not take the app down.

## Passkeys and where they live

The wallet is a passkey. Nothing here asks for the built-in sensor specifically, so the passkey
can live wherever the person keeps theirs:

| Provider | Verified with |
| --- | --- |
| Apple Passwords / iCloud Keychain | Touch ID or Face ID, and it follows the person to their other Apple devices |
| 1Password | Touch ID on a Mac, Face ID on an iPhone, through the 1Password app or extension |
| A security key | Its own touch, plus a PIN |

Two requirements make that work, and both are pinned by tests:

- **`authenticatorAttachment` is never set.** Setting it to `platform` would shut out every
  provider above except the built-in one.
- **`residentKey: 'required'`**, so the passkey is discoverable and `signIn()` finds it again on
  a new phone without being told which one to ask for.

`isUserVerifyingPlatformAuthenticatorAvailable` is deliberately **not** consulted: it reports the
built-in sensor and nothing else, so a Mac without Touch ID would look like a machine with no
passkeys at all and quietly get the weaker device wallet.

What is required is the **PRF extension**, because that is where the wallet key comes from. A
provider that cannot do PRF is told so and offered a new passkey: the app never makes a wallet
that lives only in the browser. Device wallets made before that rule still open, and are asked
to secure themselves with a passkey (see below). Most providers evaluate PRF on `get` rather than
`create`, so making a wallet for the first time asks twice: once to make the passkey, once to
read from it.

### Three kinds of record

| Kind | Seed | Opens with |
| --- | --- | --- |
| `passkey` | derived from the passkey, never stored | the passkey, on any device it syncs to |
| `device` | wrapped by a key in this browser's IndexedDB | nothing; it is lost with the profile |
| `wrapped` | a seed from elsewhere, encrypted under a second key derived from the same passkey | the passkey, **on this device only** |

A `wrapped` record is what "secure this wallet" and "bring a wallet with me" both produce. The
seed does not change, so the address and the money do not change either — it is a new lock on
the same door. But the wrapped seed lives in this browser, so unlike a derived wallet it does
not reappear elsewhere when the passkey syncs.

## @names

`@anna` is resolved through a handle registry. XCHandles indexes **mainnet only**: its
`launcher_id` parameter chooses between registries on one network rather than between networks,
and its CLI's `--testnet11` flag switches consensus constants, not the API it talks to. So a
test chain has no registry, the send screen says that instead of blaming the spelling, and an
address works as it always does.

Nothing about that is hardcoded to mainnet any more. `VITE_HANDLES_API` names a registry for
whichever chain the app is on — one run privately, or the day XCHandles publishes a testnet
deployment — and `@names` start working there with no change to the code. A resolved name shows the address it pays before anything is
sent, and is screened against the names this browser has paid before; see
`apps/edge/README.md` for `POST /api/handle-check`.

## Testing states

`src/test/fake-services.ts` takes flags in code: `empty`, `expired`, `already`, `bad`, `slow`,
`offline`, `cancel`, `nopasskey`, `nopick`, `nohandles`, `mainnet`, and the stand-in handles
`@gone`, `@lapsed`, `@empty`, `@moving` and `@c1apandpay`. None of it is reachable from the app.
