# apps/web

The claim page and the small wallet. Preact, no router library, no state library.

```sh
pnpm dev            # demo services, no chain, no money
VITE_SERVICES=real pnpm dev
pnpm --filter web build
pnpm --filter web size   # the claim route must stay under 100 kB gzipped
```

## Which services a build gets

**Real unless a demo is asked for.** `VITE_SERVICES=mock` picks the in-memory services;
anything else, including nothing at all, talks to a real chain. `pnpm dev` gets the demo from
`.env.development`, which Vite loads in dev only and never in a build.

It is this way round on purpose: the opposite default meant a release could quietly ship the
demo, with fake money and a fake balance, and nothing about the running app would say so.

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
| `VITE_SERVICES` | real | `mock` for the demo services; anything else is real |
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

## Demo flags

`?mock=a,b` with the demo services: `empty`, `expired`, `already`, `bad`, `slow`, `offline`,
`cancel`, `nopasskey`, `nopick`, `nohandles`, `mainnet`. The demo handles `@gone`, `@lapsed`,
`@empty`, `@moving` and `@c1apandpay` show the states the send screen can be in.
