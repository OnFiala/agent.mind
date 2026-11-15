# R08 — Keyboard contract acceptance

Date: 2026-11-15. Base: `e6f1de23c5198a1e0c71b3c4f521516e6ee489e4`.
Status: **acceptance follow-up candidate, unmerged and unreleased**. The owner
requested R08, agent swarm, tests, documentation, CORTEX and a standalone PR with
independent review, explicitly without merge or release.
[ROADMAP](../../ROADMAP.md#r08--keyboard-contract) owns stage status; the follow-up
[PR #31](https://github.com/OnFiala/agent.mind/pull/31) owns exact reviewed commits,
independent disposition and CI receipts.

## Existing implementation and remaining acceptance

R08 denotes the keyboard movement/Back collision already repaired by
[PR #27](https://github.com/OnFiala/agent.mind/pull/27), merged as
`e312ff13bdf64cbd16697fc7a6e85bc231a3166a`. The
[UI-NEW-02 record](2026-11-15-keyboard-movement.md) owns that original change and
its historical checks. R08 does not introduce another shortcut scheme or authorize
R09. Published 1.3.1 and existing pinned installations still predate the repair.

The original acceptance requires focused-card tests and browser checks for all
four movement directions, Back navigation and editing-field exclusions, while
preserving selection, camera and pointer dragging. Current source already uses
Shift plus arrows for movement, plain arrows for spatial focus and Alt-left or
Backspace for scoped Back. A native labeled Back button remains available. Card
tooltips and README agree with this contract.

Eight existing card-handler tests cover displacement, redraw, plain-arrow focus
and modifier rejection. They do not execute the document handler that receives
bubbled events and protects editing controls. This follow-up supplies that direct
regression coverage and binds fresh browser evidence to the current source.

## Change boundary

`handleDocumentKeydown` contains the former inline document listener body. The
same listener invokes it with the existing state and callbacks; search focus is
passed as a callback that still resolves the same search element when invoked.
No conditions, key bindings, default-prevention or propagation rules are changed.
The entire existing document dispatcher is retained together so that Back, Escape,
search, fit and zoom keep their relative precedence.

Ten added tests exercise the production handlers:

- All four plain/Shift card-arrow events pass through the document handler without
  causing navigation or changing the result of the card handler.
- Alt-left and Backspace rejected by the card handler reach exactly one document
  Back action, with the existing default prevention and no card movement.
- Input, textarea and select targets retain native editing and do not dispatch
  document Back/search/fit/zoom shortcuts.
- Escape keeps panel-close precedence, including when editing, and navigates Back
  only outside editing controls when no panel is open.
- Existing search, fit, zoom, modifier rejection and unrelated-key behavior remain.

These are direct production-handler tests with explicit dispatch order; actual DOM
bubbling and native editing require the browser checks below. They do not add a
contenteditable contract or promise behavior for arbitrary injected controls.
The DOM, CSS, card/pointer handlers, navigation state model, graph/source APIs,
installation format, dependencies and versions are unchanged.

## Verification

Focused UI/hierarchy tests: **66/66 passed** on Node 22.23.4. A separate equivalence
probe compares the original inline dispatcher from the base commit with the
extracted production handler across **5,376 cases**: keys, every Alt/Ctrl/Meta/Shift
combination, initial default-prevented state, input/textarea/select/non-editor targets
and open/closed panels. Callback order, selector/read order, default prevention and
state match exactly. This is bounded behavior evidence, not a general UI proof.

The full Node 22.23.4 suite passes **410/410 tests**. Packaging produces 47
runtime payload files whose hashes all match the final source. The actual bundle
passes all **16 installed-CLI/lifecycle smoke groups** in disposable fixtures.
This is candidate-bundle evidence, not installation into a real user project.

| Candidate binding | SHA-256 |
| --- | --- |
| `public/visualizer.js` | `176cd5a03c159a112edcee6364b940245bd2c9b4563fd263cd225a915aa62c66` |
| Artifact digest | `fb246d5319de84e3118e3c829738d677f11d5442351685038b95639654bfb2fc` |
| Archive | `751bc7a1f20c709a3c4de6dc5c63e5733de58b9c526a9cbfe999ec168403c251` |

Fresh browser runs on both source and the actual bundle use isolated headless
Chrome 157.0.8103.52, Playwright 1.61.1 and a 1440 by 1000 viewport. Each completes
16 check groups, including eight native Shift-arrow movements across root and
nested scopes, exactly 20 canvas units per movement; 48 modified-arrow events
through the actual bubbling listeners; plain-arrow focus; pointer dragging after
keyboard offsets; all three layers; explicit source refresh; native input/select
exclusions; and Alt-left, Backspace and keyboard activation of the native Back
button. Served UI bytes match the source and bundle hash above. No scanned fixture
code is executed.

Movement, pointer dragging and live refresh preserve selection, visible source
details and camera. Plain spatial-focus navigation may pan to reveal the focused
card. Back/reentry retains selection, layout and camera, but intentionally closes
the inspector; reopening Selection details verifies current source content/hash
and the refreshed symbol line. The main agent inspected source and bundle
screenshots after the browser worker's visual checks.

Both browser runs have zero page errors. Each records one canceled older source
request with a successful same-URL replacement, followed by successful refreshed
and reopened current-source requests. Cancellation is attributed individually;
there is no blanket suppression. The first harness run incorrectly required plain
focus navigation to retain camera; that assertion was corrected to match the
existing reveal behavior. Later harness revisions strengthened cancellation and
visible-detail checks. Failed and intermediate attempts remain in private evidence;
these observations required no product changes.

Fresh graph context reports a valid input policy and the exact UI hash above;
overall status remains partial only because of the pre-existing oversized wordmark
asset. Local documentation links and diff whitespace checks pass. Exact final-commit
independent review and Node 22/24 CI receipts belong to the follow-up PR, separate
from these local checks. The original PR #27 browser evidence remains historical.
Private harnesses, logs, fixtures and screenshots are excluded from commits.

## Limits and rollback

The final PR must distinguish current checks, inherited implementation and released
behavior. No target is installed or upgraded by this contribution. Source context
may remain partial because of pre-existing input limits; no preflight is bypassed.
Browser coverage is limited to this desktop Chrome fixture; Safari, Firefox,
mobile, assistive technologies and real installed targets are unverified. Prior
PR #27 verdicts were exposed to the browser worker, so its fresh execution is not
claimed as a blind review. Reviewer read-only restrictions are procedural under
inherited permissions. All task-owned browsers/servers were closed and disposable
browser fixtures removed; no foreground view remains.

Before merge, withdraw this follow-up. After a separately authorized merge, a
reviewed revert of this follow-up restores the original inline document handler
and prior tests/docs; it retains PR #27's Shift-arrow fix and every source/map
identity. Reverting PR #27 would instead restore the known Alt-left collision and
requires a separate decision. No data migration, cleanup or browser-storage reset
is needed. Release and real-target operations remain separately gated.
