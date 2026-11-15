# CORE-02 — Exact inventory file boundary

Date: 2026-11-15. Status: source candidate, unmerged and unreleased.
The owner authorized this isolated repair, regression tests, documentation,
independent review and a separate PR. Merge, release and real-target upgrades
remain outside this change. Published 1.3.1 is unchanged.

## Problem and contract

On baseline `81fed3850d2399c8f956da6cf53a37ae4614241c`, exactly 1000 eligible
`a0000.mjs` through `a0999.mjs` files produce a current graph. Adding only
`node_modules/ignored.mjs` makes the same 1000-file graph partial: the inventory
checks the file count before classifying the later directory as excluded.
The unchanged strict context preflight consequently rejects it.

The file budget now applies when an otherwise eligible regular file would be
admitted. Symlinks, hidden/sensitive paths, policy exclusions, special files and
empty directories do not consume a file slot. Eligible directories are still
traversed under the existing directory-entry and depth budgets. An observed
1001st eligible regular file still emits the file-limit warning and unscanned
boundary, and keeps the inventory and context partial.

This count precedes content reads and classification. Binary and oversized
regular files still consume file slots. Separate byte, entry and depth limits,
error reporting, safe paths, source hashes and strict preflight are unchanged.
Completeness remains bounded inventory completeness, not complete language
analysis or runtime knowledge. No scanned project is executed.

## Change boundary

- Move the existing file-limit check into the eligible regular-file branch of
  `inventory()` in `code-index.mjs`; retain its warning and truncation behavior.
- Add two regression groups to `test/code-index.test.mjs`: exact boundary with
  excluded entries/empty directories, and genuine overflow in a nested directory.
- Clarify the source-only contract in README and the roadmap.

No graph-schema, dependency, version, UI, resolver, installation-format, CORE-01
or separate R04 change is included. This is not a new supported-size or latency
promise, and it does not add `.gitignore` interpretation.

## Local validation

macOS, Node 22.23.4:

- Both new regression tests fail on the original source and pass with the repair.
  The nested-overflow test also verifies that the warning identifies the actual
  extra file instead of stopping at its directory name.
- `node --test test/code-index.test.mjs`: 63/63 pass.
- `npm test`: 345/345 pass.
- A separately authored 12-case source corpus has seven false-partial mismatches
  on the baseline and none on the candidate or the actual bundled analyzer.
  It checks excluded directories/files, empty directories, nested exclusions,
  symlinks, special files, explicit integration exclusion, actual root/nested
  overflow, binary overflow and the unchanged depth budget. Every case retains
  the exact expected set of 1000 indexed source files.
- `npm run package`: candidate built and verified; all 47 payload files match
  source. `scripts/smoke-release.mjs` on that bundle: 12/12 groups pass.
- A disposable installation of the actual bundle confirms 999 source files plus
  its managed AGENTS file produce 1000 text entries, `current` context and a
  successful revision/binding-pinned preflight despite excluded node_modules and
  an empty directory. Adding one eligible source file produces `partial` and
  preflight exits 1. The fixture source is never executed; the fixture is removed.

Candidate runtime digest:
`54f44c2231485c86fca06df8abeadce46c2a99034b93410b5524b5f7125f7137`.
Candidate archive SHA256:
`a452af04d1877f4614b6c6d641f8e3942eb7e3d098322ed37a64fc6260be80c2`.
These identify a local candidate, not a published release.

The associated PR owns the exact reviewed commit, independent review disposition
and remote CI receipts. This local validation record alone does not establish
PR readiness or authorize merge. Material follow-up changes require delta review.

## Limits and rollback

The repository's existing oversized-wordmark partial diagnostic remains. No gate
is bypassed. No browser appearance, real-host instruction activation, production
installation or general performance improvement is claimed. Reviewer read-only
conduct is procedural under inherited permissions, not independently OS-enforced.

Before merge, close the PR to leave main unchanged. If rollback is separately
authorized after merge, revert the bounded CORE-02 source change; this restores
the known false-partial behavior at the exact file boundary. Existing published
archives, target runtime pins, maps, bindings, instructions and recovery data are
unchanged. No data migration is required.
