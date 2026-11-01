# Lightweight expansion plan

Status: sequence approved in [PR #1](https://github.com/OnFiala/agent.mind/pull/1), 2026-11-01. Current shipped runtime: 1.0.3.
This file owns implementation priorities; the [baseline review](docs/reviews/2026-11-01-architecture-and-code-quality.md)
owns dated findings and their evidence. No new language or platform support is
claimed by this plan or the L1 correction.

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
| L1 | **In review:** [PR #2](https://github.com/OnFiala/agent.mind/pull/2), source-view correctness, UI-01 and UI-02 | Excerpts cover all lines; moved symbols refresh their card location; node IDs/camera/selection remain stable. Focused regressions plus relevant suite. Revert that bounded UI commit. |
| L2 | **Proposed:** safe inventory and additive capability/freshness reporting, CORE-01/02 | Unsupported text add/edit/delete changes inventory revision; binary/oversized/excluded files have explicit states; limits and hash-bound reads hold. Existing JS graph/IDs and strict preflight remain compatible. No new dependency or target file. |
| L3 | **Proposed:** smallest parser seam needed for the first additional language | Existing JS/HTML behavior matches baseline fixtures. A small internal dispatch/return shape is enough; no plugin registry or separate service. Adapter/config versions enter cache identity only when needed. |
| L4 | **Proposed:** one bounded TypeScript/TSX/JSX syntax pilot, then production acceptance | Measure at least two parser options before choosing. Source ranges, symbols, errors and uncertainty pass fixtures; size/latency/memory budgets are recorded before accepting the dependency. No framework-routing or complete-call-graph claim. Preserve the existing JS adapter/IDs. |
| L5 | **Proposed:** Python, then other languages according to real use | One adapter at a time with its own capability/version row, fixtures, scope limits and incremental footprint. Import/name resolution is a separate measured capability from syntax. |
| L6 | **Deferred until needed:** additional environment/framework depth | Accept Windows/WSL, container/remote and host integrations separately. Verify paths, binding, cancellation and actual consumer behavior; do not infer platform support from a parser. |

L1 implementation commit [`9fbcb61`](https://github.com/OnFiala/agent.mind/commit/9fbcb61fb29a15e145c41f2542b8059e52a51f77) adds six production-path regressions.
Local checks passed: 144 tests, package build and 7 smoke scenarios; a disposable
Chrome fixture verified full line coverage and stable card/view state after a symbol
move. Candidate runtime is 1,961,184 bytes (+177), with no new dependency.
PR #2 records independent review and CI; L1 is not merged or released.

The present JS tool remains usable while later stages are unfinished. No stage may
expand the product's support claim before its acceptance evidence exists.

## Small internal boundaries

Start L2 by separating eligibility for safe inventory/text reads from eligibility
for a parser. A listed file is not automatically readable, parsed or semantically
understood. Track freshness, available capabilities and unresolved/failed work
separately; retain visible exclusions and budgets.

The current strict preflight remains unchanged. Any future inventory-only operation
must have an explicit limited contract and receipt; it cannot imply dependency or
semantic validation. Incomplete scans cannot vouch for unseen scope.

At L3, extract the existing analyzer only as far as the first new language requires:

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
The first two implementation stages add no runtime dependencies. Documentation and
review records stay outside the runtime artifact allowlist.

Before selecting the L4 parser, commit a small comparison with exact versions,
licenses, compressed/unpacked bytes, runtime dependency count, cold/unchanged/update
latency and peak memory on fixed fixtures and one selected real project. Record
budgets before declaring a winner; a smaller download cannot excuse incorrect
ranges or missing diagnostics. Tree-sitter/WASM is one candidate, not a prerequisite.
Use maintained parser packages rather than growing a regex-based language parser.

Prefer fewer moving parts over micro-optimizations. Artwork accounts for about 54%
of today's payload, so visual-preserving asset optimization is a separate optional
size task. It does not justify a global shared cache or language pack manager.
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
Use this table and PR links as the tracking mechanism; no additional tracker service
or duplicated roadmap is required.
