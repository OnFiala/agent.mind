# R06: bounded project exclusions

Date: 2026-11-15. Base: `73e892d0d8f36bcb19b1b789931de9e4d2edc291`
(the merged R05 contract). Status: **source candidate, unmerged and unreleased**.
The owner authorized implementation, tests, documentation, CORTEX and a standalone
PR with independent review. Merge, release and real-target changes are excluded.
[ROADMAP](../../ROADMAP.md#r06--project-exclusions) owns stage status; the PR owns
exact reviewed commit/disposition and CI receipts. Published 1.3.1 is unchanged.

## Result and boundaries

The [R05 contract](2026-11-15-input-policy.md) remains authoritative for grammar,
limits, precedence and privacy. `code-index.mjs` now loads and validates only the
root `.gitignore`, applies soft root `dist/build/venv` defaults after hard guards,
and finishes bounded inventory/matching decisions before source or naming reads.
Invalid policy yields an empty partial graph with a fixed safe diagnostic.
Nested ignores are reported without reading them; project/Git code is never run.

Identity includes exact policy bytes/state, dialect/defaults and canonical indexing
options. It enters revision, full/bounded context and source-node authorization.
Source reads recheck policy, membership and existing path/hash boundaries before
and after reading. Parsing can be reused only for freshly admitted, hashed files;
newly excluded entries do not enter the next cache. Retained source IDs stay stable.

Naming metadata obeys the same soft rules and hard guards, apart from the exact
installed control-map exception. Serialized metadata and derived projections filter
excluded members and labels. Invalid maps retain safe diagnostics and fail strict
preflight. Eligible source text, including an independently eligible source-mode
map, stays unredacted; exclusions are not secret-content detection.

Live refresh/API requests observe policy independently of the polling interval.
A changed/invalid policy clears the last graph, metadata and change history before
replacement, including when replacement fails. Source HTTP requests and responses
carry policy/revision identity; browser cache, pending requests, DOM projections
and late snapshots cannot reuse an observed retired policy generation.

No module was added to the release runtime shape: older artifact verifiers retain
their file-set contract. No dependency, stored setting, descriptor schema, runtime
pin, sensitive-name exception or source-priority ordering change is included.

## Verification

Local Node 22 checks use synthetic disposable fixtures and loopback only:

- 389 tests pass, including 77 focused index/policy tests, client cache/order guards,
  API graph/context/source/SSE and policy-change/refresh-failure recovery.
- Policy tests exercise exact byte/line/work limits, Unicode/anchoring/negation,
  no-open spies, hard-negative controls, metadata exclusion, missing/empty identity,
  unchanged-mtime edits, in-read invalidation and cold/warm agreement.
- The full-output serialization oracle deliberately changes for the additive policy
  fields/root-only scope notice. Default full output and bounded opt-in remain;
  existing pagination/wire budgets, CommonJS/Python disclosure and lifecycle tests pass.

Produced-bundle installed CLI smoke, browser evidence and independent exact-diff
review are completion requirements. The PR records their final results; source unit
tests alone do not establish these layers. Initial integration caught and corrected
missing overview diagnostics after safe metadata rejection and an outdated pre-R06
serialization oracle; the final full suite above includes both corrections.

## Limits and rollback

Checks apply at observed read/refresh boundaries. There is no filesystem lock,
atomic snapshot, guaranteed revocation latency or erasure of delivered data.
Restrictive v1 grammar intentionally rejects common full-Git patterns such as `**`;
the tool neither rewrites them nor pretends to honor a parsed prefix.

R07 is not included: many eligible assets can still consume the original inventory
budget before later source. Existing 1,000-file/10,000-entry/depth/byte boundaries
and strict global preflight remain. Self-indexing can remain partial for existing
oversized assets; that is not a successful strict preflight. Source/bundle fixtures
do not establish behavior on arbitrary projects, other browsers or real installs.

Before merge, withdraw this candidate with no effect on main or installed targets.
After separately authorized merge, use a reviewed revert of that exact change;
after a separately authorized release, use the existing pinned runtime rollback.
The older runtime does not honor this new policy, so rollback changes its exclusion
behavior. Preserve the target `.gitignore`, naming map, descriptor, binding and all
excluded source/files. No data migration or cleanup is needed or authorized.
