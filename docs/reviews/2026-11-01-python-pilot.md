# Python syntax-inspection pilot — L5

Status: acceptance contract recorded before dependency selection or implementation.
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

Pending primary-source investigation and measurements. Compare the smallest
maintained portable synchronous parser against an alternative architecture; do not
add a registry, language pack manager or worker merely for this pilot.

Required checks: focused range/error/ambiguity/cache/live fixtures, differential
legacy JS/typed graphs, complete suite, package and actual-bundle smoke, installed
partial preflight, one real-corpus browser navigation/live-source workflow, and
independent exact-diff review. Rollback is reverting the focused L5 commits before
any separately approved future release; published 1.1.0 stays available.
