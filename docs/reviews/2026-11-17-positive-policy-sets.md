# P1: positive character sets in the root input policy

Date: 2026-11-17. Base: `57c7c883234904bb7ec1aca96d08fea20f1a0bc2`.
Status: **merged; unreleased**. The owner separately authorized P1 implementation
and [PR #37](https://github.com/OnFiala/agent.mind/pull/37) merge. Its exact reviewed
tree was merged as `c80b8aa6a07c9cdbd6930af8114f78d9f7baca2d`; the
[post-merge Node 22/24 CI](https://github.com/OnFiala/agent.mind/actions/runs/44128899552)
passed. P1 implements no R13/R14 behavior. Later R13 work has separate authority;
release and real-target changes remain outside this P1 delivery.
[ROADMAP](../../ROADMAP.md#p1--positive-character-sets-in-the-root-policy) owns status.
The PR owns exact reviewed commits, findings and CI receipts; authorization alone
is not evidence of passing checks or merge completion.

## Contract and ownership

`code-index.mjs` retains policy parsing/matching, inventory and safe reads. The
[R05 contract](2026-11-15-input-policy.md) and
[R06 implementation](2026-11-15-project-exclusions.md) remain authoritative except
for the explicitly versioned grammar addition below. The accepted P1 scope needs
no new dependency, configuration, service, CLI switch, managed-manifest field or
project ignore writer. Parser/resolver/language/UI capabilities remain unchanged.

`root-ignore-v2` accepts nonempty positive sets containing ASCII letters and digits
only: `[cod]`, `[aA09]`, `[c]`. Every member is literal; duplicates and member order
have no matching significance. A set matches exactly one candidate code point.
It cannot match `/`, an empty string or a sequence. Multiple sets and neighboring
`*`/`?` tokens retain their specified meanings. Literal Unicode outside a set keeps
v1 behavior. `*.py[cod]` excludes `.pyc/.pyo/.pyd`, not `.py/.pycc/.pyC/.pyx`.
Non-directory-only patterns may also match directory basenames; trailing `/`
continues to restrict a rule to directories.

Empty/unclosed/nested sets, unmatched `]`, punctuation/non-ASCII members, ranges,
negated/POSIX sets, escapes and `**` invalidate the entire policy. Examples include
`[]`, `[a-z]`, `[!a]`, `[^a]`, `[[:alpha:]]`, `[a/b]`, `[é]`, `[a*]`.
Rule-level `!` remains ordered soft-rule negation; it never changes set grammar.
A malformed rule is invalid even if no observed file could match it. No valid-prefix,
previous-policy, default-only or ignore-bypass fallback exists.

Root-only defaults, anchoring, parent pruning, UTF-8/LF/CRLF/case handling, trailing
ASCII-space removal and comment rules are unchanged. The tool does not execute Git,
read nested/global ignores, inspect Git's tracking database or run scanned code.
This remains a named subset of the broader
[Git ignore syntax](https://git-scm.com/docs/gitignore#_pattern_format).

## Work bounds and safety

Sets compile once into constant-size ASCII membership tables. Compilation is
linear in bounded input bytes, with no regex backtracking or range expansion.
The dynamic-programming matcher charges every state, including the initial row;
one set is one compiled token and membership lookup is constant-time. A match costs
`(compiledTokens + 1) * (candidateCodePoints + 1)` states. Duplicate members do not
change match-time work. The 8,000,000-state limit is checked before visiting the
next state; existing 65,536-byte, 1,024-line and 1,024-byte-per-line bounds remain.
These are input/work limits, not latency or memory guarantees.

Hard exclusions still precede soft rules: unsafe real paths, hidden/sensitive
components, symlinks, special files, mode-specific directories and the exact
installed integration subtree. Negated sets cannot bypass them. Naming metadata
retains only its existing narrow control-plane exception and obeys soft policy.
Invalid policy withholds source/naming data and rejects strict preflight and source
reads. Existing before/after read checks, inode/hash guards, graph/cache/UI
invalidation and stale-response rejection remain unchanged. No lock or guaranteed
revocation latency is claimed, and already delivered content cannot be erased.

## Identity and compatibility

All new summaries and policy-ID preimages use `root-ignore-v2`, even for a missing,
empty or v1-valid ignore file. Membership of v1-valid rules is unchanged; policy IDs
and derived revisions intentionally differ. Old source requests, continuation
cursors and preflight receipts reject; obtain new context. Comment-only and
same-size policy changes still invalidate old identities. No v1 result is reused
under a v2 identity. Existing stable file/symbol IDs and project-owned data remain.

The package version is still 1.4.0 while this implementation is unreleased. A source
build has a different digest from the frozen published 1.4.0 payload, which uses v1.
No published tag/archive is replaced, and no pinned real installation is changed.
All installed-runtime checks below use disposable synthetic targets and the actual
produced bundle, not source-mode claims presented as installation evidence.

## Acceptance and verification ownership

The accepted P1 cases map to these checks; the execution evidence below records
what actually ran. Independent review and CI are separately bound to the exact
commit in the PR rather than inferred from this acceptance table.

| Case | Required evidence |
|---|---|
| P01 | Positive `.pyc/.pyo/.pyd`, negative `.py/.pycc/.pyC/.pyx`; nested and directory matching. |
| P02 | Singleton/multiple/duplicate/case/digit sets; adjacent wildcards, anchors and trailing `/`. |
| P03 | Every unsupported set shape and legacy malformed grammar; fail closed without a matching candidate. |
| P04 | Negation/pruning/defaults and unchanged hard private/path/integration/map boundaries; no excluded opens. |
| P05 | Exact byte/line/line-byte/work caps and +1; compiled-token DP accounting and duplicate equivalence. |
| P06 | v1-valid grammar/membership/IDs/order differential against the original runtime, except declared identities. |
| P07 | Missing/empty/comment-only and v1/v2 transitions; stale source, context and preflight identities reject. |
| P08 | Policy edits, same-size changes, invalidity/recovery, late responses and naming removal preserve existing protections. |
| P09 | Read-only policy recheck of both retained disposable R12 snapshots within the authorized P1 tests; original ignore bytes preserved, remaining partial states retained, no private source published or consumer run repeated. |
| P10 | Actual published v1 → candidate v2 → published v1 disposable installation round trip; unchanged owner policy/source/map and explicit v1 grammar failure after rollback. |

Run targeted policy tests, full `npm test`, `npm run package`, then
`node scripts/smoke-release.mjs /absolute/candidate-bundle`. The dedicated
`smoke-policy-rollback.mjs` accepts absolute original/candidate bundle paths and
pins the published original manifest digest. CI downloads the original archive
with its exact checksum before the round trip. Existing historical upgrade tests
remain. Source contexts before/after, exact artifact hashes and independent review
must distinguish source, produced payload, synthetic installed behavior and CI.
No fresh browser check is inferred from CLI/HTTP/SSE smoke; UI code is unchanged.

## Local execution evidence — 2026-11-17

Validated on Node 22.23.4, using synthetic fixtures and loopback only for lifecycle
checks. The original 1.4.0 artifact was verified against its pinned manifest before
use. No real installation, target service, browser session or scanned code ran.

| Check | Observed result |
|---|---|
| Test-first policy regression | Before implementation: 7 expected failures / 23 tests; final targeted policy suite: 24/24 pass. A case-insensitive filesystem collision in a test fixture was corrected using a distinct basename while retaining the pure case-sensitive negative control. |
| Full suite | 440/440 pass. The first run's sole failure was the deliberately changed v1 identity snapshot; its correction was independently checked against the original runtime, then all tests passed. |
| Bounded-context compatibility | 10/10 pass. The exact 12,704-byte full-context fixture changes only revision, policy version/ID and three source/selection policy IDs; all other values and shape match published v1. |
| Differential matching | 95,506 v1-valid decisions/work counts match the published implementation. 84,510 set decisions match independently expanded v1 literal alternatives. Finite alphabet through length four plus explicit path/suffix cases; not an unbounded proof. |
| Differential graph/source reads | 21 synthetic graph pairs match after removing only declared policy/revision identity and timing/cache counters; 117 old source authorizations reject under v2. |
| Produced bundle | 47 source/payload files match exactly; all 48 archive files match payload, no extra or private workspace files. Manifest digest below. |
| Actual installed bundle | `smoke-release`: 17 groups pass, including set membership, hard denials with current source authorization, CLI/HTTP parity, invalidation, SSE withholding and recovery. |
| Actual versioned round trip | `smoke-policy-rollback`: four groups/eight receipts pass for original v1 → candidate v2 → original v1, with conflict/data preservation, stale receipt refusal, tampered-candidate failure and original-runtime recovery. Input artifacts unchanged; owned views stopped and fixtures removed. |
| Original private input recheck | Both retained whole-project ignore files change from v1 grammar-invalid to v2 valid without a byte edit. Both graphs remain partial due to other analysis/inventory limits. This was read-only indexing, not an installed-target check or a new consumer-benefit evaluation. |
| Source context | Fresh before/after contexts retain the same source owner, expose v1/v2 policy identities and preserve global partial from the existing oversized wordmark. No self-preflight success is claimed. |

Candidate manifest digest:
`63dcffc91f79a788dab8a933c3a8e778e4370cab3968d2da8580a6ff018bbf93`.
Local archive SHA256:
`17a4d6736e80bb27123d0df4f4e83eacb8f5bfd8e8c619f1583a0a970c438b42`.
These identify tested local bytes, not a published asset or a deterministic archive
claim. Within the runtime allowlist only `code-index.mjs` and README differ from
the base; dependencies, language/resolver consumers, UI and installation schemas
are unchanged. Later evidence-only edits to this unbundled record do not alter
the payload. The PR records independent review disposition and actual Node 22/24
CI on its head; local PASS is not a claim that CI or merge already happened.

## Rollback

Before merge, withdraw the PR or revert its scoped commits. After any separately
authorized integration, revert the exact P1 change through review and rebuild.
The previous published 1.4.0 runtime is an immutable rollback target:
manifest digest `74e8af9f4771e7a9443d309f76c1dbc38d3f468d494ce7387a9210082f5c4558`,
archive SHA256 `3567ab254342ddf450901eb479ab565369990375eff5c73093efdb511e0d2609`.
Use each installation's own CLI and the existing backup/uninstall/fresh-install/
map-restore procedure. Preserve conflicts, custom files, descriptors' custody and
project data; never copy an old receipt/runtime/descriptor into a new installation.

Downgrading restores v1's explicit rejection of unchanged `[cod]` rules; it does
not restore a successful graph for that policy. Do not edit the owner's `.gitignore`
or silently switch matching versions. Old bindings/revisions/receipts invalidate
across both transitions. Real-target operations still require separate authority.
