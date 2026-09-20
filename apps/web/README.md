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
| `VITE_FEE_MOJOS` | `0` | fee added to each transaction |

## @names

`@anna` is resolved through XCHandles, which **exists on mainnet only** — there is no testnet
deployment. On a test chain the send screen says so rather than blaming the spelling, and an
address works as it always does. A resolved name shows the address it pays before anything is
sent, and is screened against the names this browser has paid before; see
`apps/edge/README.md` for `POST /api/handle-check`.

## Testing states

`src/test/fake-services.ts` takes flags in code: `empty`, `expired`, `already`, `bad`, `slow`,
`offline`, `cancel`, `nopasskey`, `nopick`, `nohandles`, `mainnet`, and the stand-in handles
`@gone`, `@lapsed`, `@empty`, `@moving` and `@c1apandpay`. None of it is reachable from the app.
