# R09 — Generic presentation

Date: 2026-11-16. Base: `fe0c79e4338e73fdef78cafc03305a2d0d164c4f`.
Status: **implemented candidate, unmerged and unreleased**. The owner requested
R09 with agent swarm, tests, documentation, CORTEX and a separate independently
reviewed PR, without merge or release.
[ROADMAP](../../ROADMAP.md#r09--generic-presentation) owns stage status; the follow-up
PR owns exact reviewed commits, disposition and CI receipts.

## Problem and contract

The overview ranked eight agent.mind block IDs ahead of other projects' blocks
and used labels/core grouping as additional priority. Nested sections and areas
had separate hardcoded English-name/section-ID priority lists. File view treated
the `public/` directory as an interface, called root files the project core, and
retained Czech application fallback text for configuration and missing hashes.
These presentation choices could override unrelated projects' metadata/source
order or imply a responsibility from a directory name.

R09 removes those presentation assumptions. Source files and validated metadata
remain authoritative; names do not establish dependencies or semantic roles.
There is no new order/rank field, graph schema or hierarchy rule.

## Ordering and copy

- The overview preserves its supplied block array. Declared blocks already follow
  the naming map's `blocks` order; inferred blocks keep the source-derived order
  supplied by the overview. The renderer adds no block-ID, group or label rank.
- Nested source parts use path, line, column and stable ID. Text comparisons use
  case-sensitive UTF-16 code-unit order, independent of process locale. Missing
  locations use empty path/zero coordinates, then stable ID; names are not ties.
- Sections follow their first member in that source order. Collapsed areas use
  their original `partNodes`/`memberIds` to find the first source member, so
  collapsing or renaming an area does not replace source order with label order.
  Expanded members use the same comparator. Explicit boundary/context metadata,
  rather than a label such as “Outside”, puts outside context last.
- File view keeps grouping by indexed kind and literal folder path. `public/` gets
  the same path treatment as other directories. English headings/fallbacks are
  `Project root`, `Configuration` and `unavailable` for a missing hash. User labels,
  descriptions, source text and Czech aliases are not translated or rewritten.

Existing finite positions are retained by node/area ID during reconciliation,
including when metadata is reordered. New cards find space beside retained ones;
removed IDs disappear. Explicit **Arrange files** recomputes the current ordering.
Selection, camera, source reads and keyboard/pointer behavior keep their existing
contracts. The shared hierarchy, graph producers, CLI/context, source-identity
rules, CSS, dependencies and versions are unchanged. This is not R10 identity work.
The repository's own naming map drops only two stale references to the removed
`layoutOverview.priority` and `sectionGroups.rank` helpers. This avoids new missing-
part warnings; it does not change any user map or copy maintainer vocabulary into
a target. That development naming map is outside the runtime payload.

## Verification

Seven new R09 tests cover metadata order versus names/repository IDs, survivor
positions across reorder/add/remove, source path/line/column/ID ties, section order
and context flags, collapsed/mixed/expanded areas and renamed sections, stable
area IDs across changes, and neutral file grouping. Before the implementation,
five tests failed for the intended ordering/copy differences and two existing
retention behaviors already passed. Afterward the focused UI/hierarchy suite
passes **73/73** on Node 22.23.4. The prior section-order test now expects source
order and retains its counting, nonoverlap and reconciliation assertions.

The full Node 22.23.4 suite passes **417/417 tests**. After removing the two stale
maintainer-map entries, the affected map/hierarchy suite passes **28/28**, fresh
context has a valid input policy and no new warning/error (only the pre-existing
oversized wordmark warning), and all 47 runtime payload hashes still match.
The actual produced bundle passes all **16 installed-CLI/lifecycle smoke groups**
in disposable fixtures. No real project is installed or upgraded.

| Candidate binding | SHA-256 |
| --- | --- |
| `public/visualizer.js` | `836e7875385845e58ca5e3bc62eed8a5ed0a979f8388d6ee53744e0d13243a78` |
| Artifact digest | `534322eab45d97b6fbf00cba593dac6615effca5da8360bf8b662f02905ad1fb` |
| Archive | `679d176372bd9c622d8d2b6db1b93055d18d73ab99d519d3c50f868b226f315d` |

Fresh source and actual-bundle browser runs each pass **20 checks** in isolated
headless Chrome 157.0.8103.52 on macOS, at 1440 by 1000. The unrelated fixture has
exactly four custom overview block IDs, none from this repository's former priority
list. Its explicit metadata order opposes label order; symbols and sections also
oppose lexical names and the former priority lists, including two declarations
on one line with different columns.

Both runs exercise cold starts and label renames, metadata reorder with retained
manual positions, explicit Arrange, outside context, collapsed/mixed/expanded
areas, stable section IDs during renames, native dragging and camera panning,
layer switches, actual source refresh, and Back/reentry with reopened source
details. The refreshed symbol's selected source, current hash/line, position and
camera remain correct. File view shows literal `public`, `Project root` and
`Configuration`; an actual external dependency shows `hash unavailable`. A Czech
user label and alias remain searchable. Scanned fixture code is never executed.
Served UI bytes match the frozen source and actual bundle above. The main agent
also inspected root, mixed-area and live-source screenshots.

Final runs have zero page errors. Each records exactly three canceled old
EventSource requests, bound by request ID and timestamps to three explicit page
reloads, each followed by a new HTTP 200 stream. No unmatched failed request is
accepted. Earlier attempts are retained privately: the harness corrected an
offscreen drag target, a pan over the inspector/card, and panel/scope navigation;
main review then required exact reload attribution and removal of an unintended
inferred block from the fixture. The final source/bundle runs include both evidence
repairs. These corrections required no runtime edits.

Exact final-commit independent review and Node 22/24 CI receipts belong to the
follow-up PR. Unit tests alone are not browser proof, and the browser worker was
exposed to prior context verdicts; its execution is not claimed as blind review.
All task-owned browsers/servers were closed and disposable fixtures removed;
closed ports were independently checked. Private evidence remains outside commits.

## Limits and rollback

Published 1.3.1 and existing pinned installations predate this candidate. The change
does not install or upgrade a real target. This is a bounded presentation repair,
not a new graph layout engine, schema, localization system, accessibility audit or
performance claim. Browser coverage is limited to this desktop Chrome fixture;
Safari, Firefox, mobile, assistive technologies and real installed targets are
unverified. Fresh context may remain partial for pre-existing input limits;
no strict preflight is bypassed. Reviewer read-only constraints are procedural
under inherited permissions and must not be presented as enforced isolation.

Before merge, withdraw this PR. After a separately authorized merge, a reviewed
revert restores the prior presentation/tests/docs. Keep user maps and stored
positions; no map migration, source-ID rewrite, browser-storage reset or cleanup is
required. Reverting restores the known priority/copy limitations; release and
real-target operations remain separate owner decisions.
