# Wallet security: the passkey vault

Internal review of the wallet as rebuilt for `envelope.clapandpay.com` (2026-10-24). No external
audit has been done.

**Verdict: safe enough for pocket money, not for savings.** Green Envelope is for sending small
amounts for fun in a group chat. Treat what is in it like cash in a coat pocket. Anything larger
belongs in Klimper, which keeps money with its own 24 recovery words. The app says this on the
wallet screen, the receive sheet and after every claim, and "Move to Klimper" sends everything
there in one step.

## The model: keys never leave the passkey

The wallet is a **CHIP-0043 vault** (`packages/vault`): a singleton whose custody is the
passkey's own P-256 key, checked on-chain by `secp256r1_verify` (MIPS `PasskeyMember`). The money
lives at an address only that vault can release (MIPS `SingletonMember`). This is the model of
Chia's own passkey vaults.

- **No wallet key exists in the browser.** The passkey makes its key inside the authenticator
  and only ever signs a 32-byte challenge after a face, finger or PIN. Nothing is derived from it
  (no PRF), nothing secret is stored (the browser keeps a credential id, a public key and a
  launcher id), and nothing can be extracted.
- **One prompt per transaction.** The challenge commits to the vault's delegated puzzle: every
  coin it releases and exactly what each coin pays. A signature for one payment cannot be used
  for another, or replayed (the vault coin is spent with it).
- **Only Chia's puzzles.** singleton top layer, launcher, MIPS index wrapper, delegated puzzle
  feeder, passkey member, singleton member (chia-puzzles 0.20.3). No custom Chialisp.
- **Checked against Chia's code.** `tools/vectors vault` builds reference bundles with the SDK's
  drivers; the TypeScript builders reproduce them byte for byte, and `pnpm verify:spends` runs
  every bundle through the SDK simulator, including three the chain must reject (a money coin
  without the vault, a changed signature, a signature moved to another payment).
- **Opening needs no prompt.** Balances and addresses are public; claiming an envelope needs
  only the address, because the share's own key (in the link) signs the claim.
- **The first claim launches the vault** out of the share (1 mojo), in the same transaction: the
  money is visible at once and the vault exists from the next block.
- **Ready for more keys.** The money address depends only on the vault's launcher id, so a later
  custody service can change the vault's keys (for example 2 of 3) without moving any money.

## What is done well besides

- Strict CSP (`script-src 'self'`, `frame-ancestors 'none'`, `base-uri 'none'`,
  `form-action 'none'`), `referrer-policy: no-referrer`, WebAuthn allowed for this origin only,
  HSTS. One runtime dependency (Preact) besides the `@noble` crypto libraries; no third-party
  scripts.
- Never a browser-only wallet: without a usable passkey the app says so and offers a new one.
- The words handoff to Klimper is gone in both apps; moving to Klimper is a plain send to an
  address the person copies from Klimper and sees in full before the one prompt.

## Risks that remain

| # | Risk | Severity | Why it stays / what limits it |
| --- | --- | --- | --- |
| 1 | A hostile script on the page (XSS, a bad dependency, a compromised build or host) can build a bad transaction and *ask* the passkey to sign it. The prompt looks legitimate. | High, inherent | It cannot take the key, and every theft needs a fresh face or finger. Limited by the CSP and few dependencies; the GitHub org, the image registry, the server and DNS are part of the wallet's security. |
| 2 | The passkey belongs to **`clapandpay.com`**: any page on that domain or a subdomain can ask it to sign. | High, by design | Needed so the same passkey works across Clap and Pay. Keep the hub static, never host anything untrusted on a `*.clapandpay.com` subdomain, protect the DNS account. |
| 3 | The passkey is the only key. Lose the Apple, Google or password-manager account that syncs it and the money is gone; take it over and you take the money. | Medium | Pocket money only; "Move to Klimper" for anything more. A future second key on the vault removes this. |
| 4 | The chain checks the signature, not the WebAuthn flags: user verification is requested by the page but not proven on-chain. | Low | Same as Chia's passkey member; the authenticator enforces it. |
| 5 | Envelope secrets are random and kept in this browser: taking back an unopened envelope needs this browser's records. | Low | The link itself also holds the secret; whoever has it can open the envelope. |
| 6 | Wallets from before the vault (keys in the browser) still exist until they are moved. | Low, temporary | Shown as "Money from before"; one tap moves the money into the vault and the old key is forgotten. The legacy code goes one release later. |
| 7 | `style-src 'unsafe-inline'` | Low | CSS injection cannot run script; no secrets are in the DOM. |

## Rules that follow from this

- Small amounts only, for fun, in the app and wherever it is promoted.
- Before a large promotion, get an external review of `packages/vault`,
  `packages/passkey-signer`, the services that build spends, and the edge headers (`SECURITY.md`).
