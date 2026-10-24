# Contributing to Green Envelope

Thank you for helping. Issues and pull requests are welcome; for anything larger than a fix,
open an issue first so we can agree on the approach before you spend the time.

## Sign-off

Every commit carries a `Signed-off-by:` line (`git commit -s`). It certifies the
[Developer Certificate of Origin 1.1](https://developercertificate.org/): you wrote the change,
or otherwise have the right to submit it under this repository's licence. There is no CLA and
no copyright assignment: you keep the copyright of what you write.

## Licence

Contributions are accepted under AGPL-3.0-or-later with the App Store exception (`LICENSE`,
`LICENSE-APP-STORE-EXCEPTION.md`).

## Before you open a pull request

CI runs no tests. Run the checks yourself and say in the pull request that they pass:

```sh
pnpm check            # lint, strict types, tests
pnpm verify:spends    # every transaction builder against the Rust simulator
```

No code that builds a transaction is merged without a case in the simulator verifier.

Security issues are not reported here: see [`SECURITY.md`](SECURITY.md).
