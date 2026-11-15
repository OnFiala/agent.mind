# R05: input policy and sensitive-file protection

Date: 2026-11-15. Source baseline: `dfdec93244d2fb83380cbdf813c5c4401f4336a2`.
Status: **documentation candidate; no runtime implementation**. The owner authorized
this contract, a standalone PR, independent review and the project memory update.
Merge, R06/R07 implementation, release and target upgrades remain separate actions.
[ROADMAP](../../ROADMAP.md#r05--input-policy-and-sensitive-file-protection) owns
priority/status. The PR owns the exact reviewed commits, review disposition and CI.

This is the proposed contract for a later R06 implementation. Neither current main
nor published 1.3.1 implements root-ignore policy. A merged design document would
not change an installed runtime. All acceptance cases below are future requirements,
not claims that tests have run or the protections have been implemented.

## Current behavior and problem

At the baseline, `code-index.mjs` owns inventory, exclusions and safe source reads.
`indexingPolicy()` accepts `generic`, `excludePaths` and `metadataPath`; it does not
read `.gitignore`. Generic mode excludes `.git` and `node_modules` at any depth;
source mode also excludes `backups`, `evidence`, `workspace`, `legacy`, `coverage`.
Both modes reject hidden/sensitive path components, symlinks and special files.
Installed mode supplies exactly `excludePaths: ['agent.mind']` and
`metadataPath: 'agent.mind/project-map.json'` through `resolveInstallation()`.
The selected naming map is read separately from ordinary inventory.

`inventory()` admits eligible regular files before content reads and analysis;
PR #25 fixes the exact file-count boundary, not source prioritization. Generated
files can still consume the inventory budget ahead of useful source. The existing
`sensitive()` basename guard also excludes legitimate `env.mjs`, `credentials.mjs`
and `secret_manager.mjs`. This contract addresses input selection without weakening
that privacy boundary. R07 will separately address ordering after filtering.

## Invariants and authority

- Scanning never executes project code, Git commands, configuration scripts or
  plugins. It neither changes files nor inspects Git's tracking database.
- The root `.gitignore` remains project-owned read-only input. No writer, new stored
  setting, CLI override, dependency or field in managed `project.json` is introduced
  by this design. Preserve runtime pins, ownership, adoption, bindings and conflicts.
- Keep all existing real-path, component, no-follow, inode, regular-file, bounded
  byte-read and indexed-hash checks. An extension or language capability grants no
  exemption. File/symbol identities and graph meaning are unchanged for retained
  source; changed membership and policy identity may change the graph revision.
- Keep inventory, semantic analysis and freshness distinct. Intentional exclusions
  describe limited scope; unsupported analysis and actual errors/limits still make
  the graph partial and fail the existing project-wide strict preflight.
- This is a filename/path policy, not a secret detector. An innocently named source
  file can contain secrets. No content-based credential inspection is added.

## Policy sources and precedence

R06 uses one root-ignore policy in both source and generic modes. The following
order is normative; later rules cannot override an earlier hard denial.

| Order | Rule | Effect |
|---|---|---|
| 1 | Unsafe root/path, symlink component or special file | Reject without reading target bytes; no traversal outside root |
| 2 | Hidden or sensitive component; existing mode-specific excluded directory | Hard denial at any depth, including `.git` and `node_modules`; no negation bypass |
| 3 | Existing exact `excludePaths` | Hard denial of that path and descendants; the installed `agent.mind/` subtree stays excluded, not every directory containing that spelling |
| 4 | New built-in directory defaults `/dist/`, `/build/`, `/venv/` | Soft exclusions at the project root only, in both modes |
| 5 | Valid root `.gitignore` rules in file order | Last matching rule decides among soft exclusions and otherwise eligible paths |
| 6 | Existing entry/depth/file/byte budgets and language capabilities | May further restrict inventory/analysis; inclusion never raises limits or enables unsupported analysis |

The defaults are a documented convention, not proof that directories are generated.
A legitimate root `build/` may be re-included by `!/build/`; a nested
`src/build/` is not excluded by the default. No new blanket `vendor`, `target`,
`out`, `data` or language-specific environment inference is introduced.

An excluded directory is pruned before opening it. A negation for a child alone
cannot restore its excluded parent. To retain only `build/keep.js`, the root rules
are `!/build/`, `/build/*`, `!/build/keep.js`, in that order. These rules still cannot
restore a hard-denied component. Excluded descendants are not enumerated or counted
as if inspected. Parent directory enumeration still consumes the entry budget.

### Root-ignore dialect v1

The only new control input is the exact root `.gitignore`. Nested `.gitignore`,
`.git/info/exclude`, user/global excludes and Git attributes are not loaded.
Inventory must report a bounded count and visible boundary for each encountered
nested `.gitignore`, without reading it, plus an informational root-only scope
limitation. Nested files below a pruned directory are unknown, not counted.
Rules apply equally to tracked and untracked files because Git state is not read.

The subset follows the stated anchoring and negation concepts in the
[Git ignore manual](https://git-scm.com/docs/gitignore#_pattern_format), but does
**not** claim complete Git compatibility:

- Decode strict UTF-8; reject BOM, NUL and controls except line endings. Accept LF
  and CRLF, with no implicit final newline; reject bare CR. Empty lines and lines
  starting with `#` are ignored. Leading spaces are literal; remove trailing ASCII
  spaces as Git does. Tabs and escapes are unsupported.
- An optional initial `!` negates a rule. First remove a trailing `/` as the
  directory-only marker; without it a rule matches regular files or directories.
  Then a leading `/` or an interior slash anchors the remaining pattern to root.
  Without either, match basenames at any traversed depth: `generated/` matches
  directories at root and below, while `/generated/` matches only at root.
  Match case-sensitively, preserving Unicode code points and filenames without
  normalization or host case-folding.
- Support literal components, `*` (zero or more non-slash code points) and `?`
  (one non-slash code point). For v1, reject `**`, any backslash, `[` or `]` in an
  active pattern. No character classes, escapes, globstar, regex or brace expansion
  is interpreted. Braces and parentheses are ordinary literal filename characters.
- Reject a bare `!`, bare `/`, empty interior component, or literal `.`/`..`
  component. Validate every active rule, including rules that appear unreachable
  or would match a hard exclusion. Never silently drop an unsupported pattern.
- A directory match governs its entire subtree by pruning, subject to parent
  re-inclusion above. Evaluate the whole ordered rule list for a directory before
  choosing whether to traverse it. Matching never opens a candidate's contents.

This small dialect is intentionally restrictive: common files containing `**` or
character classes will require a separately reviewed dialect extension or an
owner-edited compatible policy. R06 must not rewrite the file or suggest that an
unsupported rule was honored. The grammar/version is part of policy identity.

### Bounds and failure behavior

The loader permits at most 65,536 raw bytes, 1,024 logical lines (a final newline
terminates the last line), and 1,024 UTF-8 bytes per logical line before trimming.
Comments and blank lines count. Load at most the original size plus one sentinel
byte, with the same change-during-read checks as source; reject oversize before
reading contents where the observed size already exceeds the cap.

Matching must use a bounded non-backtracking algorithm. Charge each visited
pattern/candidate state or literal comparison against one deterministic limit of
8,000,000 work units per scan (including directory decisions); check before doing
work beyond the cap. Compilation/parsing is bounded by the byte/line limits.
One source-read request has the same work cap, not a separate cap per ancestor or
rule. Counters are deterministic and independent of filesystem enumeration order
where that order is otherwise within supported traversal guarantees. These are
work/input bounds, not latency, memory or denial-of-service guarantees.

Missing `.gitignore` is valid and distinct from an empty file. A symlink, directory,
special file, unreadable input, encoding/grammar failure, size/line/work overflow or
observed concurrent edit is an **invalid policy**. Do not use a parsed prefix,
previous valid policy or default-only fallback. Finish policy validation and all
inventory policy decisions before opening ordinary source or naming-map contents.

Return an explicit partial/error result with no source-derived nodes, relations,
symbols, snippets or naming metadata. Strict preflight and source reads reject.
A fixed diagnostic code/reason, input location `.gitignore`, safe line number and
bounded counters are sufficient; never echo raw lines, patterns or file contents.
A policy failure is different from valid intentional exclusions. A later valid
fresh scan may recover. Do not serve an older graph as current on failure.

## Sensitive files and control-plane reads

Keep the existing case-insensitive `sensitive()` guard unchanged for R06, applied
to every component before opening a file or descending into a directory:

- `env` at the existing start/dot boundary followed by end, dot or hyphen;
- `id_rsa`, `id_dsa`, `id_ecdsa`, `id_ed25519` with the existing suffix boundary;
- `secret`, `secrets`, `credential`, `credentials` as existing dot/underscore/hyphen
  delimited tokens;
- `.pem`, `.key`, `.p8`, `.ppk`, `.p12`, `.pfx` at the existing suffix boundary.

This describes the current code, not a broader promise to detect every credential
name. Keep case/substring negative controls when implementing. `env.mjs`,
`credentials.mjs` and `secret_manager.mjs` therefore remain excluded, including
when matched by `!` or referenced by a naming map. There is **no accepted sensitive
source-name exception in R05/R06**. A future proposal needs explicit scoped opt-in,
an exact allowlist, text/snippet/metadata disclosure rules, direct-read parity,
revocation/cache invalidation and independent privacy review. Structure-only
analysis is still a byte read and cannot be treated as a privacy exemption.

Two narrow control-plane cases must not become general include mechanisms:

1. The root `.gitignore` is read only by the bounded policy loader despite its
   hidden name. It is never a source node, text-read target, snippet or raw context
   field. Expose its state and digest, not its contents or patterns.
2. The already selected `metadataPath` may bypass only the exact managed
   integration-subtree exclusion when it is the installed naming map. It cannot
   bypass sensitive/hidden components, unsafe paths or root-ignore rules. Ordinary
   source-mode `project-map.json` also obeys soft/default/root-ignore decisions.
   An excluded map is reported as excluded with no hash/content and no fallback
   map; display source-derived names. Exclusion alone is informational. Invalid
   selected metadata retains its existing warning/strict-gate behavior. No new
   metadata location or managed-descriptor field is accepted.

Installed descriptor/binding validation necessarily occurs before the indexer and
retains its separate existing ownership rules. This contract does not treat the
trusted installed runtime as scanned project source or rewrite that lifecycle.

For a normally excluded boundary, the local inventory/context may disclose only
the encountered project-relative path, entry kind and fixed exclusion reason.
These names are not anonymized. Do not read excluded bytes to obtain hashes,
sizes, symbols, imports, snippets or inferred metadata; directory-entry facts are
sufficient. Do not enumerate descendants or follow links to describe their target.
Derived naming projections must not resurrect excluded entries or disclose their
stored labels through overview/context or `metadata.configuration` in graph/SSE;
filter serialized metadata as well as visible cards. This is not a confidentiality
guarantee for independently eligible source text. In source mode, an eligible
`project-map.json` remains directly readable as text or an excerpt and may disclose
its own stored labels and references to excluded paths. The installed map remains
control-plane-only because the integration exclusion still denies general source
reads. Other included source may likewise mention excluded names or contain secrets;
this policy does not redact eligible source text. No new telemetry/upload surface
or source-mode map-reading restriction is introduced.

## Identity, caching and revocation

A policy identity covers dialect/version, mode and built-in sets, canonical exact
`excludePaths`, selected `metadataPath`, root-ignore state and exact-byte SHA256
when successfully read within bounds. Missing, empty, valid and invalid states are
distinct. A comment-only or line-ending edit changes identity. Invalid/oversized
contents need not be read or hashed to identify failure; an invalid identity can
never authorize reuse, continuation, preflight or source access.

Include this identity in graph revision and all derived graph/context/page cache
keys. A policy change invalidates previously issued revisions, cursors and preflight
receipts even if the selected file's bytes are unchanged. Source IDs remain stable.
Recompute membership, dependencies, diagnostics, naming projections and inventory;
never restore a node from an old graph merely because its content hash matches.
A pure parser result may be reused only after the current scan independently admits
and hashes that same file; discard cached contents/results for newly excluded files.

`readIndexedSource` and every HTTP/CLI source route must validate current policy
independently of polling. An old node/hash, delayed LiveIndex refresh, unchanged
mtime or already open UI view cannot grant access after a policy edit. Read bounded
policy before source bytes and again before returning them; require the request's
snapshot policy identity to match both observations, verify current membership,
and retain path/inode/text/hash checks. Any observed change/failure rejects without
returning the source body. Hash policy bytes, do not rely on size/mtime alone.

At a refresh that observes a changed or invalid policy, immediately invalidate
retained source projections, naming metadata, page caches and source-panel content;
do not publish old snippets via a stale snapshot, SSE payload or change history.
A failure after invalidation may expose safe failure/scope information only.
Late/in-flight responses from older policy generations must be discarded by the
client. Valid exclude-only changes must publish a new state even with no source
hash change. Browser camera/selection identifiers may survive; excluded labels and
text must not. Recovery requires a fresh policy-consistent snapshot.

This is verification at observed read/refresh boundaries, not a filesystem lock,
atomic filesystem snapshot, guaranteed revocation latency or erasure of data
already delivered to a user. A later edit can occur after the final check. This
limitation must remain explicit; do not advertise race-free prevention.

## Decision table and future acceptance

Use synthetic disposable fixtures with sentinel contents, filesystem-operation
spies and negative controls. Do not read real credentials to validate the policy.

| Case | Required result / evidence for later R06 |
|---|---|
| No root ignore; empty root ignore | Defaults active in both; distinct identity; root control input never appears as readable source |
| `/generated/` vs `generated/`; `a/b` vs `b` | Root-relative versus basename-any-depth behavior: `generated/` excludes root and deep directories, not regular files of that name; `/generated/` excludes only the root directory; retain case controls |
| `*.log`, `file?.js`, literal Unicode | Defined wildcard behavior and no normalization; deterministic positive and negative matches |
| Default `dist/`, `build/`, `venv/`; `src/build/` | Root directories pruned without content reads; nested legitimate directory remains eligible |
| `!/build/`; `/build/*`; `!/build/keep.js` | Parent re-inclusion works; child-only negation below excluded parent does not |
| `!.env`, `!env.mjs`, `!credentials.mjs`, `!secret_manager.mjs` | Hard guards win, including case variants and sensitive ancestor; spies prove no open/read, no derived bytes/hashes/snippets |
| Installed `agent.mind/`, `agent.mind-copy/`, nested names | Exact integration subtree excluded; unrelated names eligible under ordinary policy; only exact installed naming map has the documented control-plane exception |
| Excluded map or map member; ignored control input | No fallback map or excluded node/label in derived metadata/graph/SSE; no source access to an excluded map or installed control map; map exclusion is visible |
| Eligible source-mode map naming an excluded member | Derived projection withholds that member/label; direct text and excerpt reads still return the eligible map's own bytes unredacted, including the stored label |
| Symlink root/input/file/ancestor; FIFO/device | No target-byte reads, no blocking special-file open; fixed reason and safe boundary information |
| Nested ignores; tracked path named by root pattern | Nested contents never opened; root-only limitation visible; tracked status grants no exception |
| Unsupported `**`, brackets, escape; malformed/invalid encoding | Entire policy invalid, no prefix fallback or raw-rule echo; no source/map reads or old-data response |
| Exactly byte/line/work limits and one beyond | Deterministic acceptance at limit; explicit failure above; no raised scan budgets |
| Ignore-only/comment-only/CRLF edit, missing-to-empty, same-size/same-mtime edit | New policy identity/revision, cold/warm agreement, stale page/receipt/source rejection |
| File newly excluded between scan/read; policy invalidated during read | Old node/hash cannot return body; unchanged eligible negative control still works; no cached or late UI/SSE resurrection |
| Valid policy restored after failure | Fresh snapshot recovery, no reuse of invalid authorization or hidden old contents |
| 1,000/1,001 eligible files; entry/depth/byte exhaustion | Preserve CORE-02 boundary and existing partial/strict failures; unscanned descendants never counted as excluded/inspected |
| 1,005 JSON files before small `src/` | Record current R06 limitation; prioritization and its acceptance belong to separate R07, with no cap increase |

R06 must verify the actual installed CLI and produced bundle as well as the source
indexer/API: exclusion, failure, recovery and stale reads cannot differ by entry
point. Relevant regression tests must preserve supported ESM/Python evidence,
CommonJS disclosure, strict gate, bindings and untouched target files. R06 changes
are not ready based on this design review alone.

## Sequencing, validation and rollback

R05 changes only this contract and ROADMAP navigation/status. Review verifies
source-grounded current-state statements, precedence, decision-table consistency,
privacy/invalidation paths and links. Record exact commit/diff identity and
independent disposition in the PR. CI may run existing tests/package/smoke checks;
those establish baseline regression health, not implementation of this contract.

R06 is a separately authorized implementation of this contract. R07 follows R06
and changes budget ordering only. Sensitive exceptions, full Git compatibility,
portable settings, new resolver modes and scoped preflight need separate decisions.

Before merge, withdraw the design candidate. After a separately authorized merge,
revert only the R05 documentation change using the actual merge identity. There is
no runtime rollback, config migration, target mutation or data deletion in R05.
A later R06 rollback must preserve the owner's `.gitignore`, descriptor and files;
returning to the old indexer also restores its absence of ignore-policy protection,
so that consequence must be stated in its separate approval and release record.
