# R14 — finite local file resolution

Date: 2026-11-18. Status: **implementation candidate; unreleased**.
The owner accepted the finite R14 design and authorized a separate implementation
PR with tests, independent review, documentation and a CORTEX outcome. Merge,
release and real installation changes are excluded. R15/R16 remain separate gates.
The PR owns exact reviewed commits, artifact hashes, final checks and CI receipts.

## Contract and ownership

The [README contract](../../README.md#unreleased-local-resolver-r14) is the user-facing
source of truth. Default R13 syntax-only behavior stays compatible. One explicit
per-command `bundler-local-v1` pair selects a bounded strict JSON config and its
parent domain. The mode is neither TypeScript nor Vite resolution. No alias,
package, extension substitution, imported-call, type or runtime inference is added.

`typed-resolution.mjs` is a pure guard/planner/decision helper. `code-index.mjs` owns
all safe reads, explicit directory proof, policy checks, fresh candidate composition
and runtime/config identity. A candidate's missing node is not absence evidence.
Denied candidates/vetoes, incomplete enumeration and actual limits fail closed.
The helper's path budget charges repeated observations; immutable policy-prefix
checks are reused only within one scan, and actual matcher work keeps the existing
root-ignore-v2 limit. No limit was raised.

The original `referenceSyntax` facts/envelope remain unchanged and do not enter
the generic resolver. Separate `referenceResolution` outcomes retain all original
source/declaration/binding ranges and type-only evidence. Resolved edges have stable
file IDs, import/reexport kind, model-relative provenance and all occurrences.
Global partial remains, and strict preflight still refuses typed projects.
R14 is not R11 incoming coverage, R15 scoped preflight or a consumer-benefit result.

Fresh inventory participates in revision; parsing may be cached, resolution is not
cached by origin bytes. LiveIndex checks policy/config before scans, after scans,
on failure and at API/source-read boundaries. Known config changes remove the old
source graph even if replacement scanning fails. Recovery requires agreeing fresh
scans. Raw whitespace changes invalidate config identity. No filesystem lock or
unobserved-concurrent-change guarantee is claimed.

No new dependency, service, persistent config or managed host-instruction change
is introduced. On macOS opt-in reads use `/usr/bin/stat` only for resident metadata,
refusing dataless files before opening them. No scanned code, scripts, compiler,
Vite plugins or package configuration is executed.

## Acceptance evidence

The private original corpus was revalidated against its original per-file manifest
before product changes. An independent worker then froze all expected occurrences,
full syntax/ranges/bindings, candidate/veto evidence and hand-assigned outcomes
before implementation. No live replacement, ignore edit, trimming or budget change
was used. Raw corpus, manifests, source context and discovery notes stay private.

The implementation comparison covers every one of 63 facts: 51 relative (50 stems,
including 40 `.gen` stems, and one CSS resource) and 12 bare references. It matches
50 resolved occurrences and 13 unsupported occurrences, forming 48 unique edges.
Generated: 38/38 resolved. Handwritten: 12/25 resolved, 13/25 unsupported. No
unresolved, ambiguous, blocked, new unsupported-syntax or withheld occurrence was
observed in that fixed corpus. Every emitted target/hash and complete finite
candidate/veto domain matches the preregistered row. Independent final review must
also inspect all positive target decisions and negative categories; the PR records
that disposition. This is a finite observed sample, not universal precision.

Before and after comparison, 118/118 files (2,134,324 bytes, including 28 typed
files) matched the original manifest. The unchanged unrelated 892,013-byte PDF
remains too large; global partial and strict refusal are retained. Config includes
are not used to remove four typed files outside that metadata list.
The whole default graph equals the exact pinned R13 artifact after removing only
generation time, parse timing and cache-hit count. Cold/warm candidate graphs agree.

The first corpus run exposed redundant policy-prefix matching exhausting the
unchanged work cap. Per-scan memoization fixed that without changing the resolver
path budget, and the full frozen-row comparison then passed. A regression fixture
exercises repeated references; another exceeds the scan-wide resolver budget and
requires all resolution outcomes/edges to be withheld while preserving 46,000 facts.

| Accepted cases | Concrete checks |
|---|---|
| V01 | Full default graph differential against pinned R13; opt-in/default zero-edge and invalid-policy identities; unchanged syntax and stable IDs |
| V02 | Installed/development pair parsing, duplicates/missing values/mode/lifecycle rejection, full/agent/section/cursor/preflight/view, no saved mode |
| V03 | Pure strict JSON boundaries and every allowed/rejected key/type/value, duplicates, encoding, bytes/depth/value limits |
| V04–V06 | Exact targets and veto alternatives; ten stem candidates, dot stems, file/index collisions, extension/index nonprecedence, package/declaration/resource negatives |
| V07–V09 | Policy-denied hypothetical paths and raw traversals, symlinks, binary/parse/byte failures, global enumeration limits, unrelated content failures, work exhaustion and unsupported syntax isolation |
| V10–V12 | Warm-cache candidate changes; config change/delete/symlink/deny, source-read/scan races and injected failure, recovery, full bounded fragments and stale mode/config/binding/source identities |
| V13 | Frozen complete oracle, all facts/domains/targets compared, generated stratum and all negative occurrences retained; final independent review recorded in PR |
| V14 | Inspector unit pagination/escaping/identity checks plus actual browser observation of counts, provenance, type-only evidence, uncertainty and selection/camera preservation |
| V15 | Existing strict partial gate, no R11/R15 implementation and no change to default JS/Python/HTTP behavior |
| V16 | Disposable installed R13 → R14 default → opt-in → default → exact R13; stale receipts/source reads, owner/source/map/AGENTS/recovery custody |
| V17 | Explicit runtime allowlist, package source/payload checks, smoke, Node 22/24 CI and pinned R13 rollback |

Independent review found that the first opt-in resident guard did not cover the
existing policy/naming pre-scan reads. The repair applies the same guard before
`.gitignore`, naming map, config and source opens. Simulated Darwin metadata tests
check zero opens for each denied path and positive resident/default controls;
no real cloud placeholder is used. Actual Chrome found clipped evidence hashes
and lost selection during the temporary empty graph on config revocation. Wrapped
preformatted text and an ID-only presentation snapshot repair both. Source/DOM and
listeners are revoked; only selection, layout, camera and navigation preferences
survive for validation against the fresh graph. Policy revocation discards them.
The browser rerun checks pagination, unchanged total evidence under filters,
selection/camera and rejection of a deliberately delayed old source response.

Commands are `npm test`, `npm run package`, `scripts/smoke-release.mjs` and
`scripts/smoke-resolver-rollback.mjs` with the two exact artifact directories.
Unit/CLI tests use disposable fixtures and loopback only. The PR records actual
final counts and unrun/limited evidence; this mapping alone does not assert a run.
Independent reviewers operate procedurally read-only under inherited broader
permissions; technically enforced read-only isolation is not established.

## Delivery and rollback

Base is merged R13 commit `247268e98c36b77eaf279706bc16ef147424a38b`, tree
`8039ecb44eb5cb02cc531ec0e66c6aeb34369721`. The exact unreleased R13 baseline payload
has digest `ad68027479f60777e85059d1d7c75630960ea9f8eb639c207ee5c22625acd25a`.
CI reconstructs it from the pinned source/tree and verifies that digest in the
round-trip harness. This is not the published 1.4.0 payload.

Functional rollback starts a new command/view without the pair. Code rollback
reverts the focused R14 change while retaining P1/R13. An authorized artifact
rollback uses the exact previous artifact and its own installed CLI; modified
owned files, owner map/data and recovery are retained. A published 1.4.0 rollback
would also return its older policy/syntax limits. No release, automatic update,
real-target installation or host-instruction activation is established here.
