# agent.mind — live code visualizer

The active product is a read-only view of the real source project. Builder is retired
under `legacy/builder`; do not reactivate its SDK/native handoff, Store, preview,
approval or workspace-writing paths as part of ordinary visualizer work.

Before nontrivial code changes, read README.md and run
`node graph-context.mjs "<block name>"` or a relative file path for the affected entry points.
Resolve the user's block names/aliases with this command before choosing files.
`project-map.json` owns the vocabulary and membership, not dependency evidence.
Preserve stable block IDs on renames. Files and symbols use source-derived IDs;
`parts` only names existing parts. Optional `section` is a presentation grouping
of siblings, never a new source hierarchy or dependency. `sectionId` is stable
across English/display-name changes. `projectAreas` conserves every source link
as a visible aggregate or an internal area reference; retain `partCanvas` for
uncollapsed source context. Preserve old Czech labels and qualified paths as aliases. Preserve original symbol
names as aliases and keep complete evidence when UI filters visible relations. Use a full breadcrumb path or stable ID when
a short name is ambiguous. Canvas and context share `public/hierarchy.mjs`. Never silently assign unknown files an invented
role; keep inferred groups visible until their responsibility is identified. The command
indexes current files, reports source hashes, inbound/outbound dependencies and
uncertainty. Read the relevant code too; the graph is bounded static evidence.
After changes run relevant tests and obtain a fresh context. This is a cooperative
agent workflow, not an installed global hook or proof of every agent action.

Source files are authoritative for the derived graph. One graph powers Project,
Security and Testing. Preserve node identities, camera and selection across views
and live updates. Never infer coverage or test PASS from test imports. Security
signals identify code dependencies/callsites; they are not vulnerability findings.
Unresolved dynamic references, parse failures and excluded scope must stay visible.
Never execute a scanned project to discover its structure.

`code-index.mjs` owns bounded source extraction and conservative static HTTP/SSE
references. `project-map.mjs` derives the overview from source edges and validated
naming metadata. `symbol-index.mjs` extracts nested named symbols and conservative
local calls without execution; ambiguous/dynamic calls remain unresolved. The
overview and drill-down never invent dependencies from labels alone. `live-index.mjs` owns reconciliation
and freshness. `server.mjs` exposes read-only loopback APIs. `graph-context.mjs`
provides a fresh context for the coding agent. `public/visualizer.*` owns presentation
only. Browser position/layout state is not semantic project authority.

Keep workspace/, backups/, evidence/, node_modules/, legacy/, hidden and sensitive
files outside the active index. Source reads require current indexed content hashes
and safe real paths. Tests use disposable fixtures and loopback only.
Installation and packaging live in installation.mjs, cli.mjs and scripts/.
Use the installed CLI for bound targets; the development server is a separate mode.
Installed targets use generic indexing, an exact excluded integration subtree and
their own project-map.json. Never copy this repository's vocabulary into a target.
Keep dependencies inside the runtime and cleanup limited to unchanged owned files.
Run npm test, npm run package and scripts/smoke-release.mjs against the produced
bundle before releasing. Public source and release payloads must exclude local
workspaces, backups, evidence, legacy archives and private development notes.
No deployment, external messages, credential reads or global configuration changes
without explicit task authorization. Publication requires explicit owner authority.
Preserve all existing workspace data and historical project.mind authority; this
pivot does not migrate or rewrite archived builder projects.
