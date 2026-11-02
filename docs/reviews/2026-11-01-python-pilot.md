# Python syntax-inspection pilot — L5

Status: local candidate validated; PR #8 owns independent review and hosted CI disposition.
The acceptance contract was committed first as `68016d2`, before implementation.
Base: published 1.1.0, commit `2f6de3f37741876782144765419a9612d95d407d`.
This candidate will be a separate PR; it does not update published 1.1.0 or targets.

## Bounded contract

- One pure synchronous analyzer takes already checked UTF-8 source text, relative
  path and hash. No filesystem, Python interpreter, target imports, configuration,
  package install hooks, compiler, daemon, worker or network in the analyzer.
- `.py` only; named function/async-function/class declarations and nested methods.
  Preserve native parser kind, source spelling, source hash and producer version.
  No import/name/type/call/security/framework resolution. Every Python file is
  explicitly partial; strict preflight stays conservative. `.pyi` and notebooks
  remain inventory-only. A parser tree is not CPython validity or semantic proof.
- Zero-based UTF-16 offsets, exclusive end, one-based lines/columns. Preserve LF,
  CRLF, lone CR, tabs and astral Unicode without rewriting the checked text.
- Any recovery/error node withholds all declarations in that file. Ambiguous
  qualified names and their descendants are withheld. Size/traversal/symbol
  overflow must remain explicit and publish no partial declarations.
- Input cap 64 KiB; 2,000 declarations; 100,000 visited tree nodes; depth 256.
  These are bounds on work/input, not hard parser deadlines or a sandbox.
- Existing JavaScript and typed adapters retain identities and behavior. Existing
  literal source references to `.py` remain source references, not Python semantic
  resolution. Source text and inventory are still usable if analysis is limited.

## Fixed acceptance budgets

Measured before accepting the dependency against the published 1.1.0 artifact:

| Measure | Acceptance ceiling |
|---|---:|
| Added runtime payload including licenses/manifest | 600 KiB raw |
| Added runtime archive | 200 KiB gzip |
| Additional portable parser dependency closure | 4 packages |
| Fixed real corpus (<=64 KiB/file, <=512 KiB total): cold index | 1,000 ms |
| Same corpus unchanged index | 100 ms |
| One-file update / live refresh | 200 ms each |
| Peak process RSS / growth from process baseline | 256 MiB / 160 MiB |

Record exact corpus commit, file list/hash, package versions/licenses, three fresh
process runs, artifact bytes and environment. These ceilings are local pilot
acceptance checks, not product guarantees. A failed budget requires a documented
change of scope or architecture before acceptance. Correct ranges, explicit errors
and actual installed parser isolation are mandatory regardless of performance.

## Selection and validation

Selected `@lezer/python` **1.1.19**, with lock-pinned `@lezer/common` **1.5.5**,
`@lezer/lr` **1.4.12**, `@lezer/highlight` **1.2.5**. All four are MIT and portable
JavaScript. The runtime carries only their ESM entrypoints, package metadata and
licenses; the npm development installation also contains CJS/type/readme files.
Selection is conditional on the fixed correctness/performance and artifact gates.

[Published Python package metadata](https://registry.npmjs.org/@lezer%2fpython/1.1.19)
and [maintainer repository](https://code.haverbeke.berlin/lezer/python) establish
provenance. The repository moved from GitHub; its archived mirror is not evidence
that the package is abandoned. [Lezer's system guide](https://lezer.codemirror.net/docs/guide/)
describes its editor recovery model; the adapter explicitly scans `type.isError`
and never accepts recovered symbols. Offset behavior was also checked against the
installed `@lezer/common` and `@lezer/lr` entrypoints and raw-text fixtures.

The alternative considered was [`web-tree-sitter` 0.27.1](https://registry.npmjs.org/web-tree-sitter/0.27.1)
with a Python WASM grammar. Its initialization and binary loading would introduce
another lifecycle boundary; native bindings instead add platform packaging. Neither
is needed for this bounded synchronous declaration pilot. It was not installed or
benchmarked, and no relative performance superiority is claimed. L4's two-parser
benchmark requirement does not become a claim that both Python alternatives ran.
A Python `ast` subprocess was rejected because it adds a host interpreter/version
contract and violates the no-extra-runtime design. No regex language parser is added.

Lezer accepts some legacy syntax and does not validate CPython's semantic/context
rules. Arbitrary decorator expressions and type-parameter defaults are unsupported
examples. Some unterminated strings are tokenized without a recovery node. Zero recovery
nodes are not a validity or Python-version compatibility guarantee. Native ranges
that stop between CR and LF are extended to include LF; raw source is never
rewritten. Fixtures cover this explicit normalization.
Ordinary decorators have no inferred behavior; duplicate property accessors and
conditional declarations are conservatively withheld.

## Corpus and evidence

The real corpus is every `.py` file under `src/flask` at Flask 3.1.2 commit
[`2c1b30d0503cfb064f1cb252e6614a06915a362a`](https://github.com/pallets/flask/tree/2c1b30d0503cfb064f1cb252e6614a06915a362a/src/flask)
(BSD-3-Clause): **24 files, 337,376 bytes**, none excluded by the fixed budget.
Only source text is copied; the project, dependencies and install hooks never run.
`scripts/measure-python-pilot.mjs` verifies each source hash before measuring a
fresh disposable copy. The versioned corpus receipt records file names, hashes and
upstream archive identity. Final artifact measurements and acceptance follow below.

Required checks: focused range/error/ambiguity/cache/live fixtures, differential
legacy JS/typed graphs, complete suite, package and actual-bundle smoke, installed
partial preflight, one real-corpus browser navigation/live-source workflow, and
independent exact-diff review. Rollback is reverting the focused L5 commits before
any separately approved future release; published 1.1.0 stays available.


## Local acceptance results

Measured on Node 22.23.4, macOS arm64, Apple M5. Three fresh-process runs of
**the actual bundle**, each with identical corpus hashes, produced these maxima:

| Measurement | Observed maximum | Fixed ceiling |
|---|---:|---:|
| Cold module loading (separate from index) | 27.72 ms | Recorded, no separate ceiling |
| Cold index | 59.99 ms | 1,000 ms |
| Unchanged index | 4.52 ms | 100 ms |
| One-file update | 5.37 ms | 200 ms |
| Live refresh after edit | 10.84 ms | 200 ms |
| Peak RSS / growth | 93,945,856 / 42,467,328 B | 256 / 160 MiB |

Each result has 389 visible declarations and 11 ambiguity diagnostics; no parser
recovery/limit failures occurred in this fixed corpus. These values do not prove
all Python workloads fit the budgets. [Raw runs](2026-11-01-python-index-results.json)
and [public corpus hashes](2026-11-01-python-corpus.json) make the measurement
reproducible with the developer harness.

Artifact comparison against the publicly downloaded 1.1.0:

- 47 payload files; **2,761,761 raw bytes** including manifest, **+251,782 B**.
- Archive **1,480,577 B**, **+73,338 B**; both deltas meet the frozen ceilings.
- Four additional runtime packages, one new direct dependency.
- Runtime digest `531004ef64492f1320e253c42e683b51e24ac0d3319ab6df16a0cfa4ff5757e0`.
- Selected local archive SHA-256 `627b99099d636bb76c1d51acfbb882373ee62e866e60c39adbb829e4481aa21c`.
- Package version remains 1.1.0 during this unreleased source stage; this different
  candidate digest must never replace the published 1.1.0 archive. A future release
  requires its own version/preparation and owner approval.

Validation: **180/180 tests**, including 13 Python tests and the existing JS/typed,
source, inventory and installation suites. **24 complete legacy graph comparisons**
against the published 1.1.0 matched (only generation timestamp and parse duration
normalized). Package construction, **10 actual-bundle smoke groups**, and the
existing **11 published-1.0.3 upgrade/rollback groups** passed. That historical
upgrade harness does not establish a 1.1.0-to-future-release upgrade; this is not a
new release preparation. Smoke verifies isolated ESM closure without ancestor
packages, declaration extraction, no scanned source execution, whole-file recovery
withholding, and installed partial preflight rejection.

Headless Chrome inspected an installed disposable copy of the 24-file Flask
corpus plus its license. It navigated file/area/class/method to `View.as_view`,
displayed checked source, switched Security/Project and observed line **86 -> 87**
after a saved source edit with unchanged camera, selection and binding. Revision
changed; all 25 original hashes were restored, no target dependencies were installed,
and the owned view/browser stopped. Initial browser-helper direct-search navigation
failed on the nested method; explicit navigation through visible class areas passed
without a product change. This is a headless workflow observation, not a manual
visual-design acceptance. Host instruction activation remains unverified.

The first adjacent test run exposed one obsolete `.py` text-only capability
expectation; it was updated to the new explicit capabilities before the full passing
suite. Raw CRLF range fixtures also found a Lezer end between CR/LF, corrected by
the documented one-code-unit extension. The parser's malformed-string tolerance is
retained as a limitation with a regression, not hidden as validated Python.

[PR #8](https://github.com/OnFiala/agent.mind/pull/8) records independent review,
final-head CI and current lifecycle disposition.


### Source-line integration repair

Main and the independent reviewer reproduced **L5-SOURCE-01 (P2)**: the Python
adapter counted lone CR, but HTTP source excerpts split only LF/CRLF and returned
one line for a three-line Python file. The new HTTP regression failed with
`totalLines: 1` versus expected `3`. `sourceExcerpt` now splits CRLF, CR or LF;
LF/CRLF behavior and raw source hashes stay unchanged. The regression covers all
three newline forms, Unicode and actual symbol-to-source line agreement. This
bounded integration correction is part of L5 acceptance, not a parser claim.

After L5-SOURCE-01 repair, all 180 tests, the 10 smoke groups, the 11 historical
upgrade/rollback groups, the 24 legacy comparisons and the same installed browser
workflow passed against the final candidate above. Three actual-bundle corpus runs
were refreshed; all fixed budgets still pass. No existing installation changed.
