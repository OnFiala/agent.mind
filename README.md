# agent.mind

A live map of the actual source project. The overview shows named project blocks,
their responsibilities and source-backed relationships. Click through blocks,
files and nested functions. Deeper levels start as a compact map of areas; click
an area to expand its members in place. The development default project is agent.mind itself; installations bind to their target project.
Saved source changes update the canvas automatically.

## Install into a project

Requires Node.js 22 or newer. macOS and Linux are the supported initial platforms.
Download the pinned release from [GitHub Releases](https://github.com/OnFiala/agent.mind/releases/tag/v1.0.0).
The release includes its own Acorn dependency; installation does not touch the
target project's package.json, lockfile or node_modules.

```sh
mkdir agent-mind-download
cd agent-mind-download
curl --fail --location --output agent-mind-1.0.0.tar.gz https://github.com/OnFiala/agent.mind/releases/download/v1.0.0/agent-mind-1.0.0.tar.gz
curl --fail --location --output SHA256SUMS https://github.com/OnFiala/agent.mind/releases/download/v1.0.0/SHA256SUMS
shasum -a 256 -c SHA256SUMS
tar -xzf agent-mind-1.0.0.tar.gz
node agent-mind-1.0.0/cli.mjs install --project "/absolute/path/to/project" --release "$PWD/agent-mind-1.0.0" --attach
```

Stop if checksum verification fails. The installer also checks the complete runtime
manifest and rejects unknown files and symlinks. Checksums verify release bytes;
choose the source repository deliberately. No global install, daemon, account,
API key or model is required. The target project is never executed by the index.
An existing unowned `agent.mind/` directory is not overwritten.

The only integration outside `agent.mind/` is one marked block in the target's
`AGENTS.md`, added by `--attach`. Existing instructions are preserved. Then, from
the target project:

```sh
node agent.mind/cli.mjs status
node agent.mind/cli.mjs view
```

`view` prints the actual loopback URL and project identity. It runs in the
foreground; stop with Ctrl+C. It does not open a public port or start automatically.
Use `view --port 4317` to request a fixed port; a conflict fails rather than
connecting you to somebody else's server.

```text
project/
├── AGENTS.md                  # existing text + one managed block
└── agent.mind/
    ├── README.md              # installed usage and cleanup
    ├── cli.mjs                # stable entry point
    ├── project.json           # portable intent and runtime pin
    ├── project-map.json       # your names, aliases and module membership
    ├── .gitignore             # ignores .local/
    └── .local/                # local binding receipt and private runtime copy
```

Keep the map and descriptor with your project if useful. `.local/` belongs to the
specific machine and directory. A copied installation does not silently bind to a
new project; inspect `status` and use explicit `rebind`/`attach` after a move. Do
not copy `.local/` through Git. Fresh clones need a local installation. Download the same pinned release, then
explicitly adopt the known portable integration (your map is preserved):

```sh
node /path/to/agent-mind-1.0.0/cli.mjs install --project "/absolute/cloned/project" --release /path/to/agent-mind-1.0.0 --adopt --attach
```

Adoption requires a recognized launcher and descriptor with the same runtime pin.
Unknown or modified integration instructions are a conflict, not permission to
overwrite them.

## Use the same names with your coding agent

Give blocks stable IDs and names/aliases in `agent.mind/project-map.json`. The
canvas and agent context read this same map. Unknown files initially use neutral
source-derived groups; installation does not invent a “Module C”.

When you say “module C needs another test”, the coding agent interprets the intent,
then resolves the exact name before choosing files:

```sh
node agent.mind/cli.mjs context "Module C"
node agent.mind/cli.mjs context block:module-c
```

The result includes the bound root, binding ID/generation, graph revision, selected
identity, file hashes, relationships and static test references. Multiple matching
parts are an explicit error with candidates. Use the full breadcrumb or stable ID
to disambiguate. The agent must read the implementation and tests; static references
do not establish test coverage, execution or adequacy.

Immediately before an authorized edit, revalidate the returned receipt:

```sh
node agent.mind/cli.mjs preflight block:module-c --revision <graph-revision> --binding-id <binding-id> --generation <generation>
```

Replace placeholders with values from the actual context. Changes require a fresh
resolution. This is a cooperative preflight, not a transactional lock or a sandbox
for all agent tools. The CLI accepts exact selectors, not natural-language sentences.
Voice input uses the host agent's transcript; agent.mind does not transcribe audio.

Codex must load the managed instructions in the target project. Check the active
instructions after attachment; start a fresh session in that directory if needed.
Instruction discovery depends on the host and its instruction chain, including
nested overrides and projects without a Git root. Installation alone does not
prove the main agent has used the map. See [Codex AGENTS.md documentation](https://learn.chatgpt.com/docs/agent-configuration/agents-md).

## Detach and uninstall

Stop the foreground view first. These commands operate only on the identified
installation:

```sh
node agent.mind/cli.mjs detach
node agent.mind/cli.mjs attach
node agent.mind/cli.mjs uninstall
```

Detach invalidates old bindings and removes only the unchanged managed AGENTS
block. It keeps your map and runtime for reattachment. An edited or duplicate
managed block is a conflict; surrounding user instructions are never restored from
an old whole-file backup. Detach cannot erase instructions already in chat history.

Uninstall removes owned files from their active locations and reports exact leftovers.
Your map and changed/unknown files are preserved, with a local cleanup receipt.
Displaced files are retained under `.local/recovery/` so concurrent owner edits,
including writes through already open file descriptors, remain recoverable. These
local backups are never part of a release.
There is no implicit purge. Keep the downloaded release CLI for inspecting/retrying
cleanup with `--install-dir /absolute/project/agent.mind`.

To deliberately delete **all remaining installation data**, including your map and
recovery copies, stop external writers, inspect the exact plan, then use its digest:

```sh
node /path/to/agent-mind-1.0.0/cli.mjs purge-plan --install-dir /absolute/project/agent.mind
node /path/to/agent-mind-1.0.0/cli.mjs purge --install-dir /absolute/project/agent.mind --digest "COPY_THE_REVIEWED_PLAN_DIGEST"
```

Purge is permanent. A changed inventory, identity or symlink invalidates the plan.
Only listed paths inside that installation are eligible; incomplete cleanup reports
conflicts and remaining paths. This is not a transaction against unrelated writers.

A crashed foreground process may leave a view lease. `status` reports it; the
explicit `release-view --token <recorded-token>` command refuses while its recorded
process still exists and never kills a process. Retain the original release archive
for recovery. Replace a version through deliberate uninstall/reinstall after
preserving the map; there is no automatic updater.

## Develop and navigate

```sh
npm ci --ignore-scripts
npm test
npm start
npm run package
```

The development server reads this repository and listens on http://127.0.0.1:4317.
`PORT` changes its port. `AGENT_MIND_PROJECT=/absolute/path` selects another local
root for development inspection; installed projects should use their own CLI.
`npm run package` creates a self-contained release in `dist/` and refuses to
replace existing output. Use `npm run package -- --output /absolute/new-directory`
for another build. Build output contains an exact file manifest and archive checksum.

- **Left rail:** Whole project, Security and Testing change emphasis within the same graph.
- **Top bar:** project/search, index freshness, zoom, fit and layout controls.
- **Canvas path:** jump to an ancestor or use Back to restore its camera, positions,
  selection and expanded areas.
- **Right panel:** source and relationship evidence, project scope and recent changes.
  Builder, approval, model selection and app execution are retired.

The main blocks are **Map**, **Server**, **Live changes**, **Code index** and
**Agent context**, supported by **Tests**, **Settings** and **Documentation**.
A source-backed hierarchy remains block → file → function/class → nested parts.
Areas are a presentation of siblings, not new source parents or invented modules.
A leaf opens its actual source. The separate detail control also works on parents.
A removed source scope returns to the nearest existing ancestor.

## Areas and relationships

File and symbol scopes initially collapse named areas such as **Controls**,
**Rendering**, **Live data** and **Details** into one card each. **Outside** collects
parts outside the current source scope. Expand an area by clicking it; collapse
it with its header control, or use **Collapse all**. Expansion is local to that
scope and survives navigation and live updates within the current page.

A link between collapsed areas aggregates actual directed relationships with the
same type and provenance. It retains every underlying scope/source edge ID,
source evidence and layer. Reverse links and different types remain separate.
Relationships inside a collapsed area are retained as internal references and
become visible when it expands. Full expansion recovers the original endpoints.
Counts distinguish displayed links from underlying references; fewer visible links
do not imply fewer source dependencies.

Use **Select** on an area card to pin its relationships without expanding it.
Incoming and outgoing links use distinct line styles with a text legend; unrelated
links and cards fade. The pinned area remains active while inspecting a connector.
Connector labels identify both endpoints and direction. Its detail lists the actual
contributing source-part pairs with their own evidence and source links, rather
than only the area names. Missing references are reported, never reconstructed
from labels. Clear the area focus to return to the normal overview.

A compact area map shows its links by default. Dense expanded views support
**Selection relations** and **All relations**. Hovering, keyboard focus and selection show
local relationships without changing the source graph. Hidden links are not
keyboard or pointer targets. Search also finds members inside collapsed areas,
including original function names, and expands the relevant area before opening
the result. Fit explicitly includes the whole current map; initial views keep
readable card sizes.

## Shared names and stable identity

`project-map.json` is the single vocabulary for IDs, names, aliases, roles and file
membership. Optional `parts` name actual files and symbols. `section` names an area;
`sectionId` is its required stable lowercase slug and does not change when its label
changes. A named area without a valid ID produces a diagnostic and falls back to
Other parts, preserving its members and friendly part names.
Area IDs are scoped by source parent. Source-derived IDs and parent relationships
remain unchanged by grouping or translation.

The current vocabulary and interface are English. Original source names and prior
Czech labels remain aliases; old qualified breadcrumb paths still resolve through
the aliases at each level. Ambiguous short names require a full path or stable ID.
Labels and descriptions are declared responsibilities, not evidence of runtime flow.

Unknown files remain visible in neutral path groups. A project without naming
metadata receives neutral labels rather than agent.mind-specific roles. Invalid
metadata produces diagnostics instead of silently hiding source parts.

## What the map proves

Acorn parses JavaScript (`.js`, `.mjs`) without execution. The index includes static
imports, reexports, literal dynamic imports and recognized local URL/HTML asset
references. `symbol-index.mjs` uses the same AST for named functions, classes,
methods, lexical nesting and conservative same-file calls. Shadowed, reassigned
or ambiguous targets are not asserted as resolved calls.

Anonymous callbacks can contribute references to their containing named symbol
with `nested-closure` evidence; this does not prove direct execution by that parent.
Imported function calls, arbitrary object dispatch, TypeScript and runtime/dynamic
behavior remain unsupported. **Entry** and **File body** represent statements at
the current source level; a file import is never invented as a function call.
CSS, JSON, Markdown and Python files are inventoried without internal call analysis.
Binary assets are not read as source text.

Security highlights recognized sensitive Node imports, supported callsites and
limited browser inputs/outputs. It is review context, not an audit, safety verdict
or vulnerability list. Testing highlights test files and their static dependencies;
an import is neither coverage nor a test result. Unresolved references and parse
failures remain explicit diagnostics.

A bounded HTTP/SSE contract recognizes global `fetch`/`EventSource` with a fixed
local `/api/` pathname and an unambiguous matching handler inside a verified
`node:http` server callback. Dynamic query strings are supported; dynamic paths,
shadowed bindings, mismatched methods or multiple providers do not create guessed
links. Evidence includes both sources and their hashes, not proof of a request.

## Scope and freshness

Installed projects exclude their exact agent.mind integration subtree, node_modules,
hidden/sensitive files and symlinks. Development defaults also exclude this
repository's historical legacy/, backups/, evidence/ and workspace/ directories. Limits: 1000 files, 512 KiB per file,
16 MiB text, 10000 directory entries and depth 20. Scope and limitations are
available in the UI and context JSON.

`live-index.mjs` checks inventory and contents every 900 ms without depending on
filesystem watchers. Unchanged content reuses parsed data. Two successive scans
must agree before publication; persistent changes mark the previous snapshot as
an error. This is not a transactional filesystem snapshot: another process may
change a file immediately afterward. Source detail independently verifies its
indexed hash. Parse failures remove that file's derived links and mark a partial
index. SSE publishes revisions without reloading the page.

## Agent context and APIs

Before a nontrivial change, obtain fresh context and read the relevant source:

```sh
node graph-context.mjs "Map"
node graph-context.mjs "Code index"
node graph-context.mjs block:live-index
node graph-context.mjs server.mjs
node graph-context.mjs 'symbol:public/visualizer.js#startVisualizer.drawEdges'
npm test
```

Context contains the same vocabulary and default area projection as the canvas,
selected source identity and ancestry, source hashes, graph digest and relationships.
`canvas` is the default collapsed view; `partCanvas` retains its uncollapsed source
members and edges. `public/hierarchy.mjs` supplies both browser and agent projections.
This is a cooperative preflight, not an installed global hook or proof that every
agent action used it.

- `GET /api/graph`: graph, hierarchy and live-check status.
- `GET /api/events`: SSE `state` in the same shape, plus heartbeat.
- `GET /api/source?path=server.mjs&line=20`: bounded source excerpt; changed content,
  symlinks and unindexed paths are rejected.
- `GET /api/context?path=server.mjs`: fresh file context.
- `GET /api/context?block=block:canvas`: named context; accepts a label, alias,
  source ID or full breadcrumb path as well.

The server rejects foreign Host/Origin and cross-site fetch. Mutating methods and
retired builder endpoints are unsupported. Tests use temporary local fixtures and
one-shot loopback servers; no model or production services. A sandbox that blocks
listen requires a permitted local test run.

## Release boundaries

The current release supports bounded JavaScript source analysis. TypeScript/TSX,
framework-specific routing and dynamic dispatch are not supported; relevant
unsupported files and partial-index diagnostics remain visible. Large projects
may reach the documented limits or experience synchronous indexing pauses.

A valid installation and deterministic selector result are separate from a real
main-agent turn. No guarantee of universal natural-language understanding, automatic
host-session activation, arbitrary agent-tool enforcement or test coverage is made.

The source is ISC-licensed. Bundled Acorn retains its MIT license. The visual assets
are local generated assets; provenance is recorded in public/assets/README.md.
