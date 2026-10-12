# AGENTS.md: green-envelope

Green Envelope: money as a link in the group chat, opened in the browser with no install; the
first release. TypeScript, Preact, Vite; a Rust verifier; pnpm 12. Repository-wide rules (CI, git
workflow): `../AGENTS.md`.

- Read the wiki `architecture/green-envelope.md` and `docs/contracts.md`.
- `pnpm check` (lint, strict types, tests) and `pnpm verify:spends` must pass. No code that
  builds a transaction merges without a case in the Rust simulator verifier.
- **CI runs no tests**, so that rule is on you: run `pnpm verify:spends` locally and say so in the
  pull request. Nothing checks that the committed spend vectors match what the builders
  produce either; `pnpm test` regenerates them, so commit the result.
- Bytes are `Uint8Array`, amounts are `bigint`, no `any`. The claim route stays under 100 kB
  gzipped (`pnpm --filter web size`).
- It was imported with `git subtree add`, so its history is in this repository.
- Images: `deployment/Dockerfile`, built by `../.github/workflows/green-envelope.yml` on a
  `green-envelope-v*` release that matches `package.json`. The production host is `../deploy/`.
- Two tests reach into the sibling `../klimper/` (the handoff receiver must be byte for byte the
  same file there). They skip, or the e2e fails to import, when Klimper is not checked out next
  to this folder; keep it so after a split (`../SPLITTING.md`).
