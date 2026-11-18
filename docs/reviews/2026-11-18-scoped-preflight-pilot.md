# R15 — explicit scoped preflight pilot

Status: owner-authorized implementation candidate, 2026-11-18. Base is merged R14
`07dd8a39d867cb3302b29ffeae5af3e20994491b`, tree
`bb1bf14fbcde1ea2fb08dabe1d0789ee3cb424ab`. This is unreleased source.
The owner approved the bounded pilot and a separate PR; merge, publication and
real-target changes remain separate actions. [R11](2026-11-16-r11-scoped-preflight.md)
owns the accepted operation promises and T01–T24. This record owns implementation
boundaries and verification mapping, not a second truth table.

## Behavior and ownership

`inspect-selected-source@1` checks complete bounded UTF-8 text for every owning file
in one exact file/block/symbol selection. Incoming/outgoing analysis is not required.
`review-direct-file-boundary@1` additionally requires the shipped
`typed-static-local-v1@1` model and explicit R14 resolver/config pair. Both preserve
the original global `current/partial`; neither grants edit authority or claims
test results, runtime behavior, application completeness or a filesystem lock.

The model covers the existing R13 static import/reexport occurrences, including
type-only forms, with R14 local resolution. Its origin universe is every admitted
file and unknown traversal boundary, including outside the config's parent.
JS, Python, HTML, CSS, Markdown, other unsupported formats and missing/withheld
observations remain potential origins. A positive typed observation requires the
actual complete bounded AST walk; a parse success, capability label or empty
outcome list is insufficient. Dynamic/import-equals/import-type/require forms and
unrecognized AST forms are explicit unknowns. No new resolver, alias, package,
cross-language or runtime inference is added.

Strict JSON non-origin evidence comes from checked content, rejects duplicate
decoded keys and malformed/BOM content, and examines resolution-control keys.
Selected files, required targets and unrecognized controls do not inherit the
non-origin exemption. Only the selected validated resolver config or validated
naming map may be known controls. The implementation currently emits no exhaustive
finite endpoint proofs; R14 candidate lists alone never discharge uncertainty.
The pure evaluator tests the R11 disjoint-proof contract separately.

| Owner | Responsibility |
|---|---|
| `code-index.mjs` and existing pure adapters | One checked inventory/graph, actual analysis observations and safe reads |
| `scoped-coverage.mjs` | Internal WeakMap observations, structured diagnostic provenance, typed AST/JSON evidence; no I/O |
| `scoped-preflight.mjs` | Finite descriptors and deterministic full-evidence evaluator; no I/O |
| `scoped-context.mjs` | Shared fresh source projection, full-file selection, identity checks, evidence pages and bounded receipt projection |
| `installation.mjs` | Attached root/binding and full runtime integrity before/after scoped reads; explicit commands |
| `server.mjs` | Read-only same-origin loopback route over the same builder |
| `public/visualizer.js` | Three-phase request, presentation, detail reconstruction and revocation |

Coverage metadata is opt-in and does not enter legacy graph/node payloads.
The same runtime yields identical legacy serialization/revision with and without
the internal coverage option, except existing timestamp/timing/cache metrics.
A changed implementation intentionally changes the R14 runtime pin and derived
identities; cross-version regression comparisons normalize only those identities
and existing nondeterministic metrics, never evidence semantics.

## Protocol and budgets

The original R02 agent context is phase zero. `scoped-context` first requires its
revision/snapshot, explicit operation, selector, schema 1 and installed
binding ID/generation. It returns a distinct scoped snapshot and requirements digest.
This is preparation, not a receipt or sufficient-at-read result.
Continuation and `scoped-preflight` require both original and scoped identities.
Changes reject rather than silently substituting fresh identity. Unknown, duplicate,
missing and cross-phase parameters fail.

The shared builder obtains agreeing fresh scans, checks exact selected reads,
checks a final scan and revalidates root/runtime/binding. A change after its last
check remains an explicit TOCTOU window. HTTP bootstrap uses this same source
projection rather than transient LiveIndex fields. Development output is
`scoped-preview` / `unbound-preview`, never an installed receipt.

The evaluator receives full evidence before pagination. Wire receipts retain the
complete decision, obligations, all reason codes/counts, global status and claims.
Large diagnostics, inventory, origin results and individual reason details use
counts/digests and revision-bound retrieval references. Selection and selected-text
details may also be referenced if the complete mandatory envelope otherwise cannot
fit. A list is never silently truncated and labeled complete. Pages use a distinct
`scoped-evidence` cursor namespace; UTF-16 fragments reconstruct canonical JSON
without splitting surrogate pairs. Mandatory-envelope overflow returns a versioned
error, never success.

| Limit | Bound |
|---|---:|
| Origins / reference observations / decision work | 10,000 / 100,000 / 200,000 |
| Complete scoped evidence | 16 MiB |
| JSON classification depth / values | 256 / 100,000 |
| Default / maximum wire budget | 32 KiB / 1 MiB |
| Minimum requested wire budget / cursor | 256 B / 4096 characters |

Existing index/parser/resolver limits stay unchanged. These counts are not latency
or memory guarantees. Source, policy and naming-map reads in scoped mode require
resident files and never request cloud hydration.

Only a sufficient-at-read scoped preflight has exit 0; preparation/evidence exit 0
means transport success. Negative decisions retain the same conceptual claims
envelope. Protocol/budget failures before an envelope use a versioned error.
Legacy context/preflight, the R03 receipt and managed strict instructions remain.

The UI shows global status alongside the named operation result, obligations,
reason counts and explicit nonclaims. A separate action retrieves all reason
details with complete identity, ordering, byte-bound and SHA-256 checks. Loaded
detail is not a claim that an agent completed a review. Selection/identity changes,
SSE loss and hidden tabs revoke the result. Reconnection requires a fresh user
action; delayed responses cannot restore an earlier verdict. Camera/layers/filters
are presentation only.

## Verification mapping

All runtime checks use disposable synthetic fixtures or authorized resident,
immutable corpus reads. Scanned target code and package scripts are never executed.
Private corpus/source, oracle files and local discovery reports are excluded from
Git and package payloads.

| Acceptance | Executable evidence |
|---|---|
| T01–T24 complete decision/obligation/reason table | `test/r15-evaluator.test.mjs` literal expectations independent of production descriptors |
| V01/V02 empty outcomes, unknown syntax, withheld pass, producer/category failures | Evaluator + `test/r15-coverage.test.mjs` |
| V03/V04 entire admitted universe, unsupported/bare/external traps | Coverage + `test/r15-protocol.test.mjs` |
| Inventory/read/parser/JSON/work budgets and forbidden source opens | Coverage tests and retained R13/R14 negative controls |
| V05 exact file/block/symbol selection, owning files and area rejection | Protocol tests |
| V06/V13 identity, bootstrap, two snapshots, bad parameters/cursors | Protocol + `test/r15-installed.test.mjs` |
| T22/T23/T24 full pages/fragments, cross-context rejection and output bounds | Protocol + UI loader tests |
| V07 legacy graph, strict refusal, instruction and artifact compatibility | Coverage + installed + existing regression suites; exact R14 rollback harness |
| V08 actual UI behavior and CLI/HTTP parity | `test/r15-ui.test.mjs`, installed tests; exact-bundle browser evidence recorded in PR |
| V09 lifecycle/runtime integrity/custody/rollback | Installed tests + `scripts/smoke-scoped-rollback.mjs` |
| V10 full tests, package/smoke, historical rollback, Node 22/24 | CI plus exact candidate local checks |
| V11 original finite corpus | Private preregistered 8 selections × 2 operations, both directions, unchanged 118-file hashes and all 63 facts / 50 resolved + 13 unsupported outcomes |
| V12 promises and nonclaims | Evaluator, protocol, UI and corpus receipts |

G0 froze descriptors, limits, protocol, baseline artifact and literal oracle before
product edits. One independently noticed oracle correction split T13's unread
versus readable-invalid JSON nonblocking reason; original freeze is retained,
decisions and obligations unchanged, and no candidate output informed the correction.
A corpus verification initially hit mandatory wire overflow: the complete evaluator
decision was larger than the maximum wire budget. The repair added the above
bounded receipt projection and full detail retrieval, without changing limits or
the evaluator result.

The PR owns exact commits, test counts, browser receipts, independent findings and
their disposition. Until those checks and review are complete, this is a pending
candidate. Synthetic boundary success does not establish usefulness on mixed
projects: even a normal admitted AGENTS.md is an unsupported origin in this model.
No R12 workflow benefit or R16/MCP readiness is claimed.

## Rollback

Functional rollback omits the new explicit commands; legacy strict behavior remains.
Source rollback reverts only R15 on top of R14. Artifact rollback uses the exact
unreleased R14 payload digest
`378643335eaa3e10f2a5a809f1960cdee82a2d8f673a632a24669d0e0f01576c`
built from the pinned base, not the published 1.4.0 archive.
The disposable harness uses each installed artifact's own CLI, preserves owner
source/AGENTS/map/data and modified owned files, parks retained integration data,
and rejects old scoped identities after returning to R14. No physical or real
installation rollback is authorized by this record.
