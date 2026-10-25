# agent.mind

A live map of your code. See the main blocks, open their files and functions, and
follow the connections between them. Saved source changes update the map.
The same names work in the canvas and in context for your coding agent.

agent.mind reads source files without running your project. It currently analyzes
JavaScript (`.js`, `.mjs`); TypeScript/TSX and framework routing are not supported.
It runs locally, with no global install, account, API key or model required.

## Install into a project

Requires Node.js 22 or newer on macOS or Linux. Download
[v1.0.1 from GitHub Releases](https://github.com/OnFiala/agent.mind/releases/tag/v1.0.1):

```sh
mkdir agent-mind-download
cd agent-mind-download
curl --fail --location --output agent-mind-1.0.1.tar.gz https://github.com/OnFiala/agent.mind/releases/download/v1.0.1/agent-mind-1.0.1.tar.gz
curl --fail --location --output SHA256SUMS https://github.com/OnFiala/agent.mind/releases/download/v1.0.1/SHA256SUMS
shasum -a 256 -c SHA256SUMS
tar -xzf agent-mind-1.0.1.tar.gz
node agent-mind-1.0.1/cli.mjs install --project "/absolute/path/to/project" --release "$PWD/agent-mind-1.0.1" --attach
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
node /path/to/agent-mind-1.0.1/cli.mjs install --project "/absolute/cloned/project" --release /path/to/agent-mind-1.0.1 --adopt --attach
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
node /path/to/agent-mind-1.0.1/cli.mjs purge-plan --install-dir /absolute/project/agent.mind
node /path/to/agent-mind-1.0.1/cli.mjs purge --install-dir /absolute/project/agent.mind --digest "COPY_THE_REVIEWED_PLAN_DIGEST"
```

Purge is permanent. Changed files, inventory, identity or symlinks invalidate the
plan. Only listed paths inside that installation can be deleted. Incomplete cleanup
reports conflicts and remaining paths. Purge cannot prevent unrelated processes
from writing, so keep external writers stopped.

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
4. Follow the installation steps above for 1.0.1, then restore your saved map to
   the new `agent.mind/project-map.json`.
5. Run `status` and `context` through the new CLI. Reload the project instructions
   in your coding agent before using the new installation.

Each release has its own runtime digest and generated integration files. Installing
1.0.1 over 1.0.0, or adopting a 1.0.0 clone with the 1.0.1 release, is rejected.
To return to an older version, use the same steps with that version's original
release and your saved map. Existing installations do not change when a new
release is published.

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

## License and artwork

The source is ISC-licensed. Bundled Acorn keeps its MIT license. The artwork was
generated for this project; [public/assets/README.md](public/assets/README.md) records its
origin and prompts.
