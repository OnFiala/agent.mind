# UI-NEW-02 — Keyboard movement without a Back conflict

Date: 2026-11-15. Status: source candidate, unreleased.
The owner authorized this isolated repair, regression tests, documentation,
independent review and a separate PR. Merge and release are not authorized.
Published 1.3.1 and existing installations remain unchanged.

## Problem and contract

On baseline `e7a1ce486e240a996e119763ca68973ce636e81d`, card tooltips advertise
Alt plus arrows for movement. Alt plus right/up/down moves a card, but Alt plus
left is passed to the document's Back handler. In a nested scope this navigates
back instead of moving left; at the root it cannot move the card left.

The replacement chord is Shift plus an arrow on a focused card:

- All four directions move by exactly 20 canvas units and redraw the card and
  incident connector geometry. They preserve scope, source selection and camera.
- Plain arrows retain the existing nearest-card focus navigation and reveal.
- Alt, Ctrl or Meta combinations are not consumed by the card handler. The
  existing Alt-left and Backspace scope navigation remains owned by the document
  handler. This does not define a new global keyboard shortcut scheme.
- Input fields retain native editing. Card tooltips describe the new chord.

Positions remain browser presentation state. This change does not alter source
identity, graph data, source files, saved project metadata or installation state.

## Change boundary

Extract the existing card keydown body into `handleCardKeydown` in
`public/visualizer.js`, keeping the actual listener bound to that function. Change
only its modifier contract and the tooltip. Passing existing state and callbacks
lets the Node tests exercise the production event handler without duplicating it.
The document Back handler, canvas panning and pointer handlers are unchanged.
No CSS, hierarchy, dependency, version, schema or separate R04 change is included.

## Local validation

macOS, Node 22.23.4:

- Eight new regression cases fail against the mechanically extracted original
  production handler body. They pass after the repair: four movement/focus cases
  and four rejection groups covering Alt/Ctrl/Meta with and without Shift.
  Tests assert exact 20-unit displacement, default prevention, redraw/reveal
  callbacks, and that rejected events are not consumed or propagation-stopped.
- UI and hierarchy tests: 56/56 pass. Full `npm test`: 354/354 pass.
- Real Chrome 157.0.8103.52 at 1440 by 1000, driven by task-local Playwright,
  exercises the visualizer on a disposable four-file project. Served JavaScript
  hashes match the selected source. The scanned project source is never executed.
- The same baseline sequence confirms Alt-right moves 20 units while Alt-left
  navigates back; Shift-arrows do not move the card. The repaired sequence verifies
  all four Shift directions at both root and nested-symbol scopes, exact position
  deltas, unchanged selection/detail/camera, and updated connector paths.
- Plain-arrow focus, six modified-right-arrow combinations, Testing/Security/
  Whole project layers, native search-field selection, Alt-left and Backspace
  navigation pass. Returning into the scope restores the moved card position and
  camera. A live source refresh preserves its position and follows the selected
  symbol from line 3 to line 5 with a new revision and verified source hash.
- No page errors or failed requests were observed. Browsers and loopback servers
  were closed and fixtures removed. One initial syntax typo in the private browser
  harness was corrected before execution; it was not a product failure.

- `npm run package`: all 47 payload files match source and manifest. Actual-bundle
  smoke: 12/12 groups pass. The same complete keyboard browser sequence also
  passes against the produced bundle with the same served-JavaScript hash.

Candidate runtime digest:
`ceae3939e3b0f1e0abee7e00942d6aa431161f1487fa8baaa9c01fa49c677a53`.
Candidate archive SHA256:
`fed705fa89f79967a86e9d2ee5b867000587cc30827cfa226521f63bb0f294b1`.
These identify a local candidate, not a published release.

The PR owns the exact reviewed commit, independent review disposition and CI receipts. These local checks alone do not establish released
or installed behavior. Material follow-up changes require delta review.

## Limits and rollback

Browser validation covers Chrome on this host; Safari, mobile, assistive technology
and real-target installations are unverified. Existing bounded-analysis limitations
and the repository's oversized-wordmark partial context diagnostic remain; no gate
is bypassed. Reviewer read-only conduct is procedural under inherited permissions,
not independently OS-enforced.

Before merge, reject the isolated candidate if necessary. After a separately
approved merge, revert the repair commit or actual merge with a verified mainline
through normal review. This restores the known conflicting Alt-left behavior.
No data migration or target cleanup is needed; published archives and pinned
installations remain unchanged.
