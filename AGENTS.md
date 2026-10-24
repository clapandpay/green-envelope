# AGENTS.md: green-envelope

Green Envelope: money as a link in the group chat, opened in the browser with no install; the
first release. TypeScript, Preact, Vite; a Rust verifier; pnpm 12. CI and git rules: below.

- Read `docs/contracts.md`.
- `pnpm check` (lint, strict types, tests) and `pnpm verify:spends` must pass. No code that
  builds a transaction merges without a case in the Rust simulator verifier.
- **CI runs no tests**, so that rule is on you: run `pnpm verify:spends` locally and say so in the
  pull request. Nothing checks that the committed spend vectors match what the builders
  produce either; `pnpm test` regenerates them, so commit the result.
- Bytes are `Uint8Array`, amounts are `bigint`, no `any`. The claim route stays under 100 kB
  gzipped (`pnpm --filter web size`).
- Its history from before the clapandpay monorepo (2026-09) and from inside it is all here.
- Images: `deployment/Dockerfile`, built by `.github/workflows/green-envelope.yml` on a
  `green-envelope-v*` release that matches `package.json`. The production host is the website
  repository's `deploy/`.
- The wallet is a passkey vault (`packages/vault`, `packages/passkey-signer`): no wallet key
  ever exists in the browser. Moving money to Klimper is a plain send to a Klimper address;
  nothing hands keys or words to another app.

## CI

**Never put a schedule on a workflow.** No `schedule:`, no `cron:`, not commented out and not
"just for now": a job on a clock is a failure nobody reads, and a bill in every private fork.

The pipeline is one workflow, `.github/workflows/green-envelope.yml`, and it runs no tests: on a
release tagged `green-envelope-v*` (it must match `package.json`), or a manual dispatch, it builds
the `green-envelope` image for `linux/amd64` and `linux/arm64` and pushes it to ghcr.io. Nothing runs on pull
requests or merges. Keep it to one `ubuntu-latest` runner, and give every job a
`timeout-minutes`: the default is six hours. Tests, lint and type checks are run locally before a
pull request, and the pull request says so.

## Git workflow

**Never touch `main` directly.** Not a commit, a push, a force push, a rebase, a tag or a history
rewrite: `main` changes only through a pull request that a person merges. If a command would
write to it, do not run it and say so instead.

**One branch per task**, from an up-to-date `main`:

```sh
git fetch origin && git switch -c task-042-short-slug origin/main
```

`TASK-nnn` and `decision-nnn` in branch names, code and docs refer to the maintainers' backlog,
which is not public. Keep a branch to its task's scope. Sign off every commit (`git commit -s`,
`CONTRIBUTING.md`).
