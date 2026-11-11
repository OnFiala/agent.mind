# R01: schema-1 artifact digest and process locale

Date: 2026-11-11. Base: `27af3ec857b668bac81e31a1c20f64a1c7e1f7fb`.
Status: source repair; merge authorized by the owner on 2026-11-11, release withheld.
[ROADMAP](../../ROADMAP.md#r01--locale-stable-artifact-digest) owns priority and
status; [PR #20](https://github.com/OnFiala/agent.mind/pull/20) records the reviewed
commit, merge status and pre-/post-merge CI. No real-target upgrade is included.

## Defect and bounded repair

The builder and `artifactDigest` previously used the process-default
`localeCompare`. Czech and Slovak collation changed the relative position of
`node_modules/acorn/CHANGELOG.md`, changing the JSON member order hashed for the
same files. A valid published artifact could then fail with `Artifact digest
mismatch` before installation.

Both artifact comparators now explicitly use `localeCompare(..., 'en')`, retaining
the English order in every checked schema-1 published manifest. The SHA256 formula,
JSON representation, schema version, payload allowlist, dependency pins,
`expectedDigest` check and file-byte verification are unchanged. Other ordering,
including purge-plan ordering, is outside R01.

This is a compatibility repair for the existing allowlisted paths, not a new
canonical-order format for arbitrary Unicode paths or a guarantee across every
future ICU/Node version. A new path alphabet or ordering scheme requires separate
compatibility evidence and, if needed, a versioned format change.

## Published-artifact evidence

All nine release archives and their `SHA256SUMS` were downloaded from the linked
GitHub Releases on the test date. Each archive matched its published checksum and
GitHub asset SHA256 metadata. After bounded regular-file extraction, every payload
file hash and the manifest's exact file membership matched. No retained artifact
was modified or republished.

| Release | Archive SHA256 | Manifest digest |
|---|---|---|
| [v1.3.1](https://github.com/OnFiala/agent.mind/releases/tag/v1.3.1) | `042d1f7ac90bc03735d08383f7048a057725a87ffdf85a7d5cdc547acc91f536` | `a4ebaf5b35e82cee108c3a7649804e0a2c9688034363ea43f0c324614c62c306` |
| [v1.3.0](https://github.com/OnFiala/agent.mind/releases/tag/v1.3.0) | `13b6ac2d543f3f9bd66f2758f42b68102e5de9821281a2659a74f3576e65b14d` | `d13a4194f38df22a266687d9b986e17c660ca824e61ec1437fe5e7623919f258` |
| [v1.2.1](https://github.com/OnFiala/agent.mind/releases/tag/v1.2.1) | `fa1401d3c5fc910c77b9931da8ab64e1d1ec7ef10be72dfd86f65fb696bba2fc` | `3f5c0348900525542d5b6860769c728610690db01e444e5a36bfe423d2d268ce` |
| [v1.2.0](https://github.com/OnFiala/agent.mind/releases/tag/v1.2.0) | `8340c3f70801c3b09fe9c5f9a7a7b66d77008f7738c2b489e686a041d9b4f6c4` | `6f27e1b1e1d8a0740847f7bfef1f06c04d8c73dbefe2719c71c746975537550d` |
| [v1.1.0](https://github.com/OnFiala/agent.mind/releases/tag/v1.1.0) | `9fa1132f22e69a0b4d66d609b99d225ad209ce1c97e99e5782a878343a665f24` | `7e6be652f82dc782928468a791dcc591e052fa9ee717247ffbd985b4bad6d102` |
| [v1.0.3](https://github.com/OnFiala/agent.mind/releases/tag/v1.0.3) | `f975965f925806518180c8222978d4b3804a6244751401800af7d446e7dcb225` | `ffcf92c345d0bd2d6ad6082dc546947e36b6e0e9b7f0b79d107e236434a8db28` |
| [v1.0.2](https://github.com/OnFiala/agent.mind/releases/tag/v1.0.2) | `ce2bec08e856fd61d0a6a40c98e80bffbc83d69ce08526540a83aa650ae63fb6` | `5f3b679bfc0906bc972c2107d001219b50110406b55c95a203aaf7a05332dff3` |
| [v1.0.1](https://github.com/OnFiala/agent.mind/releases/tag/v1.0.1) | `bf73585e42cdf95f82e08c9b05a1c92a1c61a416a026cb4f67f9c2eba8557a05` | `ee6969cca783e375d7571f0fe4b87fd694d3a8ca0285ceca078bf946ba71e366` |
| [v1.0.0](https://github.com/OnFiala/agent.mind/releases/tag/v1.0.0) | `e7acd73e91aab722a7f160c2beed26f2d61e4878546350b7fa2dc38667293c8e` | `7e85b0a213030827a6182d06e04b2b2dee3c22ea16423926a70fc88d1f80456a` |

Separate Node processes recorded these effective collator locales:

| `LC_ALL` / `LANG` | Resolved locale | Candidate digest matches | Full candidate verifier |
|---|---|---|---|
| `en_US.UTF-8` | `en-US` | 9/9 original manifests | 1.2.0, 1.2.1, 1.3.0, 1.3.1 |
| `cs_CZ.UTF-8` | `cs-CZ` | 9/9 original manifests | 1.2.0, 1.2.1, 1.3.0, 1.3.1 |
| `sk_SK.UTF-8` | `sk-SK` | 9/9 original manifests | 1.2.0, 1.2.1, 1.3.0, 1.3.1 |
| `C` | `en-US` | 9/9 original manifests | 1.2.0, 1.2.1, 1.3.0, 1.3.1 |

Before the fix, the original digest function matched 9/9 under English and `C`,
and 0/9 under Czech or Slovak. The repaired current verifier still rejects 1.0.x
for missing Babel payload files and 1.1.0 for missing Lezer payload files. Matching
a historical digest does not relax these existing payload-shape requirements or
claim full current-verifier support for those older artifacts.

## Validation

Local environment: macOS, Node.js `22.23.4`. Linux/Node 22 and 24 CI is recorded
separately by the pull request; local results do not establish CI completion.

- Both newly exercised locale regressions failed on Czech locale before the two
  production edits, then the focused installation/package tests passed (35/35).
- The digest test uses a literal independently ordered path/hash map and checks
  both forward and reversed input insertion order in four fresh locale processes.
- The package test uses a literal 47-path order, hashes the original fixture bytes
  independently, builds in all four locales and verifies every build in all four
  locales (16 combinations). Every combination rejects a wrong expected digest
  and altered payload bytes. Resolved locales are asserted.
- Full `npm test`: 328/328 passed, no skipped or cancelled tests.
- `npm run package -- --output <new-directory>` under `cs_CZ.UTF-8`: passed;
  the produced manifest contains 47 payload files and schema version 1.
- `LC_ALL=cs_CZ.UTF-8 LANG=cs_CZ.UTF-8 node scripts/smoke-release.mjs <bundle>`:
  all 11 groups passed against the actual installed CLI/runtime, including
  loopback APIs, binding/preflight rejection, preserved instructions/dependencies
  and cleanup of owned fixtures/processes.
- Existing `scripts/smoke-upgrade.mjs <old-bundle> <candidate-bundle>` passed for
  published 1.0.3, 1.1.0, 1.2.0, 1.2.1 and 1.3.0 (12, 12, 13, 12 and 12 groups).
  These ran under English because the retained old CLIs still have the locale
  defect. This is upgrade/rollback fixture evidence, not a 1.3.1-to-candidate
  upgrade test; the candidate intentionally retains the source version 1.3.1.

Locally built candidate manifest digest: `77f07334298ac1da70e87ea8beb959a13f66b6b2241f10d0306d4eaf09402290`.
Local candidate archive SHA256: `4df63553fc5cb3aba4307050de491dc9edb1eb0c943828f6fdaacb72772e4ca5`.
These identify validation bytes only; they are not published release pins.

No UI change, browser interaction or host instruction-loading claim is made.
Tests use disposable fixtures and loopback; no real target was installed/upgraded.
The source checkout's existing oversized wordmark still makes development context
`partial`; this repair does not bypass installed preflight or claim a complete
self-index. Review uses procedural read-only restrictions, not proof of a separate
enforced read-only sandbox.

## Rollback and delivery boundary

Revert the bounded R01 source commits to restore the prior implementation; that
also restores the known locale defect. Do not change historical manifests,
checksums, tags, archives or existing installed runtime pins. A release, version
bump, target upgrade or target rollback is a separate explicitly authorized action.
Published 1.3.1 and every existing target still carry their original implementation.
