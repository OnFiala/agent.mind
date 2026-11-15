# R07 — Source priority within existing budgets

Date: 2026-11-15. Base: `b9eb09adbcfdfcb2e7fbc92e79b98076ba1a3677`
(the merged R06 input-policy implementation). Status: **source candidate, unmerged
and unreleased**. The owner authorized R07, tests, documentation, CORTEX and a
standalone PR with independent review. Merge, release and real-target changes are
excluded. [ROADMAP](../../ROADMAP.md#r07--source-priority-within-existing-budgets)
owns stage status; the PR owns exact reviewed commits, disposition and CI receipts.
Published 1.3.1 is unchanged.

## Problem and behavior

R06 filters input before reading it, but its traversal fills file slots in directory
order. In a project with 1,005 eligible JSON assets before a small `src/` directory,
the source can be omitted by the 1,000-file cap. Lexical content reads can also let
assets exhaust the total-byte budget ahead of source.

R07 keeps the same bounded traversal and filters, collecting observed eligible
paths before allocating slots. It sorts those candidates in two ranks:

1. `.js`, `.mjs`, `.py`, the existing TypeScript/TSX/JSX pilot and existing known
   unsupported source suffixes (`.cjs`, `.mts`, `.cts`, `.pyi`, `.go`, `.rs`, `.java`,
   `.swift`, `.kt`, `.c`, `.h`, `.cpp`, `.cs`, `.rb`, `.php`, `.vue`, `.svelte`).
2. All other eligible regular files, including JSON, HTML, CSS and Markdown.

Within each rank, the complete relative POSIX path uses case-sensitive UTF-16
code-unit order, with no locale comparator or normalization. Classification reuses
the existing source recognizers; it does not inspect content, guess responsibilities
from directory names, use naming-map labels or add language support. Unsupported
source is still inventory/text only with its original warning; typed files still
have syntax-only, partial analysis. Files without a recognized suffix retain their
existing inventory behavior.

At most 1,000 sorted candidates are selected. The same priority order drives bounded
content reads; graph presentation keeps its existing output sorting. Each observed
omitted file gets an `unscanned` / `file-limit` record without an ordinary
inventory/source read or hash, plus a warning making the result partial. The
selected naming map keeps its existing separate bounded control-input read even
when its path has no ordinary file slot; R06 ignore/privacy checks still apply.
That read does not create an indexed source node or authorize source retrieval.
Unsupported-source diagnostics describe selected candidates only. Exactly 1,000 eligible files alone do not make inventory
partial; an additional eligible file does. Binary, oversized and unreadable selected
files still consume a slot; no replacement scan or retry enlarges the budget.

## Preserved boundaries

| Boundary | Unchanged limit / behavior |
|---|---|
| Selected regular files | 1,000, regardless of text classification |
| Per-file read | 512 KiB |
| Total indexed content read | 16 MiB |
| Directory entries / depth | 10,000 / 20, with existing exhaustion reporting |
| Root ignore bytes / lines / line bytes | 65,536 / 1,024 / 1,024 |
| Policy matching work | 8,000,000 states |
| Exclusions | R06 hard guards, soft defaults, ignore precedence, exact integration subtree |
| Invalid or changing policy | Fail closed before source/naming publication |
| Strict preflight | Global incomplete scope continues to reject |

Only paths actually observed within the entry/depth budgets can be ranked. Existing
bounded directory enumeration can omit source before ranking and remains explicitly
partial. The scan can enumerate and match more eligible names than R06's early
file-cap return; no new timing, memory or fairness guarantee is made. A priority
source file can itself be binary, oversized, unsupported or too expensive to parse.
More than 1,000 source candidates still require deterministic omission.

No scanned code is executed. No dependencies, descriptor schemas, settings,
runtime pins, source-read guards or browser behavior are changed. No new runtime
module is needed. Existing installs retain their exact pinned runtime.

## Verification

Local verification used Node 22.23.4, disposable fixtures and loopback only:

- `npm test`: **400/400 passed**. Nine new priority tests cover 1,005 JSON files
  ahead of JavaScript/Python source, symbols/imports, identical cold/warm results,
  byte competition, ordinal ties, unchanged unsupported capabilities, exact/over
  limits, cache admission/eviction/recovery, the naming control read, R06 no-open
  guards and entry/depth uncertainty. Observed omitted ordinary files are never
  opened. The original 77 input-policy/index tests also passed independently.
- `npm run package`: **47 runtime files**; every payload hash matched the final
  source. Artifact digest:
  `ccb934aca49480de0145ee31a66c61073b7d8ebddb6980732fa3393bd1ee077d`.
  Archive SHA256:
  `2f66cae4da5a44bc909ff4da0d7d82ef53c51cf62851612a7b93595007d3a1aa`.
- `scripts/smoke-release.mjs` against that produced bundle: **16 groups passed**.
  The new actual installed-CLI case retains source symbols/imports behind 1,005
  JSON candidates, rejects both full and bounded-agent strict preflight for the
  incomplete inventory, preserves source/policy/map/descriptor bytes and restores
  the original revision after fixture removal. Existing lifecycle, source/API/SSE
  policy revocation and recovery checks also passed. Temporary views were stopped
  and fixtures removed by the smoke runner.
- Syntax and `git diff --check` passed. Fresh source graph context is policy-valid
  but remains globally partial because of the existing oversized wordmark asset;
  this is not a successful strict self-preflight.

The initial seven new tests had six failures on the unchanged R06 baseline. During
fixture work, case-colliding macOS paths and missing naming-map schema fields were
corrected without changing runtime code. The first full run passed 399/400: the
legacy full-context byte/hash oracle needed the new scope explanation. Removing
only that sentence exactly reproduces the previous 12,406-byte SHA256 oracle;
the new snapshot is 12,704 bytes. The final full rerun passed 400/400.

The PR records independent exact-commit review and CI separately from these local
checks. Reviewer read-only restrictions are procedural under inherited permissions,
not a verified separate read-only sandbox. No merge or release follows from test or
review success.

## Rollback and evidence limits

Before merge, withdraw the candidate; main and installed targets are unaffected.
After a separately authorized merge, use a reviewed revert of this exact change.
This restores previous file/byte allocation order while retaining R06 exclusions.
After a separately authorized release, use the existing pinned-runtime rollback
procedure. Preserve all target source, root ignore files, naming maps, descriptors,
bindings and recovery data. No data migration or cleanup is needed.

Source tests and disposable installed-bundle checks do not prove behavior on
arbitrary repositories, latency bounds or an actual target upgrade. This change
has no new browser interaction; browser UI behavior is outside its verification.
