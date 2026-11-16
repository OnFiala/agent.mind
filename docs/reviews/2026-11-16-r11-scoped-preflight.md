# R11: accepted scoped-preflight contract

Date: 2026-11-16. Source baseline: `7bf24e919edecb70fa377dc1ad9499502f4bc19b`.
Status: **owner-accepted design; no implementation or change to the existing gate**.
The owner accepted this contract and authorized the merge of
[PR #36](https://github.com/OnFiala/agent.mind/pull/36), subsequent merge-commit CI
verification, documentation and project memory updates on 2026-11-16.
This approval does not authorize R15, a release, host registration or changes to
installed targets. [ROADMAP](../../ROADMAP.md#r11--scoped-preflight-design) owns the
current disposition; PR #36 records exact review, actual merge and CI receipts.
Authorization alone is not evidence that the merge or its CI has completed.

R11 separates freshness, inventory coverage, completed per-file analysis and
sufficiency for one named operation. It does not make `partial` mean `current`.
All normative requirements below define the accepted future opt-in contract.
None of the proposed request fields, operation IDs or receipts is available in 1.4.0.

## 1. Current evidence and the problem

At the pinned baseline:

| Owner / source | Observed behavior |
|---|---|
| [installation.mjs](../../installation.mjs), context/preflight dispatch, lines 613–650 | Both legacy and R03 agent-profile preflight require global `context.status === 'current'`, exact revision and binding ID/generation. R03 emits `receipt: 'preflight'` only after those checks. |
| [graph-context.mjs](../../graph-context.mjs), `freshContext`, lines 200–215 | Two scans must agree. Expected revision is checked; installed callers validate binding. Equal revisions do not prove facts about unread/excluded bytes. |
| [graph-context.mjs](../../graph-context.mjs), selection and agent projection | Selected file edges are already known incident edges. Projection retains global uncertainty and exposes revision/snapshot-bound continuations. Filtering known edges cannot discover an unparsed incoming importer. |
| [code-index.mjs](../../code-index.mjs), capabilities, inventory, resolver and final status | Capability names advertise operations, not successful analysis. Inventory completeness and global status differ; any warning/error makes status partial. Excluded subtrees are not inspected; unseen/omitted source remains unknown. |
| [source-analysis.mjs](../../source-analysis.mjs), computed dynamic import | A computed import produces an informational diagnostic, not a resolved edge. Global `current` can coexist with this uncertainty. |
| [typed-analysis.mjs](../../typed-analysis.mjs) | Typed files are declaration-only, with no reference analysis and an explicit warning. Python external/unresolved imports also cannot be treated as proof of external-only targets. |
| [live-index.mjs](../../live-index.mjs) and `readIndexedSource` in code-index | A cached graph may be stale; policy changes revoke old projections. Source reads separately recheck policy, path safety and indexed hashes. |

The [R02 contract](2026-11-11-bounded-context.md), [R03 receipt](2026-11-11-cli-profile-receipt.md)
and [R05 policy](2026-11-15-input-policy.md), implemented by
[R06](2026-11-15-project-exclusions.md), remain authoritative in their current scope.
Their historical status paragraphs are dated records; the current baseline is 1.4.0.

A selected-only warning filter would be unsound: an unreadable or unparsed file
outside the selection can import the selected file without producing an edge.
Conversely, reading one admitted file's exact text does not require proving every
other file's language semantics. These are different operations, not different
tolerances for the same promise.

## 2. Invariants and compatibility

- Legacy preflight, its exit behavior, `current`/`partial` and R03 schema 1 remain
  unchanged. `--profile agent` selects a projection, not a weaker gate.
- A future scoped request must explicitly select a contract version and a named
  operation. No retry/fallback from strict failure to a weaker operation, no generic
  `allow-partial`, warning suppression, caller-defined capability checklist or
  environment/managed-instruction opt-out.
- The receipt certifies observations at read time, not permission to edit, an edit
  lock, safe refactoring, runtime behavior, complete dependencies, tests or security.
  A text-inspection success cannot satisfy a dependency-review or edit-safety task.
  Existing host permissions and human authorization remain independent.
- Keep one source-derived graph. Neither selection, naming metadata, an area,
  browser filter nor camera state establishes a dependency boundary.
- Preserve sensitive-name/hidden/path/symlink/integration exclusions, source-read
  revalidation, fixed budgets, descriptors, runtime pins, maps and bindings. Do not
  read an excluded file to prove it harmless. Do not automatically change ignore
  policy, increase limits or execute scanned code to obtain a positive receipt.
- No new daemon, registry service, dependency, database, model call or global
  configuration. A finite shipped operation table and bounded evidence are enough.
- Unknown evidence is never interpreted as false, empty or complete. An unknown
  diagnostic kind must not be scoped out by its text, severity or directory name.

## 3. Named operations and their promises

Proposed v1 has the two operation contracts below. A runtime exposes an operation
only after its evidence requirements and acceptance cases are implemented and
reviewed. A missing operation/model version rejects; it does not downgrade.

| Operation ID | Sufficient evidence means | Required coverage / excluded claims |
|---|---|---|
| `inspect-selected-source@1` | Every resolved selected source file is admitted, safely read as complete bounded UTF-8 text and bound to the checked hash/policy/revision. The returned selection is exact. | Text-read evidence for every selected file; no dependency, symbol-completeness, syntax-validity or edit-safety claim. Incoming/outgoing relations are explicitly `not-required`, never `complete`. |
| `review-direct-file-boundary@1` | All direct incoming/outgoing file-reference observations for the selected files are accounted for within one explicitly named, tested static-reference model and its admitted project domain. Every required uncertainty is either resolved or proven disjoint under that model. | Full origin coverage for possible incoming references, outgoing coverage for selected files, target resolution and evidence for the model's exact relation kinds. No transitive impact, imported calls, property access, framework/runtime loading, test-pass or whole-application completeness claim. |

A symbol or block selector expands to its full owning-file set. A symbol's lexical
subtree cannot hide imports elsewhere in that file. Empty, unknown, ambiguous,
withheld or presentation-only area selections reject. Expansion, paths and hashes
are pinned; a later rename, map change or membership change requires new context.

The boundary operation requires a versioned model descriptor: parser/adapter and
resolver versions, exact relation kinds, origin eligibility, resolution rules,
known unsupported constructs and the admitted-domain policy identity. The caller
chooses a shipped descriptor ID; it cannot edit these requirements. R11 does not
silently select a bundler/Node/Python mode or infer one from filenames. R13/R14 and
R15 must supply whatever coverage the chosen operation actually needs.

Intentional exclusions define an explicit domain boundary, not proof that excluded
code cannot import the selection. Every receipt retains those boundaries and says
that outside-domain relationships are unknown. If the requested claim is impact
across excluded files, external packages, runtime loaders or the whole application,
v1 cannot satisfy it. An inside-domain empty graph never means “no consumers”.
Changing policy creates a different domain and invalidates old receipts.

The present 1.4.0 graph is insufficient to certify the boundary operation: it lacks
an exhaustive per-origin reference-coverage/uncertainty ledger, and some unknowns
are only informational or not enumerated. In particular, neither a `static-references`
capability, zero warnings, an `external:` node nor global `current` supplies that
missing proof. R15 must reject unsupported evidence rather than bolt a warning
filter onto the existing projection. Text inspection is a narrower candidate;
R12 should assess whether it adds useful workflow value before prioritizing it.

## 4. Evidence evaluation and global blockers

The future evaluator consumes the complete checked source graph and coverage
evidence, before response pagination or presentation filtering:

1. Validate the request contract/operation/model and one exact selection.
2. Validate installed runtime integrity, descriptor/root ownership and current
   binding before/after the read; require the expected revision and valid policy.
   Development inspection must not fabricate an installed binding or be presented
   as an installed receipt.
3. Obtain agreeing bounded scans with current policy, then resolve and pin the full
   selection membership and all required file hashes. A cached/live snapshot alone
   cannot issue a receipt.
4. Evaluate each operation obligation as `satisfied`, `unknown`, `failed` or
   `not-required`. Missing records are unknown. Retain global coverage independently.
5. Classify every observed limitation as a global blocker, a required-evidence
   blocker, or non-blocking for this operation with a stable reason and supporting
   evidence. Unexpected/unclassified limitations block; never infer from severity.
6. Return `sufficient-at-read` only if all required obligations are satisfied and
   no blocker exists. Required unknowns return `insufficient-evidence`; failed
   identity/safety/request checks return `rejected`. Only sufficient-at-read may
   map to exit 0. Both other outcomes have explicit reason codes and nonzero exit.
7. Enforce the full receipt/projection byte budget. If mandatory identity, coverage,
   uncertainty and reasons cannot fit, return the existing explicit budget-error
   form or a versioned equivalent, never a truncated successful receipt.

Global blockers apply to both operations regardless of which file triggered them:
invalid/changed input policy; stale or mismatched root, runtime, binding, generation,
revision or snapshot; observed unstable scans; failed selection resolution;
unsafe selected path or missing selected bytes; invalid contract/model/request;
unclassified errors; insufficient mandatory-output budget. Do not downgrade these
to non-blocking because a file lies outside the selection.

Known parse/analysis limitations outside the requirements of text inspection can
be non-blocking with reason `analysis-not-required`. An unrelated unread/omitted
path can be non-blocking for text inspection only with reason
`outside-selected-text-read`; it remains unknown for dependency purposes. These
are not declarations that the file is harmless, unrelated to the application, or
safe to edit. Selected text can be inspected despite a parse error, but selecting
a symbol that the parser could not establish still rejects.

## 5. Incoming and outgoing uncertainty

For the boundary operation, evaluate the origin domain independently of known
edges. It includes all admitted files that the model identifies as possible
reference origins, plus unknown/unclassified admitted entries or traversal
boundaries that might conceal such origins. Checking only selected files or their
already discovered neighbors is forbidden.

A required ledger entry binds a source path/hash, completed parse/traversal
coverage, actual capability result, model identity, discovered references and
unresolved constructs. It must distinguish fixed external endpoints from unresolved
potentially local ones. “No warnings” is not a coverage record.

- An unparsed, unsupported, unreadable, oversized or omitted possible origin has
  unknown outgoing targets and therefore possible incoming relevance to selection.
- A dynamic/computed reference with no conservative bounded target set may reach
  any admitted local file. It blocks boundary review even when outside selection
  and even when the current diagnostic is informational.
- A required outgoing reference with unresolved/ambiguous/local-outside-scope target
  blocks. A Python “external/unresolved” result cannot be relabeled fixed external.
- A limitation may be disjoint only when current model-bound evidence proves its
  possible endpoints exclude the operation's selected boundary. Proximity, extension,
  label, lack of a known edge or a user assertion is not such evidence.
- A safely classified unrelated asset needs positive evidence accepted by the
  operation's model, a checked identity, and no required role as selected file,
  origin or target. The current binary/text encoding classifier is not a file-format
  parser. A large `.webp` skipped before content read is not automatically such
  an asset. The repository's oversized wordmark therefore receives no special waiver.
- File/byte/entry/depth/parser limits leave relevant unknowns; two scans agreeing
  on the same omission do not prove coverage. Unvisited descendants are unknown
  in number and type, not a count of zero.

No graph expansion is inferred by this contract. Future coverage work records
uncertainty honestly; unsupported cases may continue to reject.

## 6. Decision table

These are normative future cases, not executed tests. Each row assumes all other
requirements pass, a nonempty exact selection and a validated operation descriptor.
`S` = sufficient-at-read for the named promise only; `I` = insufficient-evidence;
`R` = rejected. “Boundary S” also requires the new coverage ledger; 1.4.0 alone
cannot produce it. Global status remains exactly what the existing index reports.

| ID | Observed case | Text inspection | Boundary review | Required explanation |
|---|---|---:|---:|---|
| T01 | All selected text and model coverage complete; no relevant unknown | S | S | Global status and admitted-domain limits still visible |
| T02 | Outside-selection possible importer fails to parse, no known edge to selection | S | I | No incoming absence inference; text says analysis-not-required |
| T03 | Computed import outside selection may target selected file; diagnostic is info | S | I | Severity/current is not relevance proof |
| T04 | Computed import in a selected file has unknown target | S | I | Outgoing uncertainty required |
| T05 | Observed source omitted by file or byte limit outside selection | S | I | Unknown origin; text does not certify dependencies |
| T06 | Entry/depth limit or unreadable directory leaves unseen admitted descendants | S | I | No complete origin universe or omitted-count claim |
| T07 | A selected file is unreadable, oversized, binary, excluded or no longer indexed | R | R | Required selected bytes unavailable; no extra reads/override |
| T08 | Unreadable possible source origin outside selection | S | I | Outside-selected-text-read; incoming unknown |
| T09 | Typed declaration-only or unsupported admitted file could import selection | S | I | Capability absent/incomplete despite named symbols |
| T10 | Selected source uses unsupported syntax/reference analysis but exact text is readable | S | I | Text claim only; if selector itself cannot resolve, R/R |
| T11 | Required unresolved relative import, ambiguous module or Python external/unresolved target | S | I | No fabricated external-only resolution |
| T12 | Outside-selected diagnostic is proven disjoint by current model-bound endpoint evidence | S | S | Preserve diagnostic and proof; no path/severity heuristic |
| T13 | Unrelated asset has positive model-valid classification and no required role | S | S | Preserve global partial if another existing check reports it |
| T14 | Large asset-looking file skipped before classification | S | I | Filename is not evidence; no wordmark-specific exception |
| T15 | Stale binding/generation/runtime, changed root or expected revision mismatch | R | R | No old receipt or cache fallback |
| T16 | Policy changed/invalid, even if selected bytes stayed identical | R | R | Revoke old evidence and source routes |
| T17 | Observed source drift between scans or before serialization | R | R | Retry from fresh context, never stale success |
| T18 | Excluded subtree could contain incoming source; requested claim stays explicitly inside admitted domain | S | S* | *Only with complete admitted-domain coverage; outside remains unknown, no whole-app claim |
| T19 | Caller requests impact/absence across excluded or external scope, transitive effects or execution | R | R | Unsupported operation/promise, not weaker fallback |
| T20 | Unknown diagnostic/coverage category cannot be classified | R | R | Fail closed; add a reviewed rule in future work |
| T21 | Empty/ambiguous/withheld/area selector or changed selection membership | R | R | Resolve exact source identity anew |
| T22 | R02 output omits evidence for transfer but full evaluator has it | S | S | Receipt records omissions and retrieval; consumer must fetch required detail |
| T23 | Consumer presents stale/cross-selection/cross-binding continuation | R | R | Refresh entire observation; do not splice revisions |
| T24 | Mandatory receipt cannot fit requested budget | R | R | Explicit budget error, no success by omission |

T22 is a server-side evidence decision, not proof that the consumer read the
evidence. A consumer with incomplete pages cannot claim completed review. T23
rejects the attempted stale continuation; a fresh, otherwise valid preflight can
be requested separately. No receipt tracks or proves what an agent actually read.

## 7. Proposed request and receipt boundary

Freeze semantics and versioning here; exact CLI flag spelling and an HTTP route,
if needed, belong to separately authorized R15. These are not runnable commands.
Keep the existing R02/R03 protocol unchanged. Proposed request identity comprises:
contract version; operation ID/version; shipped model ID/version where required;
selector; expected revision; binding ID/generation; and the R02 snapshot identity
of the context being relied upon. Reject omitted/unknown fields required by the
chosen operation, duplicate options, mismatched versions and unsupported models.

Use a distinct namespace: `receipt: 'scoped-preflight'`, `schemaVersion: 1`.
Never reuse legacy `receipt: 'preflight'`/`preflight: 'verified-at-read'` for the
new sufficiency claim. The mandatory conceptual envelope is:

- `operation`: exact ID/version and model identity/requirements digest.
- `project`, `revision`, `snapshot`, validated `binding`, runtime pin and
  input-policy ID/version/status. No fabricated binding for development mode.
- `selection`: canonical source ID, complete file membership identity and source
  hashes; original alias may be descriptive but is not authority.
- `globalStatus`: original current/partial; `freshness`: verified-at-read or the
  actual failure. Neither field is named or inferred as semantic completeness.
- `coverage`: global inventory status/state counts; selected text results;
  required per-file capability results; incoming/outgoing obligations and their
  satisfied/unknown/failed/not-required states; admitted-domain/excluded boundaries.
- `decision`: sufficient-at-read, insufficient-evidence or rejected; stable
  blocking reason codes/counts and non-blocking reasons with evidence references.
- `uncertainty`: unchanged global/local totals and limitations, plus operation
  relevance. `diagnostics`: complete revision-bound retrieval references, not
  silently discarded warnings. Never emit raw ignored-policy patterns or excluded bytes.
- `claims`: the exact bounded promise, explicit non-claims and
  `testResults: 'not-observed'`. Transfer omissions and consumer-read completion
  are not analysis coverage or test execution.

All identities cover policy, selection membership, source hashes, runtime/model/
operation semantics and complete decision evidence. Display names are not semantic
identity, but changed R02 snapshot contents must still reject an old continuation.
An evidence digest is not a signature, authorization token or filesystem lock.
If complete membership/evidence cannot fit, retain its counts/digest and versioned
retrieval references using R02's bounded reconstruction rules; never truncate a list
while reporting it complete.

## 8. Freshness, continuations and UI/CLI parity

A receipt expires for reuse when any bound identity changes, including a policy-only
edit, parser/resolver/runtime/operation change, binding rebind/detach/adoption,
source edit or membership change. Missing/unread source has no freshness proof.
Retain all R02 snapshot/selection/binding cursor checks and R06 invalidation.
Unrelated edits may invalidate the global revision; R11 proposes no incremental
per-selection revision or exemption.

Check required source/policy identity before serialization and revalidate on every
later source/page read. A change after the final successful check, including before serialization or
delivery, remains a TOCTOU window: the receipt does not guarantee future bytes or
block writes. No finite sequence of reads detects every concurrent edit. Stale UI/SSE state,
connection loss, background tabs and cached selection cannot issue or preserve a
green current-operation verdict; recompute through the shared evaluator.

A future CLI and UI consume the same versioned decision object for the same
operation/model/selection/revision. Layers, collapsed areas, hidden relations,
sorting and presentation filtering cannot change it. The UI must display original
global status alongside the named operation's result and show global blockers,
required unknowns, scoped non-blocking reasons and excluded-domain limits.
Do not show a lone green “safe to edit” badge. A source/development preview is
clearly unbound and cannot masquerade as an installed receipt.

Keep source indexing/coverage in code-index and pure adapters, selection/projection
in graph-context/shared hierarchy, binding validation in installation, and
presentation in the visualizer. One shared pure decision layer consumes explicit
evidence; transport wrappers perform their required live/binding checks. R15 chooses
its smallest maintainable file boundary after reviewing the exact implementation.
No second scan model, graph, truth table or browser-only bypass is introduced.

## 9. Acceptance before any R15 implementation is accepted

Independent review covered this whole contract and every table row; the owner
accepted R11 on 2026-11-16. R15 still requires separate implementation authority.
Future executable acceptance must:

1. Bind a tested operation/model descriptor to exact source/adapter versions.
   Demonstrate positive and negative cases with literal expected decisions,
   coverage states, reasons and unchanged global status for T01–T24.
2. Use an outside-selection malformed importer, an informational computed import,
   same-file unresolved output and an unknown inbound origin with no existing edge.
   Check both selection directions; test file/block/symbol expansion.
3. Exercise every inventory/read/parser budget and unreadable directory, including
   hidden descendants. Distinguish intentional exclusions, known omitted files and
   unknown unvisited scope. Never open forbidden bytes or increase limits for PASS.
4. Pair a positively classified irrelevant asset with a same-name unread/oversized
   or changed-content counterexample. An extension, text/binary state alone, or
   unchanged selected file must not turn missing proof into success.
5. Cover stale binding/revision/snapshot/model/policy, policy-only changes, edited
   names/membership, change-during-read, stale cache and invalid continuation.
   Reconstruct all paged evidence/fragments and reject cross-context splicing.
6. Verify UI and CLI decision parity independent of layers/areas/hidden edges;
   keep the original partial warning visible. Source previews remain distinct.
7. Retain byte/behavior regression oracles for legacy full context, R03 receipts,
   strict preflight rejection and existing managed instructions. Explicit opt-in
   cannot alter default gate semantics or weaken source/privacy checks.
8. Use only authorized disposable fixtures and loopback for runtime acceptance.
   Package/binding/lifecycle checks are needed if R15 changes shipped behavior.
   No fixture or CI PASS proves arbitrary-project safety or host instruction activation.

Stop an R15 candidate if it lacks a required coverage ledger, classifies unknowns
by warning text, assumes no edges means no possible importer, requires policy/limit
relaxation to pass, or makes a stronger promise than the chosen operation. Fix the
specific missing coverage under the existing roadmap/owner authority or leave the
operation unavailable. R11 grants no blanket R13–R16 implementation permission.

## 10. Review, delivery and rollback

This change contains only this design contract and ROADMAP status/link updates. Local
checks validate document links, required cases and that no runtime/test/package/
configuration files changed. No runtime tests, build, browser, installation or
new behavior is claimed by R11. If repository CI runs for the docs PR, it checks
the unchanged baseline and is not evidence that scoped preflight exists.

Independent review must bind the exact diff, challenge the two operation promises,
global blockers, unknown inbound/outbound scope, truth table, receipt compatibility,
policy/source-read privacy and stale/UI parity. Record findings and their verified
disposition in PR #36. Independent review accepted the design candidate; the owner
then explicitly accepted the contract. R15 remains conditional on separate
implementation authority and required coverage.

Rollback before merge: withdraw the PR. After the owner-authorized merge:
revert these documentation changes. No migration, target file rewrite,
runtime rollback, tag/asset change or installed-instruction rewrite is involved.
