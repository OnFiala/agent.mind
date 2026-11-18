# R13 — bounded typed reference syntax

Date: 2026-11-17. Status: **implementation candidate; unreleased**.
The owner authorized this separate R13 implementation after P1, with prior-work
review, tests, documentation and independent review of the final diff. The PR owns
exact reviewed commits, disposition and CI receipts. Merge, release, real-target
upgrades and R14–R16 remain separate actions.

## Plan adherence and prior work

P1 is merged as `c80b8aa6a07c9cdbd6930af8114f78d9f7baca2d`, preserving the reviewed
tree `c7aacd0c527549eb7508473effd44af48c77c327`. [PR #37](https://github.com/OnFiala/agent.mind/pull/37)
and [actual post-merge CI](https://github.com/OnFiala/agent.mind/actions/runs/44128899552)
confirm its delivery. Independent precheck inspected that diff, the accepted bounded
P1/R13 design and R12 evaluation. It found no product-scope deviation blocking R13.
It found stale roadmap/P1 status text; this PR reconciles that text with actual
P1 delivery and the owner's later R13 authorization.

R12's private evaluation completed without demonstrated workflow benefit. It does
not justify changing the full-context default or implementing R16. Its documented
typed syntax demand supported this separate stage. Some historical raw evidence
is currently unavailable locally; this is not a fresh validation of those runs.
This PR uses new synthetic fixtures and publishes no private corpus or grades.
R14 will require an available, independently verified corpus and resolver contract.

## Behavior and ownership

`typed-analysis.mjs` reuses the unchanged pinned Babel AST/options. A separate pure
walk collects top-level literal imports and source-bearing named/star/namespace
reexports. Facts preserve decoded specifiers, whole/per-binding type-only syntax,
nullable AST names, exact raw UTF-16 ranges/locations, original-byte SHA256 and
parser provenance. They create no new global IDs or symbol binding claims.

Dynamic import, import-equals, import-type queries, syntactic bare require,
nested/ambient references and attributes have target-free unsupported occurrences
when encountered. Nonparseable dialects have parse failure without recovery facts.
Comments/strings are not occurrences. The attribute check reads only trivia after
the AST literal, including the empty `with {}` case which Babel represents with
an empty attributes array.

The independent reference walk is capped at 100,000 nodes, depth 256, 2,000 combined
supported/unsupported occurrences and 8,000 bindings. Limit checks precede insertion.
Any reference cap withholds the entire reference result with machine-readable
`TYPED_REFERENCE_LIMIT` and reason. Declaration limits retain their previous
behavior independently. Parse/65,536-byte failure withholds both. At most 200,000
visits span both walks; these bounds are not timeouts or performance guarantees.

`code-index.mjs` deep-clones the `typed-reference-syntax-v1` envelope onto typed
file nodes and intercepts facts before the generic resolver. Resolution remains
`unsupported/typed-resolution-not-enabled`. Only `static-reference-syntax` is added;
no file, external-module, Security or call edges are derived. Non-typed nodes have
no envelope. Existing IDs, generic resolution, policies and strict gate remain.
Every typed file is partial, even a completed pass with zero facts.

Existing full/bounded context and live snapshots transport the file node. No new
transport, persistent state, target setting, dependency, parser option or resolver
was introduced. The inspector displays escaped facts, exact provenance and explicit
limits in pages of 40 occurrences, with existing hash-bound source navigation.

## Acceptance and limitations

All fixtures are synthetic and disposable. Scanned source is never executed.

| Plan cases | Evidence |
|---|---|
| T01–T08 | 26 analyzer tests: independent expected syntax/evidence, type-only rules, raw UTF-16/CRLF/Unicode/escapes, unsupported forms/attributes, exact byte/symbol/node/depth/occurrence/binding boundaries and failure independence |
| T09 | Typed-to-JS, JS-to-typed, typed-to-typed, bare/core, extensionless/index/alias and boundary-escape inputs retain zero new graph/external/Security/call edges |
| T10 | Complete 7-file JS graph and full context differential against exact P1 payload; includes existing import/call/Security/HTTP/SSE facts. Only volatile generation/timing/cache-count fields normalized. Typed symbol graph/IDs and all edges remain identical |
| T11 | Cold/warm equality, nested cache poisoning, source edit/line move/deletion, policy exclusion/recovery and stale source/context cursor rejection |
| T12 | Large node reconstructed losslessly from bounded fragments; byte budgets, omission counts and surrogate boundaries checked; full/live/withheld/empty representations agree |
| T13 | Inspector unit tests and real Chrome acceptance: escaped source/binding strings, occurrence pagination, empty/withheld states, stable selection/camera, rejection of late source response and no dependency presentation |
| T14–T15 | Installed CLI and P1-to-R13-to-P1 rollback smoke: exact binding/digest, partial strict refusal, source/cursor receipts, owner map/data custody, conflict recovery and retained P1 policy v2 |

Local `npm test` passed **476/476** with zero failed/skipped tests. The later
presentation-only provenance and binding-wrap corrections each passed all **59**
affected UI tests.
The initial real-browser check caught `producer [object Object]`; rendering and
its test now use the actual structured producer, verified again in Chrome.
Visible screenshot inspection also found clipped long binding text; a dedicated
wrapping rule fixes that without changing the surrounding layout.
The first integration tests assumed a node was on the initial bounded page; that
fixture assumption was corrected, with all 16 affected typed/integration tests passing.
The analyzer test contract failed before implementation and passed unchanged after it.

Package, installed smoke, final browser parity, exact-diff independent review and
remote CI are recorded in the PR as they complete. This document alone is not a
release or readiness claim. The self-source graph remains partial because an
existing wordmark exceeds the inventory file budget; input policy is valid.
No real project installation, host-instruction activation, remote service behavior,
consumer benefit or throughput improvement is claimed. Independent review's
read-only scope is procedural under the inherited broader permissions; technical
least-privilege enforcement is not established.

## Candidate identity and rollback

The final local candidate retains development version 1.4.0, but differs from both
the published archive and P1. It must not be presented as either released payload.

- R13 manifest digest: `ad68027479f60777e85059d1d7c75630960ea9f8eb639c207ee5c22625acd25a`.
- R13 archive SHA256: `318c2c0e186a42f9ba4eecb448f56cc214ec6b519e209099c7f1c62320fc17a0`.
- P1 baseline digest: `63dcffc91f79a788dab8a933c3a8e778e4370cab3968d2da8580a6ff018bbf93`.

An authorized code revert removes the extraction/envelope/capability and inspector,
returns to declaration-only limitations and starts fresh runtime caches. A separately
authorized installed rollback uses the exact verified P1 artifact: source/binding/
cursor receipts from R13 become stale, owner names/maps/project bytes survive, and
P1's `root-ignore-v2` remains. Downgrading all the way to published 1.4.0 also removes
P1; its v1 policy rejects positive-set rules. Never rewrite owner ignore files to
conceal that difference or overwrite modified managed files to force rollback.
