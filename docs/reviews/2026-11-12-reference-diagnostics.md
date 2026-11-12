# R04: explicit diagnostics for unsupported reference analysis

Date: 2026-11-12. Base: `9e6c881989de885432f921c68f5d789f33e6ee8e`.
Status: source candidate; implementation, tests, documentation, independent review
and a separate PR authorized. Merge, release and target upgrades are not authorized.
[ROADMAP](../../ROADMAP.md#r04--explicit-unsupported-reference-diagnostics) owns
priority/status. The PR records exact reviewed commits, review disposition and CI.
Published 1.3.1 and existing installed runtimes do not include this candidate.

## Contract

The source graph reports the bounded syntax it understands. R04 makes specific
unsupported reference forms visible without resolving new dependencies or changing
source identities. A complete inventory and a `current` status do not prove full
language semantics, runtime behavior or the absence of dependencies.

| Observed input | Diagnostic | Preserved behavior |
|---|---|---|
| `.cjs` extension, including case variants | Warning, reason `cjs-extension`; no invented source location | Readable text only; no symbols, dependencies or security analysis |
| Unshadowed direct `require(...)`, `require.resolve(...)`, `module.require(...)` | Warning, reason `commonjs-syntax`, recognized `form` and exact location | No CommonJS dependency resolution |
| Unshadowed `module.exports` or statically named `exports` properties | Same syntax warning, including static bracket notation | No export/member/cross-file call resolution |
| Comments, strings, ordinary receivers or locally bound names | No CommonJS assertion from those spellings | Existing analysis and scope bindings |
| Python imports outside the indexed project-root layout | Existing informational external/unresolved diagnostic and evidence | No custom `src`, environment or runtime-path inference |

Diagnostic code: `COMMONJS_REFERENCE_ANALYSIS_UNSUPPORTED`; capability:
`static-references`. Syntax evidence carries `path`, `line`, `column`, `snippet`
and `form` (`require`, `require.resolve`, `module.require`, `module.exports`,
`exports-property`). Extension evidence is based on the observed filename, not
successful reads or parsing. Binary/unreadable inventory does not gain a source node.
Each `.cjs` input has one extension diagnostic globally and, when readable text,
the same diagnostic on its file node.

Recognition is bounded, not a CommonJS runtime detector. Dynamic computed member
keys, aliases, `createRequire`, package module mode and runtime values are not
inferred. Parse failures retain their existing warnings and do not gain guessed
syntax evidence. The `.cjs` extension remains outside the resolver allowlist.
Pure source analysis performs no I/O; the index owns file classification/resolution.

Warnings make the graph `partial` through the unchanged existing severity rule.
Strict preflight remains project-wide and rejects a warning even when another file
is selected. Removing the unsupported input and refreshing restores the ordinary
gate if no other warnings remain. Ordinary Python external/unresolved imports and
calls remain informational; supported Python stays eligible. No blanket Python
`partial` rule, scoped-preflight bypass or source execution is introduced.

Full context retains global and file diagnostics. The agent profile keeps local
and global uncertainty counts, with exact diagnostics available through its
existing revision/binding-bound sections and continuation. Transfer omissions do
not erase analysis limitations. UI inventory/freshness and zero-link wording now
state the supported-analysis boundary; file and index notes show the same warnings.

## Verification

Local validation on macOS / Node 22.23.4:

- `npm test`: 352 tests passed; none failed, skipped or cancelled.
- `npm run package`: 47 payload files, each hash checked against source and the
  produced bundle. Archive contents exclude private workspaces, evidence and legacy
  archives. Artifact digest:
  `0375119cddf6f75fe5bfaa616e9cb6d922391421f0d815b5d9b3ea09584a6802`.
  Archive SHA256:
  `ea8b2f3f12dede55f36560abe31ea77f741d5f3c0dd975a6061be9c1a8d1d5f1`.
- `scripts/smoke-release.mjs` against that bundle: all 13 groups passed, including
  explicit CommonJS diagnostics, strict rejection and recovery after fixture removal.
- Identical before/after fixtures retained exact ESM and Python edges, symbols and
  revisions. Their status remained `current`; CommonJS changed from `current` with
  no diagnostic to `partial` with three warnings and unchanged edges/symbols.
- Installed disposable CLI checks cover full and bounded context, local/global
  uncertainty and pinned diagnostic retrieval; warnings fail project-wide preflight.
  Python custom `src` imports retain informational provenance, unresolved calls and
  successful preflight under the existing bounded-analysis contract.
- Headless Chrome exercised the actual installed bundle on loopback: project and
  file warnings, complete inventory alongside partial analysis, `.cjs` text-only
  display and the preserved hybrid-file ESM edge. No page errors were observed;
  screenshots of both file views were inspected. This does not prove instruction
  activation in a real coding host or behavior on a real user project.

The separate PR owns exact reviewed commits, independent review disposition and
exact-head CI. Local validation is not a CI result. Review read-only restrictions
are procedural under the inherited workspace permissions, not separately enforced.

An initial integration probe found R04-INT01: the new function-body scope marker
also reached concise arrow expression bodies, which caused an `items is not
iterable` error. The marker now applies only to block bodies. Regression controls
cover an ordinary concise arrow, an unshadowed `require` arrow and a parameter
named `require`; the initial failure remains part of the validation evidence.

## Delivery boundary and rollback

Revert R04's focused source commits to remove this disclosure; the earlier silent
CommonJS limitation returns. No graph identity, stored project data, binding schema,
runtime pin or user naming map is migrated. Preserve user instructions and recovery
data. No parser dependency, resolver scope, artifact schema or version change.

This source candidate does not update installations or publish an artifact. Test
fixtures are disposable and use loopback only. Read-only review conduct is distinct
from an independently enforced read-only sandbox. Generated diagnostics do not prove
that a real host consumed them; that claim requires a separate host interaction.
