# R02: bounded agent context

Date: 2026-11-11. Base: `e20f43ef7b9d182ae0937fa2b587d9b8584c0bc7`.
Status: source repair; merge authorized by the owner on 2026-11-11, release withheld.
The authorized scope includes implementation, tests, documentation and independent review.
[ROADMAP](../../ROADMAP.md#r02--bounded-context-projection) owns priority and status;
[PR #21](https://github.com/OnFiala/agent.mind/pull/21) records exact reviewed commits,
review disposition, merge status and pre-/post-merge CI.
Published 1.3.1 and existing installations do not include this source repair.

## Contract

Selected full context repeats global vocabulary, inventory and canvas projections.
R02 adds a separate versioned, opt-in projection with a UTF-8 response budget.
It preserves source-derived identity, evidence and uncertainty while making omitted
items explicitly retrievable. The legacy projection remains the default.

The acceptance fixture is a versioned, self-contained generator of 1,000 `.mjs`
files, five named functions per file and forward-chain imports, selecting
`src/m10.mjs`. Initial compact JSON must fit 10,000 bytes. The second measurement
uses `server.mjs` from repository snapshot
`e20f43ef7b9d182ae0937fa2b587d9b8584c0bc7` with a 20,000-byte budget.
These limits describe responses for fixed inputs, not universal indexing, latency,
memory or token guarantees.

Continuation must retain the same revision and context identity. Omitted transfer
items do not change analysis coverage or turn a partial scan into a complete one.
Every omitted item, including nested evidence and Unicode text, must be retrievable
without loss. An insufficient budget must produce an explicit bounded error;
it must not silently drop mandatory uncertainty.

## Version 1 response

The source API is `projectContext(graph, selector, { profile: 'agent', version: 1,
maxBytes: 10000 })`; `freshContext(root, selector, indexOptions, projectionOptions)`
uses the same projection after its existing two-read revision check. No profile
means the unchanged legacy response. The budget counts compact `JSON.stringify`
in UTF-8, excluding indentation, a trailing newline and transport framing.

The mandatory envelope preserves project/revision, canonical selection, ancestry,
applicable binding/runtime, status, inventory state counts and selected-source count.
Global/local diagnostic totals and severities, symbol-diagnostic totals, excluded
and unsupported counts and the full existing scope limitations remain explicit.
Test results are always `not-observed`; source relationships do not prove execution.

| Section | Retrieved contents |
|---|---|
| `context` | Selected source hashes/capabilities, local diagnostics, related file edges/nodes and symbol nodes/edges; tagged by kind |
| `diagnostics` | Global index diagnostics |
| `symbolDiagnostics` | Symbol diagnostics within the selected scope |
| `globalSymbolDiagnostics` | All symbol diagnostics, including outside the selection |
| `selectionDetails` | The original complete selection, including membership and aliases |
| `vocabulary` | Global naming vocabulary |
| `inventory` | Global inventory entries; status is retained in the envelope |
| `canvas`, `partCanvas`, `overview`, `scope` | The complete corresponding legacy projections, each as an item |

Context items have fixed kind priority, starting with selected-source coverage,
and deterministic ordering within each kind. Each section reports total and
omitted counts; `context` also reports counts per item kind. Omitted counts refer
to items not provided in full in that response. They do not downgrade or upgrade
the underlying analysis status. Consumers must follow continuation to obtain
remaining evidence before treating that evidence as known.

`contextCursor(response, section)` starts explicit retrieval from the response's
snapshot. `page.next` continues the current section. The stateless versioned cursor
binds a canonical selection, root/project, revision, binding and exact projection
contents, including runtime, scope and derived presentation. Selector aliases
resolving to the same selection are equivalent. Changed identity/content rejects
continuation with `STALE_CONTEXT_CURSOR`; malformed cursors reject with
`INVALID_CONTEXT_CURSOR`. A snapshot hash is not a signature, access-control
mechanism or lock; the caller still owns source freshness before acting.

Complete items retain their values. An oversized item uses JSON-text fragments with
an item index and UTF-16 offsets/total length. Concatenate every fragment in order
and parse the reconstructed JSON; do not treat a suffix fragment as a complete
item. UTF-8 response-size checks include escaping and multi-byte characters, and
fragments do not split astral Unicode code points. An insufficient budget returns
`CONTEXT_BUDGET_TOO_SMALL` with the requested and required byte counts. Budgets below
256 or non-integer/unsafe values throw `INVALID_CONTEXT_BUDGET`.

The implementation still builds the legacy projection in memory to preserve its
authoritative scope and evidence. This change limits transferred response size;
it does not claim faster indexing, lower peak memory or measured token savings.

## Reproducible measurements

Run the committed generator from this candidate checkout, pointing it at a clean
checkout/worktree of the pinned base. It creates and removes only its own temporary
chain fixture; it reads the repository snapshot without running its code:

```sh
node scripts/bounded-context-fixture-v1.mjs --repository /absolute/path/to/pinned-base
```

The script checks the repository HEAD and tracked/untracked worktree cleanliness.
Use a fresh worktree with no extra ignored inputs for the repository measurement.
The version-1 chain's input manifest SHA256 is
`ba667fedf7c55041a1b99e3957ed6838e8703ce14cbb5317f97740c17bb494ae`;
it hashes ordered relative paths, UTF-8 byte counts and per-file SHA256 values.
No private audit script or downloaded corpus is needed.

Measured on macOS / Node.js 22.23.4. Counts below use compact JSON without a newline;
absolute root paths are part of the response, so path length can change the exact
byte count. The acceptance limits remain fixed.

| Input / selector | Legacy full bytes | Agent bytes | Budget | Analysis status |
|---|---:|---:|---:|---|
| Generated 1,000-file chain / `src/m10.mjs` | 1,419,795 | 8,820 | 10,000 | `current` |
| Clean `e20f43e` repository / `server.mjs` | 226,375 | 16,633 | 20,000 | `partial` |

Chain revision: `e14be9e00b36f28c287d13ac62eb0a684ac4835407fb83eca88c3f56ffe9488e`.
Repository revision: `b51f8ae6d810ce38c6fa580d2f4060579bcd24fec191707313d68c5925bb1efc`.
The repository's existing oversized wordmark remains an explicit partial condition;
R02 neither removes it nor bypasses preflight.

## Validation

- Full local `npm test`: 336/336 passed, no skipped or cancelled tests.
- Eight bounded-context tests cover the independently captured pre-change legacy
  serialization oracle, generator identity/10 kB target, high fan-in and Unicode,
  every explicit section, duplicate nested evidence, complete fragment reconstruction,
  per-kind omission counts, invalid/stale/cross-selection/cross-binding cursors,
  projection drift at the same source revision, fresh-context revision checks and
  response-budget boundaries.
- The legacy oracle fixes only project identity and generation time on a two-file
  fixture: 11,735 compact UTF-8 bytes, SHA256
  `fa0cff4212650484a2e038cef779ad76f13626d9cdd10e94d9deddd6396e5e96`.
  It was captured from the clean pre-R02 base, before changing the serializer.
- `npm run package` passed with 47 payload files and unchanged schema 1.
  All 11 `scripts/smoke-release.mjs` groups passed against that actual bundle,
  including the unchanged installed context/preflight and loopback APIs.
- Candidate artifact digest:
  `83b23d7fe21e6abae747b286d84bb6f40ecf741a8403d9be41c273d1d75bd2f9`.
  Candidate archive SHA256:
  `8c12ef49bfe63c463f27deab0148e9d6e54ec163903d7cca4ee59944dae56ae5`.
  These identify local validation bytes, not published release pins.
- `git diff --check` passed. Fresh development context retains the existing partial
  wordmark warning. No UI/browser or real-target installation claim is made.

The initial independent review found two budget-boundary defects; both were
independently reproduced before repair. R02-01 rejected a terminal page that fit
because the precheck still reserved a continuation token. The precheck now tries
the complete terminal page or final suffix before returning a budget error.
R02-02 searched arbitrary UTF-16 prefixes: a split surrogate is six escaped UTF-8
bytes while its complete emoji is four, violating binary-search monotonicity.
The search now uses only code-point boundaries. Dedicated regressions check exact
terminal-page budgets, final suffixes and minimal astral-fragment progress.
All 336 tests, both measurement targets and actual-bundle smoke passed after repair.

Exact independent review disposition and Linux/Node 22/24 CI belong to the pull
request; local test completion does not establish either. Read-only review is a
procedural restriction, not proof of an independently enforced read-only sandbox.

## Delivery boundary and rollback

R02 does not expose the profile through the installed CLI, alter preflight receipts,
change managed instructions, or weaken the existing gate. Those changes belong to
R03 or separately approved work. No parser, resolver, UI, dependency, version or
artifact-schema change is part of this repair.

Revert the bounded R02 source commits to remove the opt-in projection. No stored
project data is migrated. The owner approved merging PR #21; release and target
upgrades remain separate owner actions. Tests use disposable fixtures and loopback only.
