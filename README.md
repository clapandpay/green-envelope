# Green Envelope

Money as a link in the group chat. Tap, open with your face or fingerprint, and it is yours:
no app to install, no account. The first product of [Clap and Pay](https://clapandpay.com);
this folder of the clapandpay monorepo is self-contained (own toolchain, lockfile and CI).

- What and why: `clap-and-pay-wiki/product/mvp.md`
- How it is built and why there is no custom puzzle: `clap-and-pay-wiki/architecture/green-envelope.md`
- Contracts between the packages: [docs/contracts.md](docs/contracts.md)

```
packages/chia       pure TypeScript Chia core (BLS, CLVM data, standard transaction)
packages/chain      Coinset-compatible RPC client
packages/envelope   link codec, split algorithm, create / open / take-back
packages/wallet     passkey and device keys, balance, send
apps/web            claim page and small wallet (Preact)
apps/edge           link previews, EUR price, RPC proxy
tools/vectors       Rust: golden vectors and the spend verifier (chia-wallet-sdk simulator)
```

```sh
pnpm install
pnpm dev            # web app on testnet11 with mock or real services (see apps/web/README.md)
pnpm check          # lint, types, tests
pnpm verify:spends  # runs TypeScript-built spend bundles through the Rust simulator
```

Rules: TypeScript strict and no `any`; bytes are `Uint8Array`, amounts are `bigint`; no code that
builds a spend merges without a simulator check; the claim route stays under 100 kB gzipped.

Licence: AGPL-3.0-or-later. Commercial licences: `../COMMERCIAL-LICENSE.md`.
