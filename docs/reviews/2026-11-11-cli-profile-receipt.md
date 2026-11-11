# R03: installed CLI profile and concise preflight receipt

Date: 2026-11-11. Base: `7d9e4d9c2aee47527f5cb7330dba5884c7437a2f`.
Status: source candidate; implementation, tests, documentation, independent review
and a separate PR authorized. Merge and release are not authorized.
[ROADMAP](../../ROADMAP.md#r03--installed-cli-profile-and-preflight-receipt) owns
priority/status. Exact reviewed commits, review disposition and CI belong to the PR.
Published 1.3.1 and existing installed runtimes do not include this candidate.

## Contract

R02's versioned agent projection is exposed through the installed CLI with an
explicit `--profile agent`. Legacy argument forms and full JSON remain the default.
The opt-in preflight receipt contains the selector, canonical selection, revision,
binding identity, coverage/verdict and diagnostic references. It does not repeat
the full source context. Projection omissions describe transfer scope and never
turn partial analysis into a complete index.

The complete fresh-context gate, exact revision and current binding checks remain
authoritative. Invalid selectors, stale revision/binding and partial contexts must
fail. Receipt generation grants no edit authority and does not lock files. All
omitted evidence remains available through R02's revision-bound section/continuation
protocol; the installed binding is part of its snapshot and byte budget.

Newly generated usage and managed instructions request the profile explicitly.
Existing owned blocks stay byte-identical on repeated attachment; exact historical
portable text remains recognizable, while edited or duplicated blocks remain
conflicts. Changes to real installations require the existing explicit lifecycle
flow; this source PR does not update them. Generated instruction content does not
establish that a host loaded or followed the instructions.

## CLI and wire format

- `context [selector] --profile agent [--max-bytes N] [--section KIND] [--cursor TOKEN]`.
  Section/cursor requests require one selector and all of `--revision`,
  `--binding-id`, `--generation`. Plain profile context may omit the selector.
- `preflight selector --profile agent [--max-bytes N] --revision REV
  --binding-id UUID --generation N`. Section/cursor options are rejected here.
- New options require `--profile agent`. Duplicate/unknown options reject. Profile
  version is schema 1; a separate profile-version flag is not introduced.
- Profile output is compact JSON with no trailing newline. The default budget is
  10,000 UTF-8 bytes, with the R02 safe-integer minimum of 256. Budget errors are
  explicit JSON with nonzero exit status. Legacy output formatting is unchanged.
- The receipt has `schemaVersion`, `profile`, `receipt: "preflight"`, `selector`,
  `project`, `snapshot`, `revision`, `binding`, `selection`, `status`,
  `preflight: "verified-at-read"`, `coverage`, `uncertainty` and `diagnostics`.
  Diagnostic references are `{ section, total, cursor }` for `diagnostics`,
  `symbolDiagnostics` and `globalSymbolDiagnostics`. No full context/page arrays
  are re-emitted. References use the same selector, revision and binding.

The opt-in path first reads the full fresh context and applies the existing gates,
then reads a projection pinned to that revision. A caller-validated binding is
attached before projection so it enters both snapshot identity and byte accounting.
The installed CLI owns binding validation; the source projection is not an
independent binding authenticator. Both projection and receipt must fit the budget.
This adds two index scans to the opt-in path; it does not promise reduced indexing
CPU, latency or memory. Existing no-profile commands retain their old path.

## Validation

Validated locally on macOS / Node.js 22.23.4:

- `npm test`: 339/339 passed; no failures, skips or cancellations.
- Three new installed-CLI regression groups cover all 11 explicit sections,
  Unicode/fragment reconstruction, binding inside the byte budget, diagnostic cursor
  retrieval, same-revision cross-selector cursors, stale source/binding, refreshed
  context, malformed options, invalid selectors and unchanged partial rejection.
  They also cover exact legacy generated README/managed-block adoption, repeated
  attachment without rewriting, and preservation of edited-block conflicts.
- A receipt can fit a small budget while its mandatory R02 projection cannot. The
  regression requires an explicit budget error in that case, not a false success.
- `npm run package`: 47 payload files; every payload hash matches this source
  candidate. Archive inspection excludes private workspaces, evidence and legacy
  archives. Artifact schema, dependency pins and source version are unchanged.
- All 12 `scripts/smoke-release.mjs` groups passed against that actual bundle.
  The added group exercises installed profile/receipt and pinned section/cursor
  retrieval. Existing scenarios also verify source drift, profile context refresh,
  strict partial rejection, portable adoption, loopback APIs and cleanup.
- Candidate artifact digest:
  `c9dee73a544d2ae164c2bc0e6e45766b90c0cfe9cd05493d14e16c6d54be9e2f`.
  Candidate archive SHA256:
  `78ac502fd6635372e9ee93d102d7c06baa9c8718f9be7ff93716c8f915c2cdd2`.
  These identify local validation bytes, not published release pins.
- Syntax checks and `git diff --check` passed. Fresh development context retains
  the existing oversized-wordmark partial warning; no gate is bypassed.

Exact independent review and Linux/Node 22/24 CI disposition belong to the PR.
Local checks do not establish either. No browser appearance or real-target host
instruction activation was tested; the actual-bundle check uses a disposable target.

## Delivery boundary and rollback

Revert R03 before R02 and use the unchanged legacy context/preflight commands.
No stored project data, binding schema, runtime pin or user map is migrated.
Preserve edited user instructions and recovery data. No parser, resolver, UI,
dependency, artifact schema or source version change is part of this repair.

Merge, release and real-target upgrades remain separate owner actions. Test fixtures
are disposable and use loopback only. Browser appearance and real-host instruction
activation are outside this CLI change's validation claims. Read-only review is a
procedural restriction, not proof of an independently enforced read-only sandbox.
