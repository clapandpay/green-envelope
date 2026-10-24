# Wallet security: what the passkey wallet is good for

Internal review of `packages/wallet`, the parts of `apps/web` that hold keys, and the edge headers,
before hosting on `envelope.clapandpay.com` (2026-10-24). No external audit has been done.

**Verdict: safe enough for pocket money, not for savings.** The wallet is built for sending small
amounts for fun in a group chat. Treat what is in it like cash in a coat pocket: an amount you
would be annoyed, not hurt, to lose. Anything larger belongs in Klimper or another wallet with its
own recovery words. The app says this on the wallet screen and the receive sheet.

## What is done well

- **No secret at rest.** A passkey wallet stores only its credential id. The 24 words are derived
  each time from the passkey's PRF output (HKDF-SHA256, separate `info` per use), and the raw PRF
  bytes are wiped right after.
- **User verification is required** on every create and get, so the phone asks for face, finger
  or PIN each time a wallet is opened.
- **Never silently weaker.** Without PRF the app refuses and lets the person choose the device
  wallet themselves; it never falls back on its own.
- **Seeds brought in from elsewhere** are wrapped with AES-GCM under a non-extractable key derived
  from the passkey; a changed record fails to decrypt instead of opening as something else.
- **No lost money from races.** Records are only written if storage still holds what was read
  before the prompt, so a second tab cannot overwrite a device wallet.
- **Small attack surface in the page.** One runtime dependency (Preact) besides the
  `@noble` crypto libraries, no third-party scripts, and a strict CSP (`script-src 'self'`,
  `frame-ancestors 'none'`, `base-uri 'none'`, `form-action 'none'`), `referrer-policy:
  no-referrer`, WebAuthn allowed for this origin only, and now HSTS.
- **The Klimper handoff** always asks for a fresh prompt, encrypts the words to the requesting
  app's key, and only ever returns them through the fixed Klimper return link.

## Risks that remain

| # | Risk | Severity | Why it stays / what limits it |
| --- | --- | --- | --- |
| 1 | Script running on the page can read the key while the wallet is open (XSS, a bad dependency, a compromised build, image or hosting account) and spend everything. | High, inherent | True of every browser wallet. Limited by the CSP, few dependencies and no third-party code. The GitHub org, the ghcr.io image, the server and DNS are all part of the wallet's security. |
| 2 | The passkey belongs to **`clapandpay.com`**, not only to `envelope.`: any page on that domain or any subdomain can ask for the same passkey and, after one face prompt that looks legitimate, derive the wallet. | High, by design | Needed so Klimper gets the same key. Keep the hub static, never host anything untrusted on a `*.clapandpay.com` subdomain, protect the DNS account. Cannot be changed once people have wallets. |
| 3 | After the first unlock the signing key stays in memory until the tab closes; later sends do not ask for the face again. | Medium | Anyone holding the unlocked phone with the tab open can send. Possible follow-up: ask again for each send, or forget the key after a few idle minutes. |
| 4 | The passkey is the only backup until the money is in Klimper. Losing the Apple, Google or password-manager account loses the money; someone who takes over that account gets it. | Medium | The app shows "Back it up in Klimper" until it has been. |
| 5 | A forged `/connect` link plus a person who taps approve and then forwards the result link could hand the 24 words to someone else. | Medium-low | Needs the person to approve with their face and then send the link on; the screen says "Klimper can spend all of it", and the link only opens Klimper. |
| 6 | Device wallet (no passkey): anyone with the unlocked browser can spend; clearing site data loses it. | Low, legacy only | **The app no longer makes them**: when the passkey fails it offers a new passkey instead. Ones made earlier still open and are asked to "Secure now". |
| 7 | JavaScript cannot reliably wipe memory; the 24 words exist as a string during the handoff. | Low | Inherent to the browser. |
| 8 | `style-src 'unsafe-inline'` | Low | CSS injection cannot run script; no secrets are in the DOM. |
| 9 | No HSTS header. | Low | **Fixed**: the edge now sends `strict-transport-security: max-age=31536000`. |

## Rules that follow from this

- Tell people, in the app and anywhere it is promoted: **small amounts only, for fun.**
- Do not raise limits, add savings features or market it as a wallet to keep money in.
- Before a large promotion, get an external review of `packages/wallet`, `packages/handoff` and
  the edge headers (see `SECURITY.md`).
