# UI-NEW-01 — Symbol selection across views

Date: 2026-11-15. Status: source repair, unreleased.
The owner authorized this isolated repair, regression tests, documentation and
independent review, then separately approved merging
[PR #26](https://github.com/OnFiala/agent.mind/pull/26) on 2026-11-15, verification
of the actual post-merge CI and documentation updates. That PR owns the actual
merge commit and subsequent CI receipts. Release and real-target upgrades remain
outside this change. Published 1.3.1 and existing installations remain unchanged.

## Problem and contract

On baseline `f279c840691ef7fb3bac57a22d47ed109d2fa978`, selecting a symbol and
switching to Files retains the symbol in the source inspector, but leaves its
owning file unselected and its incident relations outside the selection focus.
The symbol ID is absent from the file graph, and `selectedDisplayId` previously
returned null without trying the existing file/block projection.

Project the preserved source selection in this order:

1. The exact visible symbol/part.
2. A visible collapsed area containing that part.
3. The visible source file, then its existing owning overview block.
4. No card if none of those exists.

Do not change the selection ID, part ID, line range, navigation or camera to
obtain the highlight. A different symbol in the same file is not a fallback.
Edge selection retains its own handling. Source identity and shared hierarchy
remain authoritative; this change only chooses a visible card for presentation.

## Change boundary

`public/visualizer.js` uses the existing file/block fallback when a selected
part has no visible symbol/area card, and explicitly prefers an exact visible
part to a containing area. One regression group in `test/visualizer-ui.test.mjs`
covers Files and overview projection, relevant versus unrelated relations,
unchanged selection, part/area precedence, unrelated same-file symbols, absent
nodes, null selection and edge selection.

No CSS, graph schema, source resolver, dependency, version, installation format,
UI-NEW-02 keyboard shortcut or separate R04 change is included.

## Validation

Local source: macOS, Node 22.23.4.

- The new regression fails on the baseline: null instead of the owning file.
- UI and hierarchy tests: 48/48 pass; full `npm test`: 346/346 pass.
- Real Chrome 157.0.8103.52 at 1440 by 1000, driven by task-local Playwright,
  exercises the trusted visualizer against a disposable four-file project.
  Baseline and candidate use the same browser sequence and fixture; the scanned
  source is never executed. Served JavaScript hashes match each source snapshot.
- After selecting `render` and switching to Files, the baseline has no selected
  card and zero visible focused relations. The candidate selects `src/app.mjs`
  with `aria-pressed=true`, exposes both incident relations and retains the symbol
  inspector and source line. An unrelated file is not marked as a neighbor.
- Testing, Security and Whole project retain the selected file and symbol detail.
  Returning to Blocks restores the symbol and exact previous camera transform;
  collapsing its area selects the area while preserving the inspector.
- Adding two blank source lines through the fixture writer produces a new graph
  revision and verified source hash. The inspector follows the symbol from line
  3 to line 5, and the owning file remains selected. No page errors or failed
  requests were observed. Browser/server were closed and the fixture removed.

- `npm run package`: all 47 payload files match the source and manifest.
  `scripts/smoke-release.mjs` on the produced bundle: 12/12 groups pass.
- The same browser sequence also passes against the actual bundled server/UI;
  its served JavaScript hash equals the candidate source hash.

Candidate runtime digest:
`0a294996e0564b1500d5827af2ea0d0c972ec1ff89e9453d0763e3ec596701c1`.
Candidate archive SHA256:
`09e048249c3653e0738970fc201d155c81cb76315b03d36e0d7c2d981e6bd7be`.
These identify a local candidate, not a published release.

The PR owns the exact reviewed commit, independent review disposition and CI receipts. These source/browser results alone do not establish
published or installed behavior. Material follow-ups require delta review.

## Limits and rollback

Browser checks were performed by the integrating agent after the separate browser
verifier could not start because of the executor's symlinked writable-root error.
Independent source/evidence review is a separate acceptance step. Reviewer read-only
conduct is procedural under inherited permissions, not independently OS-enforced.
The existing oversized-wordmark context diagnostic remains; no gate is bypassed.
Safari, mobile layouts, assistive-technology behavior and real-target installation
are not verified by this repair.

If rollback is separately authorized after merge, revert the actual PR #26 merge
commit with mainline 1 as recorded in the PR. This restores
the known missing file highlight; no data migration or target cleanup is required.
Existing runtime pins, maps, source files, bindings and recovery data are unchanged.
