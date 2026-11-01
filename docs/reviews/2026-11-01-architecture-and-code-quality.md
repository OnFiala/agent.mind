# Architecture and code-quality review — 2026-11-01

**CURRENT FIT** for the shipped small local JavaScript/ES-module visualizer.
**UNDERFIT PRESSURE** for a broader language-independent inventory and analysis.
The evidence supports small fixes and incremental boundaries, not a rewrite.

Reviewed baseline: [`56f2eff7a6053d0f784cb8caa54dcff85bef8625`](https://github.com/OnFiala/agent.mind/commit/56f2eff7a6053d0f784cb8caa54dcff85bef8625), version 1.0.3.
This is a point-in-time assessment. [ROADMAP.md](../../ROADMAP.md) owns proposed
follow-up work and statuses. Neither document claims that those changes shipped.

## Scope and method

Three independent agent passes examined core architecture, installation/lifecycle,
and code quality. The integrator checked findings against the source and separate
bounded probes. A separate review of the resulting documentation is required before
the PR is marked ready. Review is evidence of the examined scope, not certification.

The core pass inspected inventory, parser/resolver boundaries, live reconciliation,
context, hierarchy and naming metadata. The installation pass inspected installer,
packager, lifecycle tests and one existing pinned artifact. The code-quality pass
read the renderer, shared hierarchy, server, live index and UI tests, plus relevant
source-read and hierarchy construction paths. No complete security audit, historical
secret scan, cross-platform audit or new performance benchmark was performed.

Read-only was procedural under a broader writable environment; OS-enforced read-only
isolation was not demonstrated. No source, target installation or production state
was changed by the audit. Disposable fixtures were removed and timers closed.

## Baseline and boundaries worth preserving

- 35 tracked files; 22 JS/MJS files, comprising 10 test files and 12 non-test files
  (the latter include build/smoke scripts). One production dependency: pinned Acorn.
- One local engine and one derived graph feed both the browser and agent context.
  Source owns relationships; project-map metadata owns names and membership.
- Source reads check allowed paths, real paths and indexed hashes. Unknown calls
  remain unresolved; static Security/Testing views do not assert vulnerabilities,
  test success or coverage.
- A target receives one agent.mind directory and, with explicit attachment, one
  managed AGENTS block. Its package manifest, lockfile and dependency tree remain
  untouched. Runtime dependencies are bundled and pinned inside that directory.
- Exact artifact allowlists, local binding identity, conflict-preserving cleanup,
  explicit adoption/rebind and separate purge are useful safety boundaries.

An existing 1.0.3 artifact with digest
`ffcf92c345d0bd2d6ad6082dc546947e36b6e0e9b7f0b79d107e236434a8db28`
passed verifyArtifact. Its installed status was attached, integrity verified, no
conflicts and no active view. Host instruction activation remained not-verified.

| Measured item | Files | Logical bytes |
|---|---:|---:|
| Runtime, including manifest | 30 | 1,961,007 |
| One complete attached installation, including its small recovery record | 37 | 1,972,594 |
| Allowlisted runtime payload, excluding manifest | 29 | 1,958,022 |
| Artwork subset of that payload | 2 | 1,057,220 |

These are uncompressed measurements of one installation, not a future size bound.
User maps, unknown files and retained recovery data vary. The wordmark alone is
906,054 bytes; that is a more concrete footprint opportunity than a global cache.

## Findings

Priorities describe practical impact. A documented limit becomes a correctness
problem only if the product begins promising the currently unsupported behavior.

### UI-01 — P2: source pagination skips lines

**Evidence:** [Next lines](https://github.com/OnFiala/agent.mind/blob/56f2eff7a6053d0f784cb8caa54dcff85bef8625/public/visualizer.js#L1362)
requests last + 20; [sourceExcerpt](https://github.com/OnFiala/agent.mind/blob/56f2eff7a6053d0f784cb8caa54dcff85bef8625/server.mjs#L24)
starts eight lines before the requested position. A separate disposable 300-line
fixture through the exported API returned 1–71 followed by 83–153: lines 72–82 were
skipped. The probe used trusted analyzer APIs and never executed fixture source.

**Impact/confidence:** ordinary sequential source reading misses content; high.
**Smallest response:** request the first unread line, or provide an explicit cursor;
test that successive excerpts cover the complete file without gaps.
**Disposition:** accepted, open; fix before adding source-view capabilities.
**Preserve:** hash validation, safe source access and useful context overlap.

### UI-02 — P3: a symbol card can retain its old line number

**Evidence:** [card signature](https://github.com/OnFiala/agent.mind/blob/56f2eff7a6053d0f784cb8caa54dcff85bef8625/public/visualizer.js#L889)
omits node.line while the guarded [footer rendering](https://github.com/OnFiala/agent.mind/blob/56f2eff7a6053d0f784cb8caa54dcff85bef8625/public/visualizer.js#L899)
uses it. Moving an otherwise unchanged symbol can leave the same signature and
skip footer reconstruction. The default symbol description contains kind/name,
not its position. Two source inspections support this path; a browser reproduction
was not run in this audit.

**Impact/confidence:** source panel and card can disagree about location; high
confidence in the missing invalidation dependency, browser behavior not separately
measured. **Smallest response:** include rendered position in invalidation and
verify a real card update after moving a symbol.
**Disposition:** accepted, open; can share the focused UI-01 repair PR.
**Preserve:** stable node IDs, camera, selection and manual positions.

### CORE-01 — expansion blocker: inventory depends on parser eligibility

**Evidence:** [inventory dispatch](https://github.com/OnFiala/agent.mind/blob/56f2eff7a6053d0f784cb8caa54dcff85bef8625/code-index.mjs#L165)
and [source reads](https://github.com/OnFiala/agent.mind/blob/56f2eff7a6053d0f784cb8caa54dcff85bef8625/code-index.mjs#L113)
use a fixed extension set. Unsupported paths lack source-content hashes. A synthetic
helper.ts edit left the graph revision and live sequence unchanged, with zero state
events; changing the supported main.mjs emitted one event. The integrator separately
confirmed unchanged revision after changing unsupported text.

**Impact/confidence:** the existing live view cannot promise freshness for a whole
mixed-language project; high. This is a documented current limit, not a new bug
against the advertised JS-only scope.
**Smallest response:** separate safe bounded inventory/fingerprint from analysis.
**Disposition:** prerequisite for the broader product promise.
**Preserve:** exclusions, symlink policy, file/byte limits and visible uncertainty.

### CORE-02 — expansion blocker: freshness and analysis depth share coarse states

**Evidence:** [graph partial status](https://github.com/OnFiala/agent.mind/blob/56f2eff7a6053d0f784cb8caa54dcff85bef8625/code-index.mjs#L682)
combines unsupported syntax, parse errors and exhausted budgets;
[LiveIndex](https://github.com/OnFiala/agent.mind/blob/56f2eff7a6053d0f784cb8caa54dcff85bef8625/live-index.mjs#L47)
can report current after a completed scan. Installed
[preflight](https://github.com/OnFiala/agent.mind/blob/56f2eff7a6053d0f784cb8caa54dcff85bef8625/installation.mjs#L602)
correctly rejects any partial context.

**Impact/confidence:** a mixed-language overview needs to express both current
inventory and incomplete analysis without overstating authorization; high.
**Smallest response:** additive capability/freshness fields with documented meanings.
**Disposition:** pair with CORE-01 before claiming broader support.
**Preserve:** existing strict preflight; do not relabel partial as current to bypass it.

## Engineering maturity

This assesses code and evidence, not the seniority of its author.

| Dimension | Assessment | Evidence / proportionate response |
|---|---|---|
| Correctness and custody | Strong discipline within declared scope | Hash-bound reads, conservative static evidence, binding/conflict checks and explicit recovery limits. Preserve these contracts. |
| Architecture | Appropriate small application | Index/live/server/presentation responsibilities are identifiable; one graph avoids duplicate semantic authority. No service split needed. |
| Readability and change locality | Uneven | Renderer mixes DOM events, synchronization and source controls; several core paths use dense statements. Extract small cohesive helpers when a concrete fix needs them, not a broad style rewrite. |
| Tests | Strong pure-function coverage, thinner integration coverage | Determinism/navigation/identity tests are useful; UI-01/UI-02 sit between UI state, DOM invalidation and server excerpts. Add focused integration regressions. |
| Installation | Deliberate and bounded | One directory, one optional instruction block, pinned runtime. Manual upgrades and host activation remain explicit operational work. |
| Expansion readiness | Incomplete by design | Inventory, capability reporting and a first real second-language adapter need bounded changes. This does not justify a plugin platform in advance. |

The renderer has 1,521 lines, the index 689 and installer 624. Size alone is not a
defect. The actionable concern is whether one behavior change crosses hidden
contracts, illustrated by the two UI findings. Existing tests and safety decisions
show mature engineering intent; integration testability and local readability
should improve before multiplying supported behaviors.

## Installation observations, not release blockers

No supported P1/P2 installation defect was found in this bounded pass. Manual update
steps and recovery using the original release CLI are documented. A read-only
update-plan or stricter readiness command is optional future UX work, justified by
repeated onboarding failures rather than added pre-emptively. Attached must remain
separate from actual host instruction activation. Status JSON needs inspection even
when the process exits zero. Retained recovery is not disposable cache; purge is
explicit, and crash/power-loss transactionality is not claimed.

## Validation and limits

- Independent pure UI helper tests: node --test test/visualizer-ui.test.mjs,
  Node 22.23.4, 30/30 passed. They did not prove the two UI integration cases.
- Independent sourceExcerpt fixture reproduced UI-01. Separate source inspection
  confirmed UI-02's omitted signature dependency; no browser execution claim.
- Disposable index/live probes reproduced CORE-01. Scanned files were never run.
- An extracted-expression evaluation was rejected by the execution safety review
  before running. It was not retried; the integrator used exported APIs and source
  inspection without eval/new Function as the narrower alternative.
- Artifact integrity and attached status were checked on an existing pinned runtime;
  no install, update, purge, server or full test suite was run by this audit.
- Architecture Compass outputs were treated as heuristics: they counted only one
  source file, omitting .mjs from that count, and flagged installation example paths
  as missing tracked files. Those outputs do not establish documentation drift or
  architectural weakness. Manual source evidence takes precedence.
- This report adds no runtime fixes. A later implementation PR must bind its own
  checks and independent review to its exact diff/commit.
