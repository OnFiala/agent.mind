# Lightweight expansion plan

Status: sequence approved in [PR #1](https://github.com/OnFiala/agent.mind/pull/1), 2026-11-01. Published baseline: **[1.3.1](https://github.com/OnFiala/agent.mind/releases/tag/v1.3.1)**, 2026-11-03; [PR #18](https://github.com/OnFiala/agent.mind/pull/18) merged as `1558dc0`.
[GitHub Releases](https://github.com/OnFiala/agent.mind/releases) owns the published
versions and downloads; source version numbers alone do not establish publication.
This file owns implementation priorities; the [baseline review](docs/reviews/2026-11-01-architecture-and-code-quality.md)
owns dated findings and their evidence. No new language or platform support is
claimed by this plan or the L1/L2/L3 changes; L2 adds inventory and text reads only,
and L3 only separates the existing analysis from indexing.

## R01 — Locale-stable artifact digest

**R01 source repair; unreleased.** The owner authorized this bounded repair and
its merge on 2026-11-11, including tests, published-artifact compatibility checks,
independent review and [PR #20](https://github.com/OnFiala/agent.mind/pull/20).
That PR owns merge status and subsequent CI evidence. Further audit repairs remain
separately gated.
The [R01 record](docs/reviews/2026-11-11-locale-digest.md) owns the contract and
verification evidence. Published baseline remains 1.3.1.

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

**R02 source repair; unreleased.** The owner authorized R02 implementation and
its merge on 2026-11-11, including tests, documentation, independent review and
[PR #21](https://github.com/OnFiala/agent.mind/pull/21). That PR owns merge status
and subsequent CI evidence. Release and subsequent repairs remain separately gated.
The [R02 record](docs/reviews/2026-11-11-bounded-context.md) owns the response
contract, reproducible measurements and validation evidence.

Scope: an opt-in, versioned agent projection in `graph-context.mjs`, preserving
selection, ancestry, source hashes/evidence, revision, applicable binding, coverage
and local/global uncertainty. Retrieve vocabulary, inventory and canvas projections
explicitly; keep the legacy full projection unchanged. Installed CLI exposure,
managed instructions and preflight receipts belong to the later R03 stage.

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

## PR sequence

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
