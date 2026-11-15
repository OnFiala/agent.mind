# CORE-01: captured HTTP handler writes

Date: 2026-11-15. Status: source candidate, unmerged and unreleased.
The owner authorized this repair, regression tests, documentation, independent
review and a separate PR. Merge, release and real-target upgrades remain outside
this change. Published 1.3.1 is unchanged.

## Problem and contract

The November 15 audit reproduced CORE-01 on main
[`9e6c881`](https://github.com/OnFiala/agent.mind/commit/9e6c881989de885432f921c68f5d789f33e6ee8e).
`serverContracts` skipped nested functions before collecting writes. A captured
URL could therefore be changed while the analyzer still emitted a provider:

```js
import http from 'node:http';
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  function alter() { url.pathname = '/different'; }
  alter();
  if (url.pathname === '/api/x') res.end();
});
// In a separate client file: fetch('/api/x');
```

The old graph reported an HTTP static-contract edge and `current`. Putting the
same write directly in the handler correctly removed that edge. Direct captured
request/response writes had the same omission.

The repair adds mutation inspection for nested functions without treating their
routes or response calls as handler evidence. A direct write to a captured handler
binding invalidates the corresponding provider candidate. Existing unresolved
consumer diagnostics remain visible; a client with no supported provider makes
the graph partial under the existing policy. No new graph schema or diagnostic
category is introduced.

Lexical shadowing matters: writing a nested function's own parameter, local variable,
block/catch/loop binding or named function binding must not poison a different outer
value. Function parameter defaults are inspected separately from body declarations.
Nested declarations do not become outer URL binding candidates.

This is deliberately conservative. A captured write is considered even in a function
that is never called or after the apparent route check; there is no execution-order
proof. Alias mutation, side effects of arbitrary calls, framework routing, runtime
dispatch and whole-program data flow remain outside the supported analysis. Source
fixtures are parsed, never executed to infer their behavior.

## Validation

Validated locally on macOS / Node.js 22.23.4:

- Three new regression groups cover 84 captured-write scenarios, 19 local-shadow
  controls and four nested-route/response/header evidence controls. They include
  assignment, updates, destructuring, loop targets, delete, deeper closures,
  parameter defaults, block/catch/loop/switch scopes and named class/function scopes.
- The new captured-write regression fails on the original analyzer (one unexpected
  HTTP edge) and passes after the repair. The focused code-index and source-analysis
  performance suites pass 75/75 checks. Passing those existing performance guards
  is not a claim of a measured performance improvement.
- A separately authored 24-case pure-analyzer corpus finds 14 false-provider
  mismatches on the original analyzer and zero on both this source candidate and
  the actual bundled analyzer. The remaining cases preserve valid shadowed/local
  bindings. None of these source samples is executed.
- `npm test`: 343/343 pass, no failures, skips or cancellations.
- `npm run package`: 47 allowlisted payload files; all manifest and payload hashes
  independently match the candidate source. Dependency pins, artifact schema and
  source version are unchanged.
- `scripts/smoke-release.mjs` against that actual bundle: all 12 groups pass,
  including disposable install/context, loopback/source, binding, conflict and
  cleanup checks.
- Syntax checks and `git diff --check` pass.

[PR #24](https://github.com/OnFiala/agent.mind/pull/24) owns the final reviewed
commit, documentation-delta disposition and CI results. Local checks do not establish Linux/Node 24 CI success. Candidate artifact
digest is `c8fc579466e0b025b88bd2de9ebd5ea0040fe3f18c8e5c8505182563ec475778`;
archive SHA256 is `b0d1c875359454b2528ed46981db86982bc7215923d4b13716f817f3df4efedd`.
These identify local validation bytes, not a published release or target upgrade.

Development context retains the repository's existing oversized-wordmark partial
warning. This source repair does not bypass preflight or alter inventory policy.
No browser appearance, real-target host instruction activation or performance
improvement is claimed by this analyzer change.

## Independent review and source CI

Independent review accepted implementation commit
[`5a95c115`](https://github.com/OnFiala/agent.mind/commit/5a95c1156854b811c9aae6ad5c59e48d9cdc3656)
against the stated base with no supported actionable finding. All five changed
files and every changed hunk were reviewed. The reviewer reran the 75 focused checks,
derived a separate 33-case differential corpus with no mismatches, and independently
matched all 47 bundle payloads and the archive hash to this candidate. A wide
nested-closure probe also completed within the existing tested resource boundary;
this is not a general throughput or latency guarantee.

[CI run 43710561942](https://github.com/OnFiala/agent.mind/actions/runs/43710561942)
passed on that exact implementation commit for Linux / Node 22 and 24, including
full tests, package smoke and upgrade/rollback from five published versions.
This run does not establish CI for a later commit; the PR records the final-head
run and review of any subsequent documentation-only delta.

## Rollback

Revert the bounded CORE-01 source commits before any future release. This restores
the known false-provider behavior; it does not change existing installations,
runtime pins, user maps, bindings or recovery data. No dependency, version,
installation format, UI state or persistent project data migration is involved.
Read-only review is procedural under the session's inherited permissions, not proof
of an independently enforced read-only sandbox.
