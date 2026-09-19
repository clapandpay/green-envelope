# tools/vectors

The reference side of `@ge/chia`. The TypeScript package re-implements, without WebAssembly, the
part of Chia a claim needs: BLS keys, CLVM serialisation and tree hashes, the standard
transaction, coin ids, addresses. This crate is how we know its bytes are right. It is built on
[`chia-wallet-sdk`](https://github.com/xch-dev/chia-wallet-sdk) 0.33.0 (pinned; the same version
Klimper uses), which brings `chia-bls` (blst), `clvmr`, `chia-consensus` and the SDK simulator.

Two commands, two directions:

```
generate   Rust  -> TypeScript   golden vectors the TypeScript tests assert byte for byte
verify     TypeScript -> Rust    spend bundles built by TypeScript, run through the reference
```

## `generate [out.json]`

```sh
cargo run --release --manifest-path tools/vectors/Cargo.toml -- generate
```

Writes `packages/chia/src/vectors.json` (or the path given). Deterministic: running it again
produces the same file, so a diff after an SDK upgrade is a real change in reference behaviour.
Contents, all computed by the SDK and its dependencies, never by hand:

| Key | What |
| --- | --- |
| `constants` | genesis challenges and AGG_SIG_ME extra data of mainnet and testnet11, default hidden puzzle hash, the p2_delegated_puzzle_or_hidden_puzzle mod and its hash |
| `keys` | per seed (32, 64 and 75 bytes): master key, hardened children, unhardened children derived on the secret side and on the public side (the generator fails if they disagree), the wallet path m/12381/8444/2/i, synthetic keys, standard puzzle hash and serialized reveal, `xch` and `txch` addresses |
| `coins` | coin ids for amounts around every integer-encoding boundary: 0, 1, 127, 128, 255, 256, ..., 2^32, 2^63 - 1, 2^63, 2^64 - 1 |
| `signatures` | AugSchemeMPL signatures (empty, short, 32-byte and 1000-byte messages), an aggregate, the empty aggregate |
| `clvm` | serialization and tree hash of atoms at every length-prefix boundary (0, 1, 0x7f/0x80, 63/64, 8191/8192, 9000, 2^20 - 1, 2^20 bytes), pairs, lists, nested and deep trees. A tree is JSON: hex string = atom, two-element array = pair. Megabyte atoms are described (`atom_len`, `fill`) and their serialization given as length and SHA-256 |
| `int_atoms` | CLVM integer encodings of about 120 values, negative and positive, around every byte boundary up to 2^127 |
| `spend_bundles` | signed standard-transaction bundles, each for mainnet and for testnet11: inputs (seed, derivation path, coin, conditions), the messages the SDK signer extracted by running the puzzles, and the exact `push_tx` JSON |

The spend bundles are built with `StandardLayer` and `SpendContext`, signed through
`RequiredSignature::from_coin_spends` (which runs each puzzle to find the AGG_SIG_ME
conditions), and then validated before they are written: mempool validation with the network's
constants and, for testnet11, the simulator. A vector that the reference would not accept is
never emitted.

## `verify [cases.json | -]`

```sh
pnpm verify:spends                       # from the repository root; runs the default case file
cargo run --release --manifest-path tools/vectors/Cargo.toml -- verify cases.json
... | cargo run --release --manifest-path tools/vectors/Cargo.toml -- verify -
```

With no argument it reads `packages/chia/src/spend-cases.json`, which the TypeScript test
`spend-cases.test.ts` writes (so run `pnpm test` first on a fresh checkout). Input is one case or
an array of cases:

```json
{
  "name": "optional label",
  "network": "mainnet",
  "coins": [{ "parent_coin_info": "0x..", "puzzle_hash": "0x..", "amount": 1000 }],
  "spend_bundle": { "coin_spends": [ ... ], "aggregated_signature": "0x.." },
  "expect": "ok"
}
```

`coins` is the coin set that exists before the bundle; `spend_bundle` is the `push_tx` body shape;
`expect` is `"ok"` or a substring of the expected error (`BadAggregateSignature`, `MintingCoin`,
...). Hex may carry `0x` or not; amounts may be numbers or decimal strings. Output is one
`PASS`/`FAIL` line per case with the reference implementation's error, then a summary. The exit
code is 0 only if every case matched its expectation (1 otherwise, 2 for bad usage).

### What exactly is checked

1. **Mempool validation against the requested network.** `chia_consensus::spendbundle_validation::
   validate_clvm_and_signature`, the function a full node's mempool calls, in `MEMPOOL_MODE`, with
   a cost limit of half a block. It runs every puzzle in the CLVM interpreter, checks each puzzle
   hash, parses and validates conditions (minting, reserve fee, concurrent-spend assertions, ...)
   and verifies the aggregated signature. It receives the consensus constants of the network the
   case names, so AGG_SIG_ME is verified with **that network's** extra data.
2. **Coin set.** Every spent coin must be in `coins` or be created by another spend of the
   bundle; otherwise `UnknownUnspent`.
3. **The SDK `Simulator`, testnet11 cases only.** The simulator hardcodes `TESTNET11_CONSTANTS`
   and offers no way to configure them, so it would reject every correctly signed mainnet bundle
   with `BadAggregateSignature`. For testnet11 the coins are inserted and the bundle submitted
   with `Simulator::new_transaction`, which repeats CLVM and signature validation and adds the
   coin-set rules (unknown coin, double spend, time locks against the simulated clock). For
   mainnet, steps 1 and 2 are the whole check. Step 1 is the code path the simulator itself uses
   internally (the SDK carries a copy of that function), only with mainnet constants, so the one
   thing mainnet cases do not get is the simulator's time-lock evaluation.

## Housekeeping

```sh
cargo fmt --manifest-path tools/vectors/Cargo.toml --check
cargo clippy --manifest-path tools/vectors/Cargo.toml --release --all-targets -- -D warnings
```

`Cargo.lock` is committed: the vectors are only as stable as the dependency versions.
