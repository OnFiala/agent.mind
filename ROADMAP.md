# agent.mind roadmap

Status: sequence approved in [PR #1](https://github.com/OnFiala/agent.mind/pull/1), 2026-11-01. Published baseline: **[1.4.0](https://github.com/OnFiala/agent.mind/releases/tag/v1.4.0)**, 2026-11-16; release preparation [PR #34](https://github.com/OnFiala/agent.mind/pull/34) merged as `cb217aa`.
[GitHub Releases](https://github.com/OnFiala/agent.mind/releases) owns the published
versions and downloads; source version numbers alone do not establish publication.
This file owns implementation priorities; the [baseline review](docs/reviews/2026-11-01-architecture-and-code-quality.md)
owns dated findings and their evidence. No new language or platform support is
claimed by this plan or the L1/L2/L3 changes; L2 adds inventory and text reads only,
and L3 only separates the existing analysis from indexing.

## Current delivery status — 2026-11-16

The release-preparation base is `main` at
[`03ddb5b`](https://github.com/OnFiala/agent.mind/commit/03ddb5b726b8ee6d5fc71471ab883a1210f5e84a).
The following bounded changes are **released in 1.4.0**. They were merged before
release preparation PR #34. The first-parent merge
commits below establish integration; their PRs and linked records own exact review
and check evidence. A merge is not publication or a real-target upgrade.

| Work | PR | Merge commit |
|---|---|---|
| R01 — locale-stable digest | [#20](https://github.com/OnFiala/agent.mind/pull/20) | [`e20f43e`](https://github.com/OnFiala/agent.mind/commit/e20f43ef7b9d182ae0937fa2b587d9b8584c0bc7) |
| R02 — bounded context | [#21](https://github.com/OnFiala/agent.mind/pull/21) | [`7d9e4d9`](https://github.com/OnFiala/agent.mind/commit/7d9e4d9c2aee47527f5cb7330dba5884c7437a2f) |
| R03 — CLI profile and receipt | [#22](https://github.com/OnFiala/agent.mind/pull/22) | [`9e6c881`](https://github.com/OnFiala/agent.mind/commit/9e6c881989de885432f921c68f5d789f33e6ee8e) |
| R04 — unsupported-reference diagnostics | [#23](https://github.com/OnFiala/agent.mind/pull/23) | [`dfdec93`](https://github.com/OnFiala/agent.mind/commit/dfdec93244d2fb83380cbdf813c5c4401f4336a2) |
| R05 — input-policy contract, documentation only | [#28](https://github.com/OnFiala/agent.mind/pull/28) | [`73e892d`](https://github.com/OnFiala/agent.mind/commit/73e892d0d8f36bcb19b1b789931de9e4d2edc291) |
| R06 — project exclusions | [#29](https://github.com/OnFiala/agent.mind/pull/29) | [`b9eb09a`](https://github.com/OnFiala/agent.mind/commit/b9eb09adbcfdfcb2e7fbc92e79b98076ba1a3677) |
| R07 — source priority | [#30](https://github.com/OnFiala/agent.mind/pull/30) | [`e6f1de2`](https://github.com/OnFiala/agent.mind/commit/e6f1de23c5198a1e0c71b3c4f521516e6ee489e4) |
| R08 — keyboard acceptance follow-up | [#31](https://github.com/OnFiala/agent.mind/pull/31) | [`fe0c79e`](https://github.com/OnFiala/agent.mind/commit/fe0c79e4338e73fdef78cafc03305a2d0d164c4f) |
| R09 — generic presentation | [#32](https://github.com/OnFiala/agent.mind/pull/32) | [`9fa1263`](https://github.com/OnFiala/agent.mind/commit/9fa1263f5ff1b4267a1434f660a8794270c3b2cd) |
| R10 — accessor identities | [#33](https://github.com/OnFiala/agent.mind/pull/33) | [`03ddb5b`](https://github.com/OnFiala/agent.mind/commit/03ddb5b726b8ee6d5fc71471ab883a1210f5e84a) |
| CORE-01 — captured HTTP-handler writes | [#24](https://github.com/OnFiala/agent.mind/pull/24) | [`81fed38`](https://github.com/OnFiala/agent.mind/commit/81fed3850d2399c8f956da6cf53a37ae4614241c) |
| CORE-02 — exact inventory file boundary | [#25](https://github.com/OnFiala/agent.mind/pull/25) | [`f279c84`](https://github.com/OnFiala/agent.mind/commit/f279c840691ef7fb3bac57a22d47ed109d2fa978) |
| UI-NEW-01 — selection projection | [#26](https://github.com/OnFiala/agent.mind/pull/26) | [`e7a1ce4`](https://github.com/OnFiala/agent.mind/commit/e7a1ce486e240a996e119763ca68973ce636e81d) |
| UI-NEW-02 — keyboard movement used by R08 | [#27](https://github.com/OnFiala/agent.mind/pull/27) | [`e312ff1`](https://github.com/OnFiala/agent.mind/commit/e312ff13bdf64cbd16697fc7a6e85bc231a3166a) |

**1.4.0 was published on 2026-11-16 at 18:08:53 UTC**, after the owner authorized
publication of the exact verified archive. Tag `v1.4.0` points to preparation
merge `cb217aa684efda13274c773f1e962e291106ba0c`. Its
[actual merge CI](https://github.com/OnFiala/agent.mind/actions/runs/43922436506)
passed on Node 22/24. The [release record](docs/releases/1.4.0.md) owns the exact
artifact identities, public-download verification, checks, limits and rollback.
Real-target upgrades remain separate owner actions; existing installations were
not changed. Current documentation updates do not replace the frozen archive.

R11 has a scoped-preflight design proposal; owner acceptance pending; R12 remains pending and
R13–R16 remain conditional proposals. Neither this reconciliation nor a successful
candidate check authorizes those stages. The
[remaining-work contracts](#remaining-work-from-the-2026-11-11-repair-plan) and
[audit-theme ledger](#audit-theme-ledger-and-decision-triggers) retain their scope.
The original audit's 26 themes have differing priorities and are not all release
blockers; bounded repairs do not establish that the whole audit is closed.

## UI-NEW-02 — Keyboard movement without a Back conflict

**Released in 1.4.0.** The current delivery ledger records
[PR #27](https://github.com/OnFiala/agent.mind/pull/27); its review and CI evidence
remain separate from release and real-target upgrade authority.

Scope: Shift plus any arrow moves a focused card by 20 canvas units; plain arrows
retain spatial focus navigation, while Alt plus left arrow retains Back. The
[keyboard movement record](docs/reviews/2026-11-15-keyboard-movement.md) owns the
contract, validation and rollback. This implements the original R08 keyboard
contract; [R08 below](#r08--keyboard-contract) records its acceptance follow-up.
No new graph or platform support is claimed; the published baseline is 1.4.0.

## UI-NEW-01 — Symbol selection across views

**Released in 1.4.0.** The current delivery ledger records
[PR #26](https://github.com/OnFiala/agent.mind/pull/26); its review and CI evidence
remain separate from release and real-target upgrade authority.

Scope: retain the precise symbol selection and project it onto the visible owning
file or overview block when the symbol or its containing area is not visible.
The [selection projection record](docs/reviews/2026-11-15-selection-projection.md)
owns the contract, validation and rollback. UI-NEW-02 and separate R04 work remain
outside this repair; the published baseline is 1.4.0.

## CORE-02 — Exact inventory file boundary

**Released in 1.4.0.** The current delivery ledger records
[PR #25](https://github.com/OnFiala/agent.mind/pull/25); its review and CI evidence
remain separate from release and real-target upgrade authority.

Scope: enforce the file-count limit when admitting an otherwise eligible regular
file. Preserve excluded-path classification, traversal within the separate entry
and depth budgets, and partial status for actual file overflow. The
[CORE-02 record](docs/reviews/2026-11-15-inventory-file-limit.md) owns the contract,
validation and rollback. This repair includes no other audit findings or R04 work;
the published baseline is 1.4.0.

## CORE-01 — Captured HTTP handler writes

**Released in 1.4.0.** The current delivery ledger records
[PR #24](https://github.com/OnFiala/agent.mind/pull/24). This repair excludes the
other November 15 audit findings and the separate R04 work.

Scope: suppress unsupported HTTP/SSE provider evidence when a nested function
directly writes the handler's captured request, response or URL binding, while
preserving lexical shadowing and excluding nested routes/response evidence.
The [CORE-01 record](docs/reviews/2026-11-15-http-closure-writes.md) owns the contract,
validation and rollback. Published baseline is 1.4.0; no target is upgraded.

## R01 — Locale-stable artifact digest

**Released in 1.4.0.** The current delivery ledger records
[PR #20](https://github.com/OnFiala/agent.mind/pull/20). The
[R01 record](docs/reviews/2026-11-11-locale-digest.md) owns the contract and
verification evidence; the PR owns exact review and CI evidence.

Scope: explicit English ordering in the schema-1 artifact builder and verifier,
plus independent digest/order and cross-locale package regressions. Preserve schema,
allowlist, dependency/runtime pins and unrelated ordering, including purge plans.
Acceptance: retained published manifests keep their digests in separate `en_US`,
`cs_CZ`, `sk_SK` and `C` processes; record resolved locales. Wrong expected digests
and altered bytes must still reject. Distinguish digest compatibility from the
current verifier's historical payload-shape restrictions.
Rollback: revert the bounded R01 source commits. Existing archives and targets stay
unchanged; reverting restores the known locale defect. Release and target upgrades
remain separately authorized actions; this source repair does not perform either.

## R02 — Bounded context projection

**Released in 1.4.0.** The current delivery ledger records
[PR #21](https://github.com/OnFiala/agent.mind/pull/21). The
[R02 record](docs/reviews/2026-11-11-bounded-context.md) owns the response contract,
reproducible measurements and validation evidence.

Scope: an opt-in, versioned agent projection in `graph-context.mjs`, preserving
selection, ancestry, source hashes/evidence, revision, applicable binding, coverage
and local/global uncertainty. Retrieve vocabulary, inventory and canvas projections
explicitly; keep the legacy full projection unchanged. Installed CLI exposure,
managed instructions and preflight receipts are the separate R03 stage below.

Acceptance: initial compact JSON is at most 10,000 UTF-8 bytes for the versioned
1,000-file/five-function forward-chain fixture selecting `src/m10.mjs`, and 20,000
bytes for `server.mjs` on the pinned repository snapshot. These are response-fixture
targets, not universal evidence, indexing-memory, latency or token guarantees.
High-fan-in and Unicode output must remain valid JSON, count omissions by kind,
and retrieve every omitted item against the same revision. Changed revision or
context identity rejects continuation; insufficient budget returns an explicit
bounded error without hiding mandatory uncertainty.

Rollback: revert the bounded R02 commits. No project data, binding or runtime pin
is migrated; existing installed targets remain on their chosen release.

## R03 — Installed CLI profile and preflight receipt

**Released in 1.4.0.** The current delivery ledger records
[PR #22](https://github.com/OnFiala/agent.mind/pull/22). The
[R03 record](docs/reviews/2026-11-11-cli-profile-receipt.md) owns the CLI contract
and validation; the PR owns exact review and CI evidence.

Scope: expose the R02 agent profile through the installed CLI and newly generated
usage/instructions. Opt-in preflight returns selector, revision, binding identity,
coverage/verdict and diagnostic references without repeating the full context.
Keep existing argument forms and full JSON as the default. New managed instructions
request the profile explicitly; existing blocks change only through the authorized
attachment/update flow, preserving edited user blocks.

Acceptance: an actual produced bundle on a disposable installed target completes
context, strict preflight and context refresh with the profile. Stale revision or
binding, invalid selectors and partial context still fail the unchanged gate.
Pagination and explicit sections retain revision/binding identity and the response
budget. Generated instructions alone do not prove a host loaded or followed them.

Rollback: revert R03 before R02 and use the legacy full-context path. Preserve maps,
bindings, installed pins and edited user blocks. No target upgrade is performed.

## R04 — Explicit unsupported-reference diagnostics

**Released in 1.4.0.** The current delivery ledger records
[PR #23](https://github.com/OnFiala/agent.mind/pull/23), integrated after PR #24–#27.
The [R04 record](docs/reviews/2026-11-12-reference-diagnostics.md) owns the diagnostic
contract and dated validation. Release and real-target upgrades remain separate
owner actions.

Scope: additive per-file reasons for unavailable reference analysis, including
`.cjs` and bounded recognized CommonJS-style forms in `.js`/`.mjs`. Preserve
Python's external/unresolved information, supported ESM edges and all source IDs.
No CommonJS resolver, source-root inference or dependency change.

Acceptance: explicit CommonJS file/global/context diagnostics with source evidence
where parsed; shadowed names and non-code text do not invent CommonJS evidence.
Complete inventory and zero links do not claim full semantic analysis. Supported
Python remains eligible under the current preflight; actual warning/error/limit
states still fail. Verify the installed CLI and actual produced bundle, including
recovery after removing an unsupported fixture.

Rollback: revert only the R04 change through review using the actual merge and
verified mainline, preserving PR #24–#27. This removes the disclosure and restores the earlier silent CommonJS limitation; it
does not add resolution. No stored data, binding, naming map or runtime pin is migrated.

## R05 — Input policy and sensitive-file protection

**Merged documentation contract; no runtime implementation in R05.** The
current delivery ledger records [PR #28](https://github.com/OnFiala/agent.mind/pull/28).
The [R05 contract](docs/reviews/2026-11-15-input-policy.md) owns the reviewed
precedence, bounded root-ignore dialect, failure behavior, sensitive-file rules,
revision/cache/source-read invalidation and acceptance matrix. R06 was separately
authorized to implement this contract.
Rollback: separately revert the R05 documentation only; no data or
configuration migration is needed.

## R06 — Project exclusions

**Released in 1.4.0.** The current delivery ledger records
[PR #29](https://github.com/OnFiala/agent.mind/pull/29). The
[R06 record](docs/reviews/2026-11-15-project-exclusions.md) owns implementation,
checks and limitations; the PR owns exact review and CI evidence.

Root-only bounded ignore/default exclusions, policy identity, safe source-read
revalidation, metadata filtering and live/browser revocation preserve managed
`project.json`, runtime pins and sensitive-name guards. Invalid policy fails closed.
No stored settings, dependencies, CLI overrides or target changes are introduced.
R06 filtering alone does not prioritize source or increase caps; the separately
authorized, merged R07 work below adds ordering. Published baseline is 1.4.0;
existing installations retain their pinned behavior. An authorized revert changes
runtime code only, preserving target ignore files, naming maps, descriptors and all project contents. See the R06 record for details.

## R07 — Source priority within existing budgets

**Released in 1.4.0.** The current delivery ledger records
[PR #30](https://github.com/OnFiala/agent.mind/pull/30). The
[R07 record](docs/reviews/2026-11-15-source-priority.md) owns behavior, checks and
limitations; the PR owns exact review and CI evidence.

Eligible observed paths are ranked by recognized source suffix before allocating
file slots and byte reads. Equal ranks use ordinal full-path ordering. All R06
privacy/ignore guards and existing file, byte, entry, depth and matching-work caps
remain. Known omitted paths are explicit; incomplete scope remains partial and
fails strict preflight. No new language support, settings, dependencies or target
changes are introduced. Published 1.3.1 and pinned installations are unchanged.
An authorized revert restores previous allocation order while preserving R06,
target data and configuration.

## R08 — Keyboard contract

**Released in 1.4.0.** The current delivery ledger records
[PR #31](https://github.com/OnFiala/agent.mind/pull/31). R08 accepts the keyboard
behavior implemented by UI-NEW-02 / PR #27; it is not a second shortcut design.
The [R08 record](docs/reviews/2026-11-15-r08-keyboard-contract.md) owns acceptance,
limitations and rollback; the PR owns exact review and CI evidence.

This follow-up exposes the unchanged document key handler to direct tests and
adds permanent Back/input/bubbling regressions beside existing four-direction
movement tests. Current browser acceptance binds source and produced-bundle UI
bytes. The shortcuts, pointer handling, selection/camera behavior and all source
analysis contracts stay unchanged. No R09 work, target upgrade or release is
included. Reverting this follow-up restores the inline handler and prior tests/docs;
it does not restore the old Alt-left conflict or revert PR #27.

## R09 — Generic presentation

**Released in 1.4.0.** The current delivery ledger records
[PR #32](https://github.com/OnFiala/agent.mind/pull/32). The
[R09 record](docs/reviews/2026-11-16-r09-generic-presentation.md) owns behavior,
checks, limitations and rollback; the PR owns exact review and CI evidence.

Presentation keeps the overview's metadata/source order and orders nested parts
by source location with stable ID ties. Section/area labels and this repository's
block IDs no longer assign priority. Explicit context remains separate; file
headings use indexed kinds and literal paths rather than inferred interface/core
roles. Application fallback copy is English; user labels and Czech aliases stay
intact. Source-identity rules and graph/CLI contracts are unchanged; user naming
files are never rewritten. The maintainer map drops two references to removed
ordering helpers. Live updates retain positions; explicit Arrange recomputes layout.
No R10 work, new language support, target operation or release is included.
Rollback reverts presentation/tests/docs without rewriting user maps or positions.

## R10 — Accessor identities

**Released in 1.4.0.** The current delivery ledger records
[PR #33](https://github.com/OnFiala/agent.mind/pull/33). The
[R10 record](docs/reviews/2026-11-16-r10-accessor-identities.md) owns the intentional
identity transition, validation, limits and rollback; the PR owns exact review
and CI evidence.

The intentional exception to otherwise stable source IDs covers every supported
class accessor and its descendants, including singleton/pair transitions. They use
a structured identity with explicit get/set, static and private discriminators.
Unrelated source IDs remain stable.
Legacy selectors resolve only uniquely; ambiguous or conflicting map targets
retain diagnostics and candidates rather than silently assigning names. Shared
hierarchy/context consumers use the same resolution. Source names, ranges and
static call evidence remain authoritative, with no property-execution, object-
method, computed-accessor or cross-file-call expansion.

Acceptance covers both singleton/pair transitions, descendants, old/new naming
references, live UI/context parity and an actual installed-CLI rollback to pinned
published 1.3.1. Revert the identity rule without deleting new-ID maps: older
runtimes leave those entries unresolved. R10 itself included no version, release
or real-target operation.

## Product and installation constraints

The goal is useful inspection across source languages and environments while
preserving a small, understandable tool. Open a project into an honest inventory;
add deeper analysis only where a tested language adapter supports it.

Keep the existing target shape:

```text
project/
├── AGENTS.md                 # one optional managed instruction block
└── agent.mind/
    ├── cli.mjs               # one installed entry point
    ├── README.md
    ├── project.json          # portable settings and exact runtime pin
    ├── project-map.json      # user-owned naming and grouping
    ├── .gitignore
    └── .local/               # host binding, bundled runtime, recovery
```

- Preserve the target's package.json, lockfile, dependencies and existing instructions.
  Do not add a second project manifest, hidden root hook or new global configuration.
- One verified release carries its runtime dependencies. No target compiler/build
  execution, install scripts or parser downloads during a source scan.
- Keep per-project versions pinned. A newer release does not silently update targets.
  Clone adoption, moves/rebinds and updates stay explicit and conflict-preserving.
- Keep user map/history and recovery distinct from reproducible caches. Do not make
  purge part of an update. Local binding identity remains authoritative for that host.
- Require no account, API key, model, persistent daemon, database or cloud service.
  Keep the browser and CLI on the same source-derived graph.

## Remaining work from the 2026-11-11 repair plan

These contracts retain the approved plan's intent; they do not grant implementation,
merge, publication, host registration or target-operation authority. The owner
accepted the R11 design and separately authorized PR #36's merge on 2026-11-16;
R12 remains pending. R13–R16 require the stated evidence and separate owner authorization.
The historical L0–L6 sequence below remains evidence, not a competing next-work list.

| Work | Priority / state | Prerequisites and next deliverable |
|---|---|---|
| R11 | P1, accepted design; no implementation | [Scoped-preflight contract](docs/reviews/2026-11-16-r11-scoped-preflight.md); [PR #36](https://github.com/OnFiala/agent.mind/pull/36) owns actual merge/CI evidence; R15 requires separate authorization |
| R12 | P1, pending evaluation | R03/R04; paired consumer evaluation on representative pinned projects |
| R13 | P2, conditional | R12 demonstrates typed-project demand; typed import/export syntax evidence |
| R14 | P2, conditional | R12 selects one resolver mode/corpus; R13 for typed input |
| R15 | P2, conditional | Accepted R11; operation's required coverage from R13/R14 |
| R16 | P2, conditional | R12 demonstrates integration benefit; R03, with unchanged strict gate permitted |

Keep UI and CLI on one source-derived graph. Preserve existing source IDs except
the bounded, intentional R10 accessor transition. Revert dependents before their
prerequisites; never rewrite published tags/archives or silently downgrade targets.

### Contracts and evidence before expansion

### R11 — Scoped-preflight design

**Accepted design contract; no implementation or gate relaxation.** After independent
review, the owner accepted R11 and authorized PR #36's merge, subsequent CI and
documentation on 2026-11-16. The
[accepted contract](docs/reviews/2026-11-16-r11-scoped-preflight.md) separates
freshness, inventory, completed per-file capabilities and sufficiency for a named
operation. It preserves strict preflight/current semantics and proposes an explicit
versioned opt-in receipt, global blockers and 24 decision cases, including unknown
incoming/outgoing scope, stale continuations and UI/CLI parity.

Text inspection and direct file-boundary review make different promises; a text
receipt cannot establish dependency completeness or edit safety. The present graph
lacks sufficient coverage evidence for the proposed boundary operation. Unknown
scope and missing edges never prove dependency absence; even a safely scoped
limitation remains visible. R11 proposes no asset-name exception or new read access.

Independent review, actual merge and subsequent CI receipts belong to
[PR #36](https://github.com/OnFiala/agent.mind/pull/36); approval alone proves neither
merge completion nor CI success. R15 still needs separate implementation authority
and the operation's required R13/R14 coverage. R12 and the conditional roadmap
below remain unchanged. Rollback: withdraw/revert these design documents;
legacy behavior and installed targets remain unchanged.

### R12 — Consumer evaluation

**L6, strategy A/B.** Scope: compare identical authorized
tasks with/without R03 context on pinned disposable copies of representative existing
projects: at least one supported ESM task and one supported Python task. Preselect
the exact projects and dependency-sensitive tasks, preserving their real complexity;
an authored two-file happy-path fixture is not enough. Select a typed project to establish the next
needed capability; record unsupported paths without bypassing preflight.
**Acceptance:** predeclare outcomes, model/host/settings, repeated paired runs,
independent correctness rubric and stop conditions. Record missed dependencies,
authorized test results, output bytes/tokens, elapsed time and instruction activation.
Never execute a target merely to index it. Keep private source outside public evidence;
only sanitized fixtures/method/results may enter a separately authorized public PR.
No-benefit is a valid outcome. Decide whether resolver/MCP work is justified and
whether a default-format switch deserves a separate compatibility PR; one task cannot
establish general superiority, nor can lower token use compensate for worse correctness.
**Rollback:** withdraw the recommendation; retire only disposable evaluation artifacts.

### Conditional implementation PRs

**R13 — Typed references (RES-01).** Scope: extract static imports/reexports and
type-only syntax from the existing Babel AST; resolution stays in `code-index.mjs`.
**Acceptance:** exact ranges/hashes on TS/TSX/JSX fixtures; malformed/dynamic input
remains explicitly unresolved. No calls, types or framework behavior inferred; JS
IDs/graphs stay stable. Extracting imports alone does not remove typed partial status.
**Rollback:** return to declaration-only inspection with visible limitations.

**R14 — One local resolver mode (RES-01).** Scope: R12 selects one mode and pinned
source corpus; document its bounded rules/counterexamples before implementation.
Node ESM retains explicit relative extensions/index paths; CJS and bundler rules
are not interchangeable. Config reading is bounded, non-executable and root-confined.
**Acceptance:** exact expected edges/unresolved cases on the corpus, plus collision,
extension/index, boundary and mode-mismatch fixtures. Report precision, the resolved
reference denominator and remaining gaps, not an unqualified 95% target. Aliases,
conditional package exports, workspace packages and further modes need separate PRs.
**Rollback:** disable/revert the opt-in mode, invalidate its cache and retain diagnostics.

**R15 — Scoped gate (GATE-01).** Scope: implement only the accepted R11 operation
contract when its required coverage from R13/R14 exists. Preserve legacy strict
preflight; never relabel global partial as current.
**Acceptance:** all R11 negative controls fail explicitly; a supported selection may
pass despite a demonstrably unrelated limitation. Context, receipt and UI agree on
global/selected status. Installed-target tests reject stale revisions/bindings and
do not imply a lock or runtime guarantee.
**Rollback:** remove the opt-in path; version/revision/binding rules invalidate its
receipts and consumers return to the legacy strict path.

**R16 — Local MCP pilot (HOST-01).** Scope: after R12 shows a useful consumer workflow,
wrap the same engine with bounded resolve/context/strict-preflight tools over stdio.
R15 is not required; the pilot can retain the unchanged strict gate.
**Acceptance:** two explicitly selected hosts use the same bound project/revision and
return CLI-equivalent evidence. Check budgets, schemas/errors, cancellation, root
isolation and cleanup. Review launch permissions; stdio is not a sandbox. No global
auto-registration, source-writing tool or silent target upgrade.
**Rollback:** remove the optional adapter/registration through its documented local
lifecycle; CLI/browser keep working with the pinned runtime.

### Audit-theme ledger and decision triggers

This ledger maps all 26 November 11 audit IDs, including DEP-01 in its hygiene
section. They are planning themes, not 26 validated vulnerabilities or an assertion
of complete repair. The older baseline review and November 15 CORE/UI repairs use
separate finding namespaces. Priorities below are delivery choices, distinct from
the original audit's severity labels; no whole-audit closure is claimed.

| Audit IDs | Bounded disposition and condition for further work |
|---|---|
| LOC-01 | R01 is merged; schema-1 locale compatibility is the bounded repair. A new canonical-order schema needs separate compatibility work. |
| CTX-01 | R02/R03 are merged; bounded output is opt-in, legacy full JSON remains the default. R12 must evaluate consumer benefit before any separate default-format change. Output budgets do not bound indexing cost. |
| SILENT-01 | R04 adds explicit unsupported-reference diagnostics, not CommonJS resolution or implicit Python source-root discovery. Existing Python informational uncertainty remains visible. |
| SCOPE-01 | R05/R06/R07 provide the accepted input contract, bounded root-ignore/default exclusions and source priority under existing caps. They do not provide full Git semantics or complete inventory beyond limits. |
| SENS-01 | Hard sensitive-name guards remain. Source extensions do not prove safe contents; no sensitive-file exception is accepted. A separate exposure design and synthetic no-open/no-disclosure regressions must precede any implementation. |
| GATE-01 | R11 is a [design proposal; owner acceptance pending](docs/reviews/2026-11-16-r11-scoped-preflight.md); owner acceptance and conditional R15 remain pending. Strict preflight stays unchanged; unknown incoming scope cannot prove dependency absence, and global partial is never relabeled current. |
| RES-01 | R13/R14 remain conditional on R12's demonstrated demand and selected corpus/mode; no broader resolver or typed-completeness claim. |
| HOST-01 | R12 precedes conditional R16; no MCP auto-registration or write hook. Instruction activation requires separate host evidence. |
| SYM-01 | R10 repairs supported class-accessor identities and descendants. Object methods, computed accessors and other duplicate/binding gaps need a concrete task, exact fixtures and their own PR. |
| UI-04 | R09 removes repository-specific presentation priority and supplies English fallback copy; user naming files and Czech aliases are preserved. This is not a whole-product UX acceptance. |
| UI-01, UI-02, UI-03, PERF-01 | PR #26/#27 and R08 repair selection/keyboard behavior with scoped regressions. Reproduce remaining SSE/focus/state failures in a browser and profile a failing supported graph before renderer/store splits, workers or delta SSE. UI-RECONCILE-01 remains unapproved; never replace authoritative hashing with mtime alone. |
| CALL-01, DUP-01 | Concrete imported-call/scope tasks, exact binding fixtures and differential checks must justify work; keep it separate from resolver and identity fixes. |
| LIFE-01, LIFE-02 | Upgrade/doctor proposals need crash recovery, lease ownership, map preservation and downgrade tests. A dead PID alone never silently transfers custody. Retain explicit lifecycle/update paths. |
| REL-01, TEST-01 | Candidate release checks and targeted regressions do not establish CI provenance, reproducible tar bytes or full browser coverage. Those and macOS CI require separate scoped proposals; retain Node 22/24 and package/upgrade checks. |
| DOC-01, STYLE-01 | This reconciliation covers roadmap status/navigation only. Further documentation or touched-module formatting needs scoped link/command checks and behavior-preserving diffs; no whole-repository formatting or history relocation. |
| GOV-01, PRIV-01, PROC-01, DEP-01 | Reverify live state before scoped changes to settings, author identity, support windows or dependencies. No history rewrite or automatic N−1-only policy; a dependency major version is not itself a vulnerability. |

Architecture rules/impact, npm distribution, new languages, LSP/SCIP and write hooks
remain demand-led proposals needing separate authority, packaging and evidence
contracts. The shared human/agent map remains the product; no pivot is authorized.

### Verification for remaining work and release preparation

- Documentation-only PRs: check diff scope, Markdown links/anchors, dependency order,
  status wording and independent exact-diff review; claim no runtime checks.
- Implementation PRs: focused regressions and applicable Node 22/24 CI. Context,
  installation and artifact changes also exercise produced bundles in disposable
  targets; UI changes require a real-browser check. Never execute a scanned project
  to discover its structure.
- Before an authorized release: full `npm test`, `npm run package`,
  `scripts/smoke-release.mjs` against produced bytes, and every retained upgrade/
  rollback path, including published 1.3.1 as the immediate baseline. Record exact
  source/artifact identities, independent review and remaining limits.
- A check advances only its evidence status. Release preparation does not authorize
  merge, publication, a target upgrade or any pending R11–R16 implementation.

## PR sequence

Historical expansion sequence and delivery evidence follow. The current delivery
ledger and remaining-work contracts above own next priorities; completed rows below
are not reopened by this reconciliation.

Every row is independently reviewable and reversible. Status changes only with a
linked PR/commit and its actual checks; a merged planning PR does not mark later
stages complete. Approval of the sequence does not authorize later implementation stages.

| ID | Scope / status | Acceptance and rollback |
|---|---|---|
| L0 | **Merged:** [PR #1](https://github.com/OnFiala/agent.mind/pull/1), baseline audit, sequence and contribution workflow | Independent review of the public diff; no private data or runtime payload changes. Revert only the documentation commits. |
| L1 | **Merged:** [PR #2](https://github.com/OnFiala/agent.mind/pull/2), source-view correctness, UI-01 and UI-02 | Excerpts cover all lines; moved symbols refresh their card location; node IDs/camera/selection remain stable. Focused regressions plus relevant suite. Revert that bounded UI commit. |
| L2 | **Merged:** [PR #3](https://github.com/OnFiala/agent.mind/pull/3), safe inventory and additive capability/freshness reporting, CORE-01/02 | Unsupported text add/edit/delete changes inventory revision; binary/oversized/excluded files have explicit states; limits and hash-bound reads hold. Existing JS graph/IDs and strict preflight remain compatible. No new dependency or target file. |
| L3 | **Merged:** [PR #4](https://github.com/OnFiala/agent.mind/pull/4), smallest synchronous source-analysis boundary for the first additional language | Existing JS/HTML behavior matches baseline fixtures. A small internal dispatch/return shape is enough; no plugin registry or separate service. Adapter/config versions enter cache identity only when needed. |
| L4 | **Pilot merged:** [PR #5](https://github.com/OnFiala/agent.mind/pull/5); release preparation merged in [PR #6](https://github.com/OnFiala/agent.mind/pull/6) | Measure at least two parser options before choosing. Source ranges, symbols, errors and uncertainty pass fixtures; size/latency/memory budgets are recorded before accepting the dependency. No framework-routing or complete-call-graph claim. Preserve the existing JS adapter/IDs. |
| L5 | **Released in 1.3.0:** [PR #16](https://github.com/OnFiala/agent.mind/pull/16) extends the merged [PR #8](https://github.com/OnFiala/agent.mind/pull/8) pilot with declarations, imports and conservative local calls; private-name follow-up below; other languages remain demand-led | One adapter at a time with its own capability/version row, fixtures, scope limits and incremental footprint. Import/name resolution is a separate measured capability from syntax. |
| AUD3-CODE-01 / PY-IDENTITY-01 | **Released in 1.3.1:** [PR #17](https://github.com/OnFiala/agent.mind/pull/17), 2026-11-03, merge `0905300` | [Dated review/plan](docs/reviews/2026-11-03-python-identity-and-ui-plan.md) owns evidence, semantic decisions and acceptance. Reviewed head `a0f9eba7`; 305 local tests, bundle smoke, four retained upgrade/rollback paths and Node 22/24 CI passed. Publication and current rollback are recorded below. |
| PY-PATCH-131 | **Released in 1.3.1 ([PR #18](https://github.com/OnFiala/agent.mind/pull/18)), 2026-11-03:** preserve construct projections, lambda default enclosing scope and version-sensitive class annotations | [1.3.1 release record](docs/releases/1.3.1.md) owns exact acceptance, publication and rollback evidence: 327 local tests, 11 bundle smoke groups, all five upgrade/rollback paths, installed browser and Node 22/24 CI passed. Independent review accepted implementation `bf79ab23` and final documentation `25269883`; merge/tag `1558dc0`. Real-target upgrades remain separate. |
| UI-RECONCILE-01 | **Optional proposal; approval PENDING:** extract bounded UI reconciliation ownership; maintainability opportunity, no new defect asserted | Same [plan](docs/reviews/2026-11-03-python-identity-and-ui-plan.md); separate scope/commit/PR and navigation/late-response browser acceptance if chosen. Installer split deferred. |
| L6 | **Codex consumer evaluation started:** existing local AGENTS + CLI workflow; additional integration remains demand-led | Verify instruction activation and actual consumer behavior first. Accept Windows/WSL, container/remote, cancellation and framework depth separately; do not infer platform support from a parser. |

L1 implementation commit [`9fbcb61`](https://github.com/OnFiala/agent.mind/commit/9fbcb61fb29a15e145c41f2542b8059e52a51f77) adds six production-path regressions.
Local checks passed: 144 tests, package build and 7 smoke scenarios; a disposable
Chrome fixture verified full line coverage and stable card/view state after a symbol
move. Candidate runtime is 1,961,184 bytes (+177), with no new dependency.
PR #2 records independent review, CI and the current merge status.
The owner approved L1 on 2026-11-01; runtime release and target upgrades remain separate.

The L2 candidate in PR #3 passed 153 local tests, package build,
7 smoke scenarios and a disposable browser check of inventory states and live
unsupported-text updates. Candidate runtime is 1,968,707 bytes (+7,523 from L1),
with the same dependency count. All regular files share the existing budgets;
previously ignored oversized assets can now make inventory/context partial.
Independent review found and prompted a bounded correction for conventional
private-key and dotenv filenames, with synthetic no-open/source-refusal regressions.
PR #3 was owner-approved and merged on 2026-11-01; L2 is included in the 1.1.0 release line.

The L3 candidate in PR #4 moves existing JS/HTML/JSON analysis into one pure
synchronous module. Inventory, safe reads, cache, reference resolution and graph
composition remain in the index. No new language, dependency, registry or worker
is added. Existing source/result shapes and conservative inference are preserved.
Two Unicode/CRLF characterizations passed before and after extraction; the final
local suite passed 155 tests. Differential checks matched 86 complete graph results
on identical inputs (only generation time and parse duration normalized), including
cold/warm/update scans. Package and 7 actual-bundle smoke checks passed. Candidate
runtime is 1,970,806 bytes (+2,099 from L2), with the same one dependency. The new
module is included in the explicit artifact allowlist and test runtime fixtures.
PR #4 was owner-approved and merged on 2026-11-01 as `129c43b`; L3 is included in the 1.1.0 release line.

PR #5 was owner-approved and merged as `d934557` on 2026-11-01.
The L4 implementation provides the syntax-only TS/TSX/JSX pilot. The
[comparison and fixed acceptance contract](docs/reviews/2026-11-01-typescript-parser-comparison.md)
records Babel 7.29.12 versus TypeScript 6.0.3 before dependency selection. Babel
uses a pure synchronous analyzer, 64 KiB pre-parse cap, source-hashed UTF-16 ranges,
native kinds and parser provenance. Every typed file stays partial: import/type/call,
security/HTTP and framework analysis are outside this pilot; strict preflight is
unchanged. Full local suite: 165 tests. Existing JS behavior matched 24 complete
baseline/candidate graph comparisons (only generation time/parse duration normalized).
Actual artifact and bounded real-corpus index/live measurements pass the fixed budgets.
Headless Chrome verified typed labels and source notes, then stable selection/camera
and refreshed source location after a line move. All nine actual-bundle smoke
checks and Node 22/24 CI passed. Scope review accepted `ed63223`; PR #5 records
independent exact-diff review and its final disposition. This is syntax inspection, not full TypeScript editing acceptance.
The separate [1.1.0 preparation PR #6](https://github.com/OnFiala/agent.mind/pull/6) verifies the documented upgrade/rollback
from published 1.0.3 and installed inspection of a real TS project; publication
remains an owner action. [PR #7](https://github.com/OnFiala/agent.mind/pull/7) records
the final documentation audit and release verification. See
[1.1.0 release notes](docs/releases/1.1.0.md).
If the owner chooses to withdraw L4 before publication, revert the focused L4
implementation commits. Reverting only PR #6 withdraws release preparation.
Existing target installations are untouched.

PR #8 was owner-approved and merged as `f764fa9c` on 2026-11-02.
The L5 Python pilot adds a pure synchronous `.py` declaration adapter using Lezer.
Its [fixed contract and measurements](docs/reviews/2026-11-01-python-pilot.md)
separate editor syntax from CPython validity, semantics and runtime behavior.
In that historical pilot every Python file remained partial. The published 1.3.0
adds source relationships and removes only the unconditional language warning;
strict preflight still rejects real errors, limits and incomplete scans.
The separate [1.2.0 release preparation](docs/releases/1.2.0.md) covers the actual
published-1.1.0 upgrade/rollback path and installed Python inspection. Publication,
real-target upgrades and L6 environment expansion remain separate owner decisions.

The present JS tool remains usable while later stages are unfinished. No stage may
expand the product's support claim before its acceptance evidence exists.

## 1.2.1 targeted repairs

Four separate repair PRs track [parameter environments #10](https://github.com/OnFiala/agent.mind/pull/10),
[static prototype writes #11](https://github.com/OnFiala/agent.mind/pull/11),
[dense-source analysis cost #12](https://github.com/OnFiala/agent.mind/pull/12), and
[visible nested-map failure #13](https://github.com/OnFiala/agent.mind/pull/13).
They preserve the current architecture, dependency set and language capability limits.
The [1.2.1 release record](docs/releases/1.2.1.md) owns the combined checks and rollback;
PR state and Releases own review/merge/publication facts. These repairs do not advance L6.

## Follow-up repair candidate: switch scope and wide AST arrays

Two focused commits after 1.2.1 keep switch discriminants in the enclosing scope
and remove breadth-dependent variadic appends in the source/symbol analyzers.
The cases retain their shared lexical scope; existing traversal order and budgets
remain unchanged. A 300,018-byte array fixture now has one readable, hash-bound
inventory entry and an explicit symbol-budget diagnostic. Local validation passed
204 tests, packaging and all 10 bundle smoke groups. Independent review covered
all five code/test files, reran 75 tests and checked 24 differential cases.
The candidate was merged in [PR #15](https://github.com/OnFiala/agent.mind/pull/15)
as `2b2684a`. It does not change the published 1.2.1 or installed targets.
Rollback the wide-array commit, then the switch-scope commit.

## L6: first Codex consumer check

The selected focus is use from Codex. A disposable two-source-file JavaScript
project with the published 1.2.1 integration passed a read-only consumer probe on
macOS with Codex CLI 0.166.0. A fresh Codex run emitted a fixture instruction marker
before any tool use, without manually opening the instruction file, selected a
named block, read its implementation and related test, and obtained a matching
revision/binding preflight. All 59 fixture/runtime files retained their hashes.
This verifies one startup and inspection workflow. The installed status correctly
continues to report `instructionActivation: not-verified`; the host-run evidence
is separate from what the CLI itself can establish.

[Codex instruction discovery](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
loads the instruction chain at startup; overrides, working directory and size
limits still matter. No new plugin, MCP service or global configuration is required
by this tested path. The next proposed acceptance step is an authorized edit on a
representative real project, including stale context, refreshed source and relevant
tests. The synthetic probe did not measure coding quality or token/time savings,
exercise edits, cancellation, the Codex desktop app, remote hosts or other platforms.
At the time of this 1.2.1 probe, typed/Python inspection remained partial and
strict preflight rejected it. Python completion is tracked separately below.
Broader L6 support remains unaccepted until its own evidence exists.

## Python completion and Codex workflow (1.3.0 released)

The approved practical scope is source inventory, declarations, import references
and conservative same-file bare calls, followed by an actual installed Codex
context/preflight/edit/test/refresh workflow. Types, imported calls, runtime import
paths and framework behavior are outside this scope. The analyzer remains a pure
synchronous text function; the index owns source-module resolution. No interpreter,
plugin, service or global configuration is added. The strict preflight is unchanged:
ordinary Python no longer receives a blanket partial warning, while actual errors,
limits and incomplete reads still reject it. See [1.3.0 acceptance and rollback](docs/releases/1.3.0.md).

The released implementation passed 273 tests, actual-bundle smoke, published-1.2.1 upgrade/
rollback, and an installed Codex edit/test/refresh cycle on an authored Python
fixture. The separate browser check preserved selection/camera and restored source.
The pinned 24-file Flask corpus returns `current` with complete inventory; no Flask
code was executed. Relative imports may traverse namespace subdirectories beneath
an indexed regular-package ancestor; top-level/merged namespaces and environment
path discovery remain unresolved. Exact artifact IDs, measured bounds, independent
review scope and unverified host/runtime claims belong to the release record and
implementation PR. This completed the agreed practical Python source workflow, with the private-name
follow-up tracked above. Publication occurred on 2026-11-03; broader L6 acceptance
and any real-target upgrade remain separate.


## Small internal boundaries

Start L2 by separating eligibility for safe inventory/text reads from eligibility
for a parser. A listed file is not automatically readable, parsed or semantically
understood. Track freshness, available capabilities and unresolved/failed work
separately; retain visible exclusions and budgets.

The current strict preflight remains unchanged. Any future inventory-only operation
must have an explicit limited contract and receipt; it cannot imply dependency or
semantic validation. Incomplete scans cannot vouch for unseen scope.

The L3 candidate separates the existing analyzer at this internal boundary:

```text
safe source bytes + identity
    -> existing JS/HTML or one new language analyzer
    -> symbols / syntactic references / diagnostics
    -> conservative resolution
    -> shared graph -> browser and agent context
```

Source facts retain hashes/ranges and their producer; naming metadata never invents
edges. Preserve language-specific kinds as well as generic display kinds. Define
source range encoding/offset units, including Unicode/CRLF conversion fixtures,
before accepting a new parser. Unsupported embedded regions remain explicit.

Retain the synchronous implementation and in-memory cache for the current bounded
scope. Before accepting a parser that can block supported workloads, measure the
actual effect. Introduce a single bounded worker boundary only if measured deadlines,
responsiveness or containment require it; then explicitly handle cancellation,
late results and the async CLI/server contract. Workers/WASM are not by themselves
security sandboxes. Do not bundle the worker migration into an unrelated fix.

## Keep the weight measurable

Baseline uncompressed runtime is 1,961,007 bytes including manifest, with one
production dependency. This is a measurement, not an all-project memory budget.
The L1 through L3 candidates add no runtime dependencies. The roadmap and
review records stay outside the runtime artifact allowlist; the usage README and
artwork provenance README are included.

Before selecting the L4 parser, commit a small comparison with exact versions,
licenses, compressed/unpacked bytes, runtime dependency count, cold/unchanged/update
latency and peak memory on fixed fixtures and one selected real project. Record
budgets before declaring a winner; a smaller download cannot excuse incorrect
ranges or missing diagnostics. Tree-sitter/WASM is one candidate, not a prerequisite.
Use maintained parser packages rather than growing a regex-based language parser.

Prefer fewer moving parts over micro-optimizations. Artwork accounted for about 54%
of the 1.0.3 baseline payload; the 1.1.0 parser changes that proportion.
Visual-preserving asset optimization remains a separate optional size task. It does not justify a global shared cache or language pack manager.
A registry, language marketplace, database, automatic LSP/indexer execution, compiler
orchestration and remote transport remain out of the early implementation scope.

## Review and delivery contract

For every implementation PR:

1. Name the stage/finding IDs and one bounded behavior change; record base/head and
   preserve unrelated edits. Use focused commits on a feature branch.
2. Include the actual diff, acceptance checks/results, known limitations, footprint
   delta and rollback. Do not equate static test references with passing tests.
3. Have another agent inspect the exact diff and validate the claims independently.
   Keep producer and reviewer roles distinct. Record the reviewed commit/hash and
   disposition in the PR; new material changes require review of that delta.
4. Run applicable CI and the narrowest meaningful local checks. Before a runtime
   release, run the full test suite, package build and smoke against produced bytes.
5. Keep the PR ready for owner review only after findings are resolved or explicitly
   accepted. Merge, publication and target upgrades remain separate authorized acts.

If review or required checks cannot run, retain draft/pending status with the exact
gap. Do not mark a roadmap stage complete from code existence or a planning approval.
Use this table and PR links as the sole live priority/status tracker; dated reviews
own finding evidence and proposed contracts. The implementation owner updates the
affected row when work is approved or implemented, the independent reviewer records
the exact reviewed head and validation before verified status, and the integrating
agent records merge/release evidence after each separately authorized action.
Approval alone is not implementation, verification, merge or publication. Update
README capability limits and release records when verified behavior or publication
changes; preserve historical evidence as dated evidence. This is work performed at
each transition, with no recurring automation or additional tracker implied.
