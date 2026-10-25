# agent.mind

A live map of your code. See the main blocks, open their files and functions, and
follow the connections between them. Saved source changes update the map.
The same names work in the canvas and in context for your coding agent.

agent.mind reads source files without running your project. It currently analyzes
JavaScript (`.js`, `.mjs`); TypeScript/TSX and framework routing are not supported.
It runs locally, with no global install, account, API key or model required.

**Start with a small project you know.** Try ordinary JavaScript with around
100 analyzed files and a few hundred named functions or classes, then compare the
map with the source. This is a starting recommendation, not a supported-size
guarantee. Dense code can be slow even with few files: a 20-file, 20,000-function
fixture exceeded a 15-second startup deadline in v1.0.1. Version 1.0.2 fixes
that repeated hierarchy lookup; other parsing and rendering costs remain. See
[validation and known limits](#validation-and-known-limits).

**Sending your coding agent here?** Ask it to read [For agents](#for-agents), name
the project you want it to inspect, and state whether you want an explanation,
an installation, or a contribution to agent.mind.

## Install into a project

The current release is **1.0.2**. Existing targets keep their pinned version; use
the explicit update steps below to change it.

Requires Node.js 22 or newer on macOS or Linux. Download
[v1.0.2 from GitHub Releases](https://github.com/OnFiala/agent.mind/releases/tag/v1.0.2):

```sh
mkdir agent-mind-download
cd agent-mind-download
curl --fail --location --output agent-mind-1.0.2.tar.gz https://github.com/OnFiala/agent.mind/releases/download/v1.0.2/agent-mind-1.0.2.tar.gz
curl --fail --location --output SHA256SUMS https://github.com/OnFiala/agent.mind/releases/download/v1.0.2/SHA256SUMS
shasum -a 256 -c SHA256SUMS
tar -xzf agent-mind-1.0.2.tar.gz
node agent-mind-1.0.2/cli.mjs install --project "/absolute/path/to/project" --release "$PWD/agent-mind-1.0.2" --attach
```

Stop if checksum verification fails. Checksums check the downloaded bytes, so
choose the source repository deliberately. The installer also checks the full
runtime manifest and rejects unknown files and symlinks. It will not overwrite
an existing unowned `agent.mind/` directory.

The release includes Acorn and keeps its dependencies inside `agent.mind/`.
It leaves your project's package.json, lockfile and node_modules alone. `--attach`
adds one marked block to the project's `AGENTS.md`, preserving existing instructions.
This is the only integration outside `agent.mind/`.

From your project directory:

```sh
node agent.mind/cli.mjs status
node agent.mind/cli.mjs view
```

Open the loopback URL printed by `view`; it also prints the project identity.
The server runs in the foreground. Stop it with Ctrl+C. It has no public port or
automatic startup. Use `view --port 4317` for a fixed port; if it is occupied,
the command fails.

The local HTTP API has no login or per-user authentication. Other local clients
that can reach the port can read the selected project's indexed source and graph.
Use it on a trusted machine and do not expose it through a tunnel or public proxy.
Filename exclusions are not secret redaction: secrets embedded in ordinary source
files may appear in excerpts or graph evidence.

```text
project/
├── AGENTS.md                  # existing text + one managed block
└── agent.mind/
    ├── README.md              # installed usage and cleanup
    ├── cli.mjs                # stable entry point
    ├── project.json           # project settings and pinned runtime
    ├── project-map.json       # your names, aliases and file groups
    ├── .gitignore             # ignores .local/
    └── .local/                # local project binding and runtime copy
```

You can commit the map and descriptor with your project. Keep `.local/` out of
Git: it belongs to this machine and directory. After moving an installation,
inspect `status` and explicitly `rebind`/`attach` it to the new location.

A fresh clone needs a local installation. Download the same pinned release,
then adopt the existing integration; this preserves your map:

```sh
node /path/to/agent-mind-1.0.2/cli.mjs install --project "/absolute/cloned/project" --release /path/to/agent-mind-1.0.2 --adopt --attach
```

Use the version pinned in the clone's `agent.mind/project.json`, even if a newer
release exists. A clone pinned to 1.0.0 needs the 1.0.0 release.
Adoption requires a recognized launcher and descriptor with the same runtime pin.
Unknown or modified integration instructions cause a conflict and are not overwritten.

## Read the map

- **Left rail:** Whole project, Security and Testing show different views of the same graph.
- **Top bar:** search, index status, zoom, fit and layout controls.
- **Canvas path:** open an ancestor, or use Back to restore its camera, positions,
  selection and expanded areas.
- **Right panel:** source, connections, project scope and recent changes.

Open a block, then a file, then a function or class and its nested parts. A leaf
opens its source; the separate detail control opens source for parents too.
If a source part disappears, navigation returns to its nearest remaining ancestor.

At file and function levels, related parts start in compact area cards. Click a
card to expand it, use its header control to collapse it, or choose **Collapse all**.
**Outside** collects parts outside the current source scope. Expansion stays with
the scope as you navigate and receive live updates within the page.

Lines between areas combine the underlying connections of the same type and
origin. Opposite directions and different types stay separate. Connections inside
an area appear when you expand it. The counts show both displayed lines and
underlying references; collapsing an area does not remove dependencies.

Use **Select** on an area to highlight its connections without expanding it.
Incoming and outgoing lines have different styles and a text legend. Other cards
and lines fade. You can inspect a connector while keeping the area selected;
its details list the contributing source parts, direction and source links.
Missing references are reported. Clear the area focus to return to the overview.

Compact maps show their lines by default. Dense expanded maps offer
**Selected relations** and **All relations**. Hover, keyboard focus and selection
show nearby connections. Hidden lines cannot receive pointer or keyboard focus.
Search finds members inside collapsed areas, including original function names,
and expands their area before opening them. Fit includes the whole current map.

## Use the same names with your coding agent

Set block names, stable IDs and aliases in `agent.mind/project-map.json`. The
canvas and agent context use this map. Files without names stay visible in neutral
path groups until you name them.

For example, this names one source file **Module C**. Replace `src/module-c.mjs`
with a real path relative to your project root. `files` lists exact paths;
`prefixes` includes files whose paths start with a given prefix.

```json
{
  "schemaVersion": 1,
  "blocks": [{
    "id": "module-c",
    "label": "Module C",
    "aliases": ["modul C"],
    "type": "module",
    "group": "core",
    "description": "Describe what this part does.",
    "files": ["src/module-c.mjs"],
    "prefixes": []
  }]
}
```

When you say “module C needs another test”, the coding agent resolves that name
before choosing files:

```sh
node agent.mind/cli.mjs context "Module C"
node agent.mind/cli.mjs context block:module-c
```

Context includes the project root, binding ID/generation, graph revision, selected
part, file hashes, connections and test references. If a name matches several
parts, the command returns an error with candidates. Use the full breadcrumb path
or stable ID. The agent still needs to read the implementation and tests.

Immediately before an authorized edit, recheck the context:

```sh
node agent.mind/cli.mjs preflight block:module-c --revision <graph-revision> --binding-id <binding-id> --generation <generation>
```

Replace the placeholders with values from that context. If anything changes,
resolve it again. Preflight checks the selected context; it does not lock files
or control every agent tool. The CLI accepts exact selectors. The host agent
interprets natural-language requests and supplies any voice transcript;
agent.mind does not transcribe audio.

The coding agent must load the managed instructions in the target project.
Check its active instructions after attachment; a fresh session in that directory
may be needed. Loading depends on the host's instruction chain, nested overrides
and whether the project has a Git root. Installation alone cannot activate a
host session or establish that an agent used the map. See
[Codex AGENTS.md documentation](https://learn.chatgpt.com/docs/agent-configuration/agents-md).

### Names and areas

`project-map.json` defines IDs, names, aliases, roles and file membership. Optional
`parts` name existing files and symbols. `section` groups siblings into a display
area; it does not change their source hierarchy. Its required `sectionId` is a
stable lowercase slug, unchanged when the label changes. Area IDs belong to their
source parent. Invalid or missing area IDs produce a diagnostic and put the
members in Other parts, keeping their names.

Keep block IDs stable when renaming. File and symbol IDs come from source.
Original source names, previous Czech labels and qualified paths remain aliases.
Ambiguous short names need a full path or stable ID. Invalid metadata produces
diagnostics and does not hide parts. Names describe intended responsibilities;
the source determines connections.

## What it can read

Acorn parses JavaScript without executing it. The index reads static imports,
reexports, literal dynamic imports and supported local URL/HTML asset references.
It finds named functions, classes, methods, their lexical nesting and some
same-file calls. Shadowed, reassigned or ambiguous targets remain unresolved.
Assignments in class fields, static blocks and computed names also invalidate
affected targets, without treating those unsupported bodies as call evidence.

Anonymous callbacks can add references to their nearest named symbol, marked
`nested-closure`; that does not mean the parent calls them directly. Imported
function calls, arbitrary object dispatch, TypeScript and runtime behavior are
unsupported. **Entry** and **File body** show statements at the current source
level. File imports are not treated as function calls. CSS, JSON, Markdown and
Python files are listed without internal call analysis. Binary assets are not
read as source text.

HTTP/SSE connections match global `fetch`/`EventSource` calls with fixed local
`/api/` paths to one matching handler in a verified `node:http` server callback.
Dynamic query strings are supported. Dynamic paths, shadowed bindings, mismatched
methods and multiple providers remain unresolved. The details include both source
locations and hashes; they do not establish that a request happened.
Named class expressions shadow matching API names within that class, including
its superclass expression, without hiding calls outside it.

Security highlights recognized sensitive Node imports, supported callsites and
some browser inputs/outputs. These are places to review, not vulnerability findings
or a safety verdict. Testing shows test files and their static dependencies, not
coverage or passing results. Unsupported source files, parse failures and unresolved
references stay visible.

### Scope and updates

Installed projects exclude their exact agent.mind integration directory,
node_modules, hidden/sensitive files and symlinks. Development also excludes this
repository's legacy/, backups/, evidence/ and workspace/ directories. The index
limits are 1000 files, 512 KiB per file, 16 MiB text, 10000 directory entries and
depth 20. Scope and limitations are available in the UI and context JSON. Large
projects may hit these limits or pause during synchronous indexing.

`live-index.mjs` checks inventory and contents every 900 ms, reusing parsed data
when content is unchanged. Two scans must agree before a new revision is published.
Persistent changes mark the previous snapshot as an error. Files can change again
after a scan; opening source checks its indexed hash separately. A parse failure
removes that file's derived connections and marks the index as partial. SSE sends
new revisions without reloading the page.

## Detach and uninstall

Stop the foreground view first. These commands act on the identified installation:

```sh
node agent.mind/cli.mjs detach
node agent.mind/cli.mjs attach
node agent.mind/cli.mjs uninstall
```

Detach invalidates old bindings and removes only the unchanged managed AGENTS
block. It keeps your map and runtime for reattachment. Edited or duplicate managed
blocks cause a conflict. Surrounding instructions are preserved; detach never
restores an old copy of the whole AGENTS file. Instructions already loaded into
chat history remain there.

Uninstall removes owned files from their active locations and lists leftovers.
It preserves your map and changed or unknown files, and records what was removed.
Moved files stay in `.local/recovery/`, including files that another process may
still write through an open descriptor. These recovery copies are local and are
never included in releases. There is no automatic purge.

Keep the downloaded release CLI to inspect or retry cleanup with
`--install-dir /absolute/project/agent.mind`. To delete **all remaining installation
data**, including your map and recovery copies, stop external writers, inspect
the exact plan, then use its digest:

```sh
node /path/to/agent-mind-1.0.2/cli.mjs purge-plan --install-dir /absolute/project/agent.mind
node /path/to/agent-mind-1.0.2/cli.mjs purge --install-dir /absolute/project/agent.mind --digest "COPY_THE_REVIEWED_PLAN_DIGEST"
```

Purge is permanent. Changed files, inventory, identity or symlinks invalidate the
plan. Only listed paths inside that installation can be deleted. Incomplete cleanup
reports conflicts and remaining paths. Purge cannot prevent unrelated processes
from writing, so keep external writers stopped.
Caught cleanup failures retain or restore the local records for a new reviewed
purge plan. Restoration never overwrites a recreated path; conflicts identify any
retained recovery copies. This requires the original directory and restore access
to remain available. It is not a crash- or power-loss-safe transaction.

After a crash, `status` may report a leftover view lease. Use
`release-view --token <recorded-token>` to release it. The command refuses while
the recorded process exists and never kills a process. Retain the original
release archive for recovery. There is no automatic updater.

### Update from an older version

1. Stop the view and save `agent.mind/project-map.json` outside the installation.
2. Run `node agent.mind/cli.mjs uninstall` using the existing installation.
   If it reports a conflict, resolve it before continuing.
3. Move the preserved `agent.mind/` directory to a separate backup location.
   Keep it and the original release download for recovery. Do not overwrite an
   existing backup or use purge as part of this update.
4. Follow the installation steps above for 1.0.2, then restore your saved map to
   the new `agent.mind/project-map.json`.
5. Run `status` and `context` through the new CLI. Reload the project instructions
   in your coding agent before using the new installation.

Each release has its own runtime digest and generated integration files. Installing
1.0.2 over 1.0.1, or adopting a 1.0.1 clone with the 1.0.2 release, is rejected.
To return to an older version, use the same steps with that version's original
release and your saved map. Existing installations do not change when a new
release is published.

## For agents

These instructions apply to an agent sent here by a human, whether it reads GitHub,
clones this repository, or uses a downloaded release. Follow the human's request
and your host's instruction and permission rules. Reading this repository does not
authorize installing software, editing another project, or publishing anything.
agent.mind requires no particular agent, model, account, memory service or API key.

### Choose the operation and target

| Human request | Your next step |
|---|---|
| Explain or evaluate agent.mind | Read this guide and the relevant source; report capabilities and limits. |
| Install/use it on their project | Identify the explicit absolute target path and follow the release installation workflow below. |
| Change agent.mind itself | Use the source checkout, its `AGENTS.md`, and [Development](#development). |

Ask only when the operation or target is missing or ambiguous. An explicit request
to install and attach to a named project covers those local steps; do not ask again
before every command. Keep publication, deployment, credentials, external messages
and destructive cleanup within the human's explicit authorization.

Keep the **source checkout**, **extracted release**, and **target project** distinct.
Never default the target to this repository or install agent.mind into its own source
checkout. Never copy this repository's `project-map.json` into the target.
Running `npm start` here does not install anything into the human's project.

### Install and verify

1. Check `node --version` (22 or newer), macOS/Linux, the real target directory,
   existing instructions, and authorized write access. Report missing prerequisites;
   do not silently install a system runtime or change global agent configuration.
2. Before choosing a release or running an installer, inspect any existing
   `target/agent.mind/`. With no integration, use the fresh-install path. A portable
   clone with no `.local/` uses its `project.json` runtime pin and the documented
   `--adopt` command; obtain that exact release, even if it is older. An existing
   local installation uses its installed CLI and does not need a fresh install.
   Preserve foreign directories, edited managed blocks and mismatched pins; report
   the exact conflict. Do not delete `.local/`, force adoption, or silently switch
   release versions.
3. For a fresh install or portable adoption, follow the corresponding commands in
   [Install into a project](#install-into-a-project), using the selected release,
   checksum and explicit `--project` / `--release` paths. Stop on a failed command or
   checksum. Do not run the target application's install scripts or `npm install`
   to discover its structure. agent.mind's dependencies stay inside its runtime.
4. From the target root, run:

   ```sh
   node agent.mind/cli.mjs status
   node agent.mind/cli.mjs context
   ```

Read the JSON, not just the exit status. For a ready attached installation, require
`state: "attached"`, `integrity: "verified"` and an empty `conflicts` array. Match
`root` and `binding.root` to the requested target; record `runtime.version`,
`runtime.digest`, `binding.id` and `binding.generation`. `status` can exit zero with
`integrity: "needs-attention"`. Context can exit zero with `status: "partial"`;
inspect `diagnostics`, `scope` and symbol diagnostics before claiming completeness.

`instructionActivation: "not-verified"` is expected: the CLI cannot verify that your
host loaded the managed AGENTS block. Check the active instruction chain, including
overrides and nested instructions. Reload or start a fresh session in the target if
needed. If the host cannot establish activation, say so; do not claim installation
alone activated the workflow. For Codex, see the
[official instruction discovery rules](https://learn.chatgpt.com/docs/agent-configuration/agents-md).
Do not edit another agent's global configuration to make these instructions load.

The optional install `--digest` value is the **artifact manifest digest**, not the
archive SHA256. For a moved local installation, inspect status and intentionally
use `rebind` then `attach`; do not reuse its old binding receipt. For updates,
uninstalled remnants or cleanup, follow [Update from an older version](#update-from-an-older-version)
and [Detach and uninstall](#detach-and-uninstall). Purge is never an implicit update step.

### Use context before an authorized source edit

Resolve the human's name or alias before choosing files:

```sh
node agent.mind/cli.mjs context "Module C"
```

`Module C` is an example; use a name that exists in the target's map, an exact source
path, stable source ID or full breadcrumb. If the command lists ambiguous candidates,
select the matching stable ID or ask which scope was intended. Do not invent a role
for unknown files. Area cards are presentation groups; select a source member rather
than passing an `area:` ID to the CLI.

Read `selection`, `ancestry`, the relevant file paths/hashes and connection evidence,
then read the actual implementation and tests. Immediately before the already
authorized edit, use the **same selector** and values from that context:

```sh
node agent.mind/cli.mjs preflight "Module C" --revision "RETURNED_REVISION" --binding-id "RETURNED_BINDING_ID" --generation "RETURNED_GENERATION"
```

Replace all placeholders: `revision` is the returned SHA256, `binding.id` the UUID,
and `binding.generation` the positive integer. Success returns
`preflight: "verified-at-read"`. A stale revision or binding requires fresh context
and rereading changed code. A partial index fails preflight: investigate its
diagnostics and report the limitation instead of bypassing the check or claiming a
verified edit. Preflight does not lock files or control your other tools.

After edits, run the target project's relevant checks and obtain fresh context.
Static test links do not prove tests passed or measure coverage. Security labels
identify source to review; they are not vulnerability findings. Unsupported
TypeScript/TSX, framework routing and dynamic calls remain unsupported even when
the visible map looks plausible. Never execute a scanned project to discover its
structure; separately authorized project tests are a different operation.

### View and hand back the result

When a visual view is requested, run `node agent.mind/cli.mjs view` from the target.
It prints `url`, `root`, `binding` and `viewToken`, and stays in the foreground.
Verify that identity before opening the URL. Use the printed port, not an assumed
4317. If the sandbox blocks listening, use the host's scoped approval mechanism
when authorized; otherwise report the exact limitation. Never kill an unrelated
process or widen permissions silently.

Stop your own temporary verification view when finished. If the human requested
a usable running view, leave it running and explain how to stop it with Ctrl+C.
A stale lease can be released with the exact recorded token only after its process
has exited; see [Detach and uninstall](#detach-and-uninstall).

End with a concise evidence receipt: actual operation and target; installed version,
artifact digest and binding (or source HEAD for development); context revision/status
and selected source ID; checks actually run and results; instruction activation
verified or unverified; changed files and preserved conflicts; URL/process state
if applicable. State any unsupported scope or exact blocker. Do not upload source,
context output or logs to another service merely because this guide asks for a report.

## Development

```sh
npm ci --ignore-scripts
npm test
npm start
npm run package
```

The development server maps this repository at http://127.0.0.1:4317. `PORT`
changes the port. `AGENT_MIND_PROJECT=/absolute/path` selects another local root
for development inspection; installed projects should use their own CLI.

`npm run package` creates a release in `dist/` with its dependencies, exact file
manifest and archive checksum. It refuses to replace existing output. Use
`npm run package -- --output /absolute/new-directory` for another build.

This repository's main blocks are **Map**, **Server**, **Live changes**, **Code index**
and **Agent context**, with **Installation**, **Tests**, **Settings** and
**Documentation**. The old builder, approval, model selection and app execution
features are retired.

Before a nontrivial change, get fresh context and read the relevant source:

```sh
node graph-context.mjs "Map"
node graph-context.mjs "Code index"
node graph-context.mjs block:live-index
node graph-context.mjs server.mjs
node graph-context.mjs 'symbol:public/visualizer.js#startVisualizer.drawEdges'
npm test
```

Context includes the same names and collapsed areas as the canvas, the selected
part and its ancestors, file hashes, graph digest and connections. `canvas` is the
collapsed view; `partCanvas` keeps the full source members and edges.
`public/hierarchy.mjs` supplies both browser and agent views. Agents cooperate by
running these checks; there is no global hook enforcing them.

### Local APIs

- `GET /api/graph`: graph, hierarchy and index status.
- `GET /api/events`: SSE `state` in the same shape, plus heartbeat.
- `GET /api/source?path=server.mjs&line=20`: source excerpt; rejects changed content,
  symlinks and paths outside the index.
- `GET /api/context?path=server.mjs`: fresh file context.
- `GET /api/context?block=block:canvas`: named context; also accepts a label, alias,
  source ID or full breadcrumb path.

The server rejects foreign Host/Origin and cross-site fetch. It does not support
mutating methods or retired builder endpoints. Tests use disposable local fixtures
and one-shot loopback servers, with no model or production services. If a sandbox
blocks listening, run them with permission to use local ports.

## Validation and known limits

This is an engineering validation record, not a formal compliance certification or
a guarantee that every project is safe or responsive. The reviewed version is
**1.0.1**, source commit `191c3d32480192daa70b27cbc32be92172b77719`, tested on
**25 October 2026**, macOS with Node **22.22.0**. The historical audit below describes
that version; the separate 1.0.2 verification section records the subsequent repair.

Independent agents reviewed architecture and security source; a separate agent ran
bounded stress fixtures. The coordinator checked evidence and ran HTTP/lifecycle
checks. Reviewers followed read-only procedures under a workspace-write sandbox;
OS-enforced read-only isolation was not established. Public users do not need this
audit's agent tooling to run agent.mind.

### Checked controls

| Control | Observed evidence |
|---|---|
| HTTP Host/Origin/fetch-site, GET-only routes and indexed-source access | 15 disposable HTTP checks passed, including traversal, excluded paths, stale hashes and symlink replacement. |
| Live reconciliation, SSE and installed binding invalidation | 6 existing server tests passed. |
| Artifact allowlist/hashes, installation identity, AGENTS custody, adoption and explicit purge | 22 existing lifecycle tests passed. |
| Current public source and downloaded v1.0.1 archive | 34 tracked files and 37 archive entries checked for private payload paths and known credential patterns; none found in those checks. Git history was not scanned. |
| Locked dependency advisory snapshot | `npm audit --json --ignore-scripts --package-lock-only` reported zero known advisories on the test date. |

The independent source review fully read 31 tracked text files. Naming metadata had
partial manual review plus whole-file searches; the two WebP assets had file-type
inspection, not a binary decoder audit. Pattern searches cannot establish the
absence of every secret. The downloaded archive SHA256 was
`bf73585e42cdf95f82e08c9b05a1c92a1c61a416a026cb4f67f9c2eba8557a05`.

### Stress boundaries

Tests used generated disposable files and trusted indexer APIs, without executing
the generated project. Each child had a 15-second external deadline and a 256 MiB
V8 heap setting. That heap setting is not a process RSS limit. The final matrix had
32 named cases across 34 executions: 32 successful executions, one corrected helper
expectation error, and one deliberate deadline termination exposing the issue below.
The failed helper run was retained and was not counted as a product failure.

| Guard | Boundary exercised | Result |
|---|---|---|
| Eligible files | 1000 / 1001 | Exact limit accepted; excess reported as partial. |
| Bytes per file | 524288 / 524289 | Exact limit accepted; oversized file omitted with diagnostic. |
| Total source bytes | 32 / 33 files of 524288 bytes | 16 MiB accepted; excess omitted with diagnostic. |
| Directory entries | 10000 / 10001 | Excess reported as partial. |
| Directory depth | 20 / 21 | Deeper source excluded with diagnostic. |
| Named symbols per file | 2000 / 2001 | Excess truncated with diagnostic. |
| Callsites per file | 10000 / 10001 | Excess evidence truncated with diagnostic. |
| Call edges per file | 5000 / 5100 | Excess capped at 5000 with diagnostic. |
| Symbol visitor AST nodes | 99999 / 100000 / 100001 | Excess reported with diagnostic. |
| Symbol visitor depth | 256 / 257 | Excess reported with diagnostic. |

Two deeply nested parser fixtures returned explicit parse diagnostics. These guards
do not bound all Acorn parsing, helper loops, graph size, CPU time or memory use.
Syntax failure and repair removed stale call edges and restored a current index.

### Measured performance and open issue

Single samples on this test machine, not a benchmark distribution or service-level
guarantee. The scale fixture had five named functions and four local call edges per
file, with chain imports. An unchanged refresh includes two scans and hierarchy
construction; the test interval was 60 seconds to avoid background interference.

| Files | Named symbols | Unchanged refresh |
|---|---:|---:|
| 10 | 50 | 3 ms |
| 100 | 500 | 39 ms |
| 500 | 2500 | 410 ms |
| 1000 | 5000 | 1617 ms |

The last sample exceeds the default 900 ms polling interval. A valid 524281-byte
class took 3022 ms for a cold source index. Completed children reported peak RSS
up to 158.7 MiB; live RSS monitoring was unavailable, and that is not an upper bound.

**Finding in 1.0.1: quadratic hierarchy construction (low severity, CWE-407).** A
fixture with 20 files, 1000 short functions per file and 357780 total bytes passed
the raw input limits and indexed in 510 ms. Its subsequent `LiveIndex` construction
did not finish before the process's 15-second deadline. The constructor consumed
over 14 seconds after the cold index; its completion time was not measured.
In 1.0.1, `project-map.mjs` calls `ancestorPath()` for every node, and
`public/hierarchy.mjs` rebuilds the whole node lookup on each call. A supplied project can therefore block
the local viewer without executing its code. No remotely reachable attack or data
loss was demonstrated. Reducing the fixture to 20 functions let a **new process**
construct the graph in 21 ms; automatic recovery of the blocked process was not shown.

### 1.0.2 hierarchy repair verification

Version 1.0.2 reuses one lookup within each hierarchy construction, name-resolution
operation and scope projection. Standalone `ancestorPath(hierarchy, id)` still reads
current nodes on each call; there is no persistent cache. Ancestor order, cycle
handling, duplicate-ID behavior, node identities, aliases and source evidence remain
part of the contract. The published 1.0.1 archive is unchanged.

On the same machine and Node version, a fresh run of the 1.0.1 artifact again exceeded
the 15-second process deadline. Three runs of the repaired source with the same
20-file / 20,000-function / 357780-byte fixture measured:

| Operation | Observed range |
|---|---:|
| `LiveIndex` construction | 521–532 ms |
| Unchanged refresh | 103–126 ms |
| Missing-name lookup | 42–50 ms |
| File scope projection | 7–9 ms |

An alternate fixture with 20,000 functions and 19,980 call edges completed construction
in 735 ms, refresh in 224 ms and a 999-edge file projection in 13 ms. These are bounded
local measurements, not guaranteed latency. Peak reported RSS was about 199 MiB for
the flat runs and 286 MiB for the call-heavy run; the 256 MiB V8 heap setting is not
an RSS cap.

A before/after comparison made 76 equality checks across initial, renamed and deleted
source states: hierarchy, overview, symbol graph, ancestry, scope output and selector
results/errors matched 1.0.1. New regression tests exercise both dense input shapes
under an external 15-second subprocess deadline, plus cycles, missing parents,
duplicate IDs and in-place hierarchy changes:

```sh
node --test test/hierarchy-performance.test.mjs test/hierarchy.test.mjs test/project-map.test.mjs
```

This closes the repeated full-lookup path tested here. It does not add a global work
budget, isolate parsing in a worker, or establish an overall time/memory bound.

Start with a small trusted project and inspect diagnostics before expanding it.
File count alone is insufficient: total symbols and source shape matter. Browser
paint/layout, sustained polling CPU, concurrent HTTP/SSE clients, every parser shape,
remote forwarding and OS-user isolation were not validated by these stress tests.
The source API measurements do not establish performance for every packaged or
installed target. Local clients remain trusted, and source exclusions are not DLP.

To repeat the existing security/lifecycle checks from a source checkout:

```sh
node --test test/visualizer-server.test.mjs test/installation.test.mjs
```

These two test files cover 28 tests; they do not reproduce the separate stress
matrix. The audit's generated helpers and raw measurements are retained with its
local report. The focused hierarchy regression is now in the source test suite;
the full audit matrix is not bundled as a supported public stress runner.

## License and artwork

The source is ISC-licensed. Bundled Acorn keeps its MIT license. The artwork was
generated for this project; [public/assets/README.md](public/assets/README.md) records its
origin and prompts.
