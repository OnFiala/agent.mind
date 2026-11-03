# Python identity repair and optional UI reconciliation plan

Dated evaluation: **2026-11-03**. Source baseline:
`56d6c3360b66cb2ec6661df1f11ef3fe47923a84`, published
[v1.3.0](https://github.com/OnFiala/agent.mind/releases/tag/v1.3.0), following
[PR #16](https://github.com/OnFiala/agent.mind/pull/16).
[ROADMAP](../../ROADMAP.md) is the sole live priority/status tracker. This document
owns the dated evidence, proposed contract, decisions and acceptance plan.

The present change is documentation only. Implementation approval is **PENDING**;
no proposed repair, regression test, refactor, package or target update is implemented
by this plan. Existing release checks are baseline evidence, not repair acceptance.

## Evaluation and decisions for the owner

| Decision | Recommendation | Boundary |
|---|---|---|
| PY-IDENTITY-01 | Approve one bounded Python correctness repair after confirming the cases below | Same-file binding identity and effective simple private import-module lookup; preserve raw source evidence and current support limits. |
| UI-RECONCILE-01 | Optional, separate approval after the Python repair; may be deferred | Small internal reconciliation extraction only if ownership becomes clearer and behavior can be preserved. No defect or speedup asserted. |
| Installer split | Defer | No demonstrated correctness or operational benefit warrants adding it to this repair. |

The Python repair has a concrete correctness motivation. The optional UI work has
a maintainability motivation and must stand on its own review and acceptance.
Neither requires a framework, new service, parser, dependency, background task or
expanded language/runtime support. No release number or delivery deadline is chosen.

## Finding evidence and uncertainty

| ID | Dated disposition | Evidence boundary |
|---|---|---|
| AUD3-CODE-01 | Confirmed P2 at `56d6c33` | NFKC-only binding keys can select an unrelated raw module binding or miss an effective private binding. Actual adapter probes and independent compiler operands confirm the discrepancy below. |
| PY-IDENTITY-01 | Proposed repair scope, not an implemented fix | Same-file bindings and simple private module identities need one coherent repair; resolved and unresolved target probes confirm the index consequences. Preserve the distinct simple/dotted rules below. |
| UI-RECONCILE-01 | Optional maintainability proposal, independently assessed | The bounded seam is `public/visualizer.js:971–975`; the raw prior selected file node is captured at line 853 before navigation restoration at line 860. Navigation invalidation at line 865 and filtered overview edge validation remain distinct responsibilities. No production UI failure is established here. |

Relevant source ownership is already established: `python-analysis.mjs` owns the
pure text analysis and same-file binding decisions; `code-index.mjs` owns indexed
source-module resolution; `public/visualizer.js` owns presentation and source-view
reconciliation. The naming map is not dependency evidence. Relevant baseline locations are `python-analysis.mjs:12,121–158,179–224,275–297`
for binding and lexical contexts; import identity flows from lines 138–158 through
`code-index.mjs:205–276,374–384`. Unsupported forms remain explicit rather than
receiving invented edges.


On 2026-11-03, independent verification ran the actual adapter on **26 authored
snippets with Node 22.23.4** and independently derived operands for the same 26
with **CPython 3.14.3 `compile`/`symtable`/`dis` only**. All snippets compiled; no
scanned Python was executed. Existing **51 binding tests passed**, exposing a
coverage gap rather than proving this repair. No full suite, package, browser or
performance acceptance was run for this evaluation.

Minimal confirmed false target:

```python
def __target(): pass
def _Box__target(): pass
class Box:
    def caller(self):
        __target()
```

The adapter links `Box.caller` to raw `__target`; the compiler operand is
`LOAD_GLOBAL _Box__target`.

| Confirmed case family | Oracle/result boundary |
|---|---|
| Reads, parameters, locals, function declarations, import aliases, `global`/`nonlocal`, member mutation | Effective private identity is needed consistently; correcting calls alone is insufficient. |
| Simple `import __mod`; dotted `import __mod.child`; private alias | Simple module operand is `_Box__mod`; dotted module stays `__mod.child` while its local binder is `_Box__mod`; alias `__alias` binds `_Box__alias`. |
| `from __pkg import __member`; relative/dotted controls | Module/member operands are `_Box__pkg` / `_Box__member`; relative level is unchanged; `pkg.__mod` stays dotted/raw. This does not authorize member-file guessing. |
| Unicode/nested/control classes | NFKC class `K` gives `_K`; `Outer.__Inner` body uses `_Inner`; an all-underscore class disables inherited mangling; module-level and trailing-dunder controls stay unchanged. |
| Generic class headers | A non-type-parameter `__target` base uses raw `LOAD_FROM_DICT_OR_GLOBALS`; `Generic[__T](__T())` uses `_Generic__T`. Keep uncertain base/keyword calls unresolved. |
| Two private imports, resolved and unresolved | `class A` / `class B` simple imports compile to `_A__dep` / `_B__dep`; v1.3.0 collapses both to `file:__dep.py`, or `external:python:__dep` when no modules exist. Correct these derived targets while preserving raw evidence. |

The import probes indexed `__dep.py`, `_A__dep.py` and `_B__dep.py` for the resolved
case, and no candidate modules for the unresolved case. Long implementation-defined
mangled-name behavior was not tested; do not guess truncation. Python 3.14 docs
(current patch 3.14.10 at evaluation) and the 3.14.3 oracle are distinct evidence;
these probes do not establish semantics for every interpreter/version.

## Proposed Python contract

1. Carry immutable lexical class-private context independently from lookup scope.
   Method/function lookup may skip a class namespace while private spelling still
   belongs to that lexical class. Nested class headers and bodies need separate
   contexts; do not infer this from whichever scope happens to resolve a name.
2. Normalize each relevant identifier token with NFKC, then apply the private-name
   transform once for that occurrence. Use effective keys consistently for
   declarations, parameters, bare reads/calls, writes/mutations, `global`/`nonlocal`
   and import aliases within the supported model. Cover class names with leading
   underscores, all-underscore class names, dunder exclusions and nested contexts.
3. Preserve raw declaration names, source file/symbol IDs, UTF-16 ranges, source
   hashes, source spelling and evidence. Effective lookup identity is additional internal
   analysis data, not a display rename or filesystem rewrite. Correct derived
   import/external target IDs where needed: previously merged private imports may
   split into distinct effective module identities. The existing external target
   namespace remains `external:python:<effective module>`. A transformed token
   must not be transformed again in another lookup scope.
4. Keep the raw import module separate from its effective lookup token. Confirm
   compiler operands for simple private `import` and `from` module forms, aliases
   and dotted controls before choosing the data field and resolver rule. Resolve
   only indexed modules within the existing root/regular-package contract. Never
   guess a `from package import member` member-file edge. If an optional effective
   field such as `lookupModule` is used, absence preserves legacy raw → NFKC lookup;
   presence requires a string and the same segment/path validation. An invalid
   present value must not silently fall back to the raw module. Apply effective
   identity to both resolved file edges and unresolved external target IDs.
5. Generic class header cases whose private/type-parameter semantics are outside
   this bounded model must stay explicitly unresolved with honest diagnostics.
   Do not add an annotation engine, execute scanned Python, or reinstate a blanket
   unknown-Python/partial state for otherwise supported input.

Keep the change inside existing analyzer/index boundaries. Before coding, obtain
fresh graph context for the affected entry points, read their source and define
oracle-derived expected identities. The oracle is a development/review aid using
authored snippets with `compile`, `symtable` and `dis`; it does not execute scanned
source and adds no Python production dependency. Retain the oracle version in
implementation evidence and consult the [Python 3.14 private-name specification](https://docs.python.org/3.14/reference/expressions.html#private-name-mangling),
rather than an unversioned documentation target.

## Acceptance after implementation approval

Use existing tests rather than copying the same corpus into every layer:

- `test/python-bindings.test.mjs`: meaningful private-name positive and negative
  cases for reads, binders, writes, parameters, closures, class boundaries,
  outer headers/inner bodies, `global`/`nonlocal`, aliases, NFKC and dunder controls.
  Assert complete target/evidence vectors and absent false edges, including stable
  raw source file/symbol IDs and ranges; counts alone are insufficient.
- `test/code-index.test.mjs`: focused simple private-module identity cases with
  both raw and effective candidate files, dotted controls and unresolved/ambiguous
  paths. Cover resolved and unresolved targets separately: two classes importing
  raw `__dep` must distinguish `_A__dep` and `_B__dep`, including when neither
  module exists. Preserve current relative-root and namespace boundaries. Use existing
  Python analysis tests only where diagnostics/provenance need distinct coverage.
- One existing actual-bundle Python scenario in `scripts/smoke-release.mjs`:
  demonstrate corrected target/evidence and current context/preflight, rejected
  stale receipts, unchanged binding and preserved source. Do not duplicate the
  full unit corpus in packaging or every layer.
- Run narrow tests while editing. On the final candidate run `npm test`,
  `npm run package` and smoke against the produced bundle, then applicable existing
  Node 22/24 CI and the four retained upgrade/rollback paths. Bind results to exact
  source head and artifact digests; 1.3.0's 273-test baseline is not a required new count.
  Keep the Lezer producer version unchanged when the parser is unchanged; no new
  cache/version mechanism is required by this proposal.
  Keep binding identities and explicit target-upgrade behavior unchanged.
- Compare base/candidate on fixed authored and existing pinned corpus inputs in
  the same environment. Check cold/unchanged/update/live behavior and memory for
  sustained growth beyond noise in this short paired comparison. No general CPU
  benchmark or unrelated JavaScript stress matrix is required. Existing millisecond
  observations are not an SLA; an external deadline is only a kill guard. Preserve
  full graph evidence, honest uncertainty, no false edges and unmodified target source.
- Obtain an independent exact-diff review and evidence validation. Record reviewed
  head, actual checks and disposition in the implementation PR; review material
  follow-up changes as deltas. Pending checks keep the PR pending.

For optional UI work, extract one pure function inside `public/visualizer.js`:
`reconcileSelection(selection, previousSelected, graph, display)`. Pass the selection
to reconcile, the raw prior selected file node (`previousSelected` captured before
snapshot restoration), the incoming graph/index and its display projection. Return
the reconciled selection and whether this reconciliation requires source invalidation.
Keep the existing order: existence/edge validation → `refreshSymbolSelection` →
file-hash comparison. The helper must not mutate inputs; for a no-op it may retain
the original selection, while a changed symbol range returns a new object. Preserve
explicit aliasing and snapshot-copy behavior: `showSourceLine` later mutates the
active selection. Keep I/O, DOM, global state and navigation snapshot mutation
outside the helper.

Preserve source IDs, selection, camera, manual positions, breadcrumbs, area
expansion and current-source freshness. Navigation-triggered invalidation remains
outside and composes with the helper result: scope A → B with an identical file
hash must not cancel an existing invalidation. Preserve the existing display →
partEdges → raw graph → filtered overview lookup. The overview fallback requires
both overview endpoints to survive (`public/visualizer.js:60–61,84–85`); do not apply
that endpoint filter to the earlier lookup branches.

Extend existing focused UI tests only for the isolated contract. One small
deterministic disposable browser harness can cover late A-after-B success/error,
removed panels, Back/manual cursor/symbol movement, removed-scope fallback and
late graph refetch versus SSE. Reuse existing checks where behavior is unchanged;
no dense/viewport matrix is required without a new concern. Preserve existing
client epoch/DOM/path/line/hash checks and graph fetch sequence/version/runtime
instance checks; binding validation stays at the existing server/SSE boundary,
without a new client binding guard. Source-only planning is not browser acceptance,
and no performance gain is claimed without paired measurement.

## Delivery, tracking and rollback

The integrating agent owns documentation consistency. The implementation owner
updates the ROADMAP row at approval and implementation; the independent reviewer
supplies exact-head validation before verified status. After separately authorized
merge/publication, the integrating agent records the actual PR/commit/release
receipt and updates README capability wording and the release record. Preserve
this dated proposal as history, adding an acceptance addendum when decisions or
results change rather than silently converting planned checks into passed checks.
No recurring automation or extra tracker service is implied.

Deliver Python code and its focused tests in one reviewable repair PR with atomic
commits. Optional UI work has a separate commit/PR and acceptance; installer changes
are excluded. Keep private workspaces, logs, local evidence paths and private memory
identifiers outside public-intended documentation and payloads. Do not alter the
published v1.3.0 tag/assets or upgrade a real target during implementation review.

Source rollback reverts the bounded Python repair and updates the ROADMAP and
capability limits; this restores the private-name P2 behavior and must be reported.
Revert optional UI work independently to restore prior presentation ownership.
Source rollback does not change installed targets. If a later authorized release
needs installed rollback, use its verified pinned predecessor through the existing
conflict-preserving CLI procedure and retain owner maps/recovery; no purge is implied.
