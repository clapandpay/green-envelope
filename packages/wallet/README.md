# @ge/wallet

The wallet in the browser. This package holds the **keystore**: it creates, unlocks and forgets
the one wallet of a browser profile and hands out its seed, plus the account derivation and coin
selection on top.

```ts
const store = createKeyStore({ rpName: 'Clap and Pay', rpId: 'clapandpay.com' });
const existing = await store.status(); // never prompts
const wallet = existing ? await store.unlock() : await store.create({ label: 'Clap and Pay wallet 2026-10-09' });
const account = accountFromSeed(wallet.seed, network);
wipeUnlocked(wallet); // the seed and the words
```

## A wallet is 24 words (version 2)

Every new wallet is a standard 24-word Chia wallet (clapandpay TASK-127):

1. 32 bytes of entropy: from the passkey, `HKDF-SHA256(PRF output, info = "clapandpay:mnemonic:v2")`
   with the PRF input `sha256("clapandpay:wallet:v1")`; for a device wallet, random.
2. The words: BIP-39 of the entropy (`mnemonicFromEntropy`).
3. The seed: the 64-byte BIP-39 seed of the words with the empty passphrase (`seedFromEntropy`).
   `accountFromSeed` and `masterSecretKey` take it; `keyGen` is chia-bls `from_seed`, so the keys
   are exactly what Sage derives when it imports the words.

`src/mnemonic-vectors.json` is written by `tools/vectors` (`cargo run -- mnemonic`) with the
`hkdf` crate, the `bip39` crate Klimper uses, and chia-bls; `mnemonic.test.ts` checks the words,
seed, master key and first address against it. The HKDF info and the PRF input are permanent:
changing either changes every passkey wallet.

**Version 1** wallets (before 24 words) had their 32-byte seed straight from the PRF into
`keyGen`, so they have no words and another address. A passkey wallet now always opens as
version 2 (a version 1 record is rewritten on unlock; nothing is lost, the passkey derives both),
and hands over the version 1 seed of the same prompt as `earlierSeed`. The app keeps only that
address, shows its balance, and moves it with `buildSweep` after a fresh prompt (TASK-128).
Version 1 device and wrapped records are still opened as version 1. On disk a version 2 record's
kind is `'passkey:v2'` (etc.), so code from before versions refuses it.

## Two kinds of wallet

| | passkey | device |
| --- | --- | --- |
| Entropy | derived from the passkey's PRF, as above | 32 bytes from `crypto.getRandomValues` |
| Stored in IndexedDB | the credential id only (not secret) | AES-GCM ciphertext, IV, and the **non-extractable** `CryptoKey` that wraps it |
| Unlock | biometric / PIN prompt, every time | silent |
| When | browser has WebAuthn and PRF | only when the person chose it (`create({ prefer: 'device' })`) |

`create()` never makes a device wallet on its own (audit M2): without WebAuthn or PRF, or when
WebAuthn fails with anything other than a dismissed prompt (`WalletError('cancelled')`), it
rejects with `WalletError('unsupported')`, and the app says so and offers the device wallet.

`create()` refuses (`WalletError('exists')`) while a wallet exists: overwriting the record of a
device wallet would destroy the only copy of its seed. `create({ replace: true })` makes a second
passkey wallet in place of a derived one, which stays in the passkey list and comes back with
`signIn()`; the record is overwritten only once the new passkey exists.

## Security note: what this does and does not protect

**Passkey wallet**

- Protects against: someone who gets a copy of the browser profile or the IndexedDB files (there
  is no secret in them); someone holding the unlocked phone but unable to pass the biometric or
  PIN prompt; loss of the device, as far as the passkey is synced.
- Does not protect against: script running on our origin (XSS, a malicious dependency, a hostile
  browser extension). While the page is open and unlocked the seed is in JavaScript memory and
  can be read and used to spend everything. A prompt can also be triggered by such a script and
  will look legitimate, because it is for the right site.
- The passkey is synced by the platform (iCloud Keychain, Google Password Manager, a password
  manager). **The wallet follows that account**: whoever can sign in to it and restore its
  passkeys can open the wallet, and if the account or the passkey is deleted, the money is gone.
  There is no other backup.
- The WebAuthn challenge is random and verified by nobody. WebAuthn is used here as a key
  derivation device, not as a login.

**Device wallet**

- Protects against: reading the seed out of storage as plain bytes. The wrapping key is
  non-extractable, so script and casual inspection of IndexedDB see ciphertext only.
- Does not protect against: **anyone who can use the unlocked browser profile**. There is no
  prompt; opening the page is enough to spend. The same holds for malware or a forensic tool with
  access to the profile on disk: the wrapping key is stored next to the ciphertext, and
  non-extractable is a rule the browser enforces on script, not encryption at rest.
- Does not protect against XSS on the origin, exactly as above.
- Not backed up anywhere. Clearing site data, an in-app browser that throws its storage away,
  private mode, or `forget()` lose the money for good. Browsers may also evict storage of
  rarely used sites. This is why the app offers to move the balance to a passkey wallet, and why
  a device wallet should only ever hold small amounts.

**Both**

- Everything rests on the integrity of the JavaScript the origin serves. A strict
  Content-Security-Policy, no third-party scripts, and few dependencies are part of the wallet's
  security, not decoration.
- The seed is returned to the caller as a `Uint8Array`. The keystore wipes the intermediate PRF
  buffer, but it cannot wipe what the caller keeps, and JavaScript gives no guarantee about
  copies made by the engine.

## Testing

All browser globals go through an injectable `env` (`KeyStoreEnv`) and storage through
`KeyStoreStorage`, so the tests run in node with `fake-indexeddb` and a fake authenticator
(`src/test-helpers.ts`). What they cannot show is real authenticator behaviour; that needs a
manual pass on iOS Safari, Android Chrome, desktop Chrome / Safari / Firefox, and the in-app
browsers of WhatsApp, Telegram and Instagram.
