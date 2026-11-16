# R10 — Accessor identities

Date: 2026-11-16. Base: `9fa1263f5ff1b4267a1434f660a8794270c3b2cd`.
Status: **implementation and independent review complete; merge authorized,
unreleased**. On 2026-11-16 the owner approved merging PR #33, verifying CI on the
actual merge commit and updating documentation/CORTEX. Release and real-target
operations remain excluded.
[ROADMAP](../../ROADMAP.md#r10--accessor-identities) owns stage status;
[PR #33](https://github.com/OnFiala/agent.mind/pull/33) owns exact reviewed commits,
disposition, actual merge SHA and post-merge CI receipts. This approval record
does not by itself establish a completed merge or successful merge-commit CI.

## Problem and bounded contract

The old JavaScript symbol ID used only the dotted qualified name. A class getter
and setter for the same property therefore collided: duplicate pruning omitted
both declarations, their descendants and their static call evidence. A singleton
accessor used the same old ID regardless of whether it was a getter or setter.
Preserving both singleton IDs when a pair appears is impossible without history.
R10 deliberately changes accessor and descendant IDs, retaining unrelated IDs.

`symbol-index.mjs` assigns `symbol:<path>#@accessor:<JSON ancestry>` to each supported
class accessor and its descendants. Ordinary ancestry segments are name strings;
accessors use `[name, accessorKind, static, private]`, where accessorKind is `get`
or `set` and the last two values are booleans. The reserved leading `@` cannot be
a top-level JavaScript binding; JSON segments distinguish literal dots/marker text
from ancestry. Public identifier and literal spellings of the same property share
an identity, while private `#value` differs from public literal `"#value"`.

Original `name`, `label`, `qualifiedName` and method kind remain unchanged in the
symbol graph. Accessors add their discriminator metadata; affected nodes carry
`legacyId`. Hierarchy descriptions identify getters/setters. Descendant parent IDs,
call-edge endpoints and source evidence use the new canonical IDs automatically.
No schema-version, dependency, package-version or source-execution change is needed.
Same-kind duplicate declarations still omit their subtrees. Source ranges/hashes
and evidence follow current text; adding the counterpart or moving lines does not
change the identity of a surviving accessor/descendant.

## Naming, ambiguity and compatibility

The hierarchy's naming targets and CLI/context selector resolution share one exact
source-ID alias rule. A unique legacy accessor or descendant ID may select the
current node. Multiple claims, including a collision with an ordinary canonical
ID, remain ambiguous. Raw duplicate claims remain marked even when pruning leaves
one surviving declaration, so omission cannot silently make an old selector safe.
Diagnostics list the currently available candidates; withheld declarations remain
explicit uncertainty. New canonical accessor IDs remain usable.

An ambiguous map entry assigns no label and carries its target and candidate IDs
in a warning. Different old/new map entries resolving to the same declaration
produce a naming-conflict diagnostic and neither name is applied. Existing
same-target validation remains in place. The naming map is never rewritten.
Original source aliases and qualified display paths retain existing ambiguity rules.
All UI/full-context/bounded-context projections consume the same hierarchy.

Accessor declarations are not property-execution evidence. The existing callable
method guard remains: reads/writes and `this.value()` do not create an accessor call
target. Calls inside the accessor or its named descendants retain conservative
same-file evidence. Ordinary methods, object methods, computed accessor names,
class fields, cross-file calls, typed syntax and Python are not expanded. Existing
computed-accessor containment limitations remain outside this repair.

## Verification

Twelve new regressions were run on the baseline before implementation: one passed
and eleven failed for the missing identity/alias behavior. Two initial test-oracle
assertions were corrected before the final red baseline; the initial report is
retained privately. After implementation, accessor/symbol/hierarchy/map checks
pass **64/64**. The cases cover both singleton directions and declaration orders,
line/range/hash/evidence changes, same-named and nested descendants, static/private/
literal distinctions, duplicate pruning, noncallable accessors, unique/ambiguous
legacy maps, conflicting names, projections, bounded context and live refresh.

Main's subsequent check found and fixed one resolver regression: an absent selector
could match nodes lacking `legacyId`. A thirteenth regression now protects missing
selectors; the final focused suite passes **65/65**, and `npm test` passes
**430/430** on Node 22.23.4. The final produced bundle passes all **16** existing
installed-CLI/lifecycle smoke groups and all **4** accessor rollback groups.
All 47 payload hashes, including README, match the tested source.

| Final candidate binding | SHA-256 |
| --- | --- |
| `symbol-index.mjs` | `bf4a70b4b58dd0104c69e0e8186ea22b52eaa2d62e012742124b0eb22edc07e1` |
| `project-map.mjs` | `f70e911aa14c3888034a61de501a931c822438f0a566c2ea1dd746d9b5c4f85f` |
| Artifact digest | `ae01cfdbdc1f6a23a377a6c5dde258a1b28daa3ea87dc92904537b01e640fdf1` |
| Archive | `9d9aaffaf7cdd23d495ff041dd3fc85489d6997b598b4a466e473305b9e5417e` |

Fresh source and final-bundle browser runs each pass **12 checks** in isolated
Chrome 157.0.8103.52 on macOS at 1440 by 1000. Both accessors and their same-named
children remain distinct. The runs inspect legacy-map ambiguity/candidates,
canonical labels, source details/current hashes, shared scope/area projections,
layers/Back, native drag/pan and singleton/pair state retention. Removing a selected
setter clears its detail; removing its open scope returns to the surviving class,
without retargeting the getter. Main inspected final getter/setter screenshots:
they highlight their distinct source lines, and the removed-scope image shows the
parent fallback. Keeping a map entry for the removed setter correctly leaves a
visible incomplete-map diagnostic.

Canonical IDs containing quotes roundtrip through URL-encoded HTTP full context
and revision/policy-bound source reads. Bounded-context selection is checked by a
direct call to the same runtime projection, since the HTTP endpoint does not expose
that profile. Each browser run has one SSE request with HTTP 200, no page errors
and no failed requests; no reload attribution exception is needed. All owned
browsers/servers and fixtures were cleaned, and main independently checked closed
ports. Earlier browser evidence and the last preliminary harness-error report are
retained privately; the final runs bind the corrected selector payload. This is
browser execution evidence, not a blind review. Other browsers, mobile, assistive
technology and real targets remain unverified. Exact final-commit independent
review and Node 22/24 CI receipts belong to the follow-up PR.

The permanent installed-CLI rollback smoke uses the exact published 1.3.1 artifact
(digest `a4ebaf5b35e82cee108c3a7649804e0a2c9688034363ea43f0c324614c62c306`, archive
SHA-256 `042d1f7ac90bc03735d08383f7048a057725a87ffdf85a7d5cdc547acc91f536`). It uses
disposable projects, each current installation's CLI, explicit uninstall/park/fresh
install steps, exact map bytes and independent runtime digests. Candidate and old
runtime may have the same package version; the artifact digest identifies their
bytes. CI adds this scenario to the existing Node 22/24 test/package/lifecycle and
older-version upgrade checks. Scanned fixture source must never be executed.

The first actual rollback run exposed a test-oracle mistake, not lost owner bytes:
recovery keeps both pre-attach owner instructions and pre-detach attached
instructions. The corrected smoke verifies exact known hashes for both snapshots
and byte-identical restoration of the active owner file, rather than accepting an
arbitrary recovery copy. Its retained failed log and subsequent successful runs
are separate evidence. Forward compatibility, legacy ambiguity, new-map rollback,
source/instructions/owner data, parked integrations and stale binding rejection
all pass against the final candidate; neither input artifact is modified.

## Limits and rollback

Published 1.3.1 and existing pinned installations predate this change. No real
project is installed/upgraded, no version is bumped and nothing is released.
This is a bounded identity transition, not a complete JavaScript object/property
model, source-ID migration service, performance claim or general accessor runtime
analysis. Input limits and ordinary unresolved relationships remain visible.
Fresh source context retains its existing oversized-wordmark warning.

Before merge, withdraw the candidate PR. After merge, a separately authorized
reviewed revert restores the prior identity rule and its known pair omission.
Preserve naming maps, user data and stored positions. New-ID map entries remain
unresolved on the old runtime; do not delete or silently retarget them. Use exact
new selectors to disambiguate pairs on this candidate, and explicitly choose a
legacy selector only when operating under an older runtime's source model.
Private evidence remains outside commits. Procedural reviewer read-only scope is
not evidence of technically enforced isolation; direct child-memory availability
and any context exposure are disclosed in the final review/PR receipt.
