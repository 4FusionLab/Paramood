# Find References validation — November 12, 2026

Implemented parameter reference lookup, dependent-parameter drill-down with breadcrumbs, selection with current document/entity/membership validation, collapsed group expansion, and conservative dashed unused-user-parameter markers. Source validation uses the official Autodesk Parameter, ModelParameter, SketchDimension, TimelineObject, TimelineGroup and Selections documentation. Context7 was consulted for Fusion (no matching selection documentation returned) and Preact hooks.

## Offline

665 Python tests (plus 22 subtests), 50 IntelliSense tests and 294 frontend tests passed. Ruff format/check, Prettier, ESLint, TypeScript/Vite and deterministic package build passed. The package was built in a temporary directory; it is not a published release.

Security review: bridge requests require request/document identities; parameter tokens resolve to the current named entity; selection recomputes reference membership and resolves entity identities rather than trusting arbitrary client tokens. Displayed formulas are escaped JSX text. Active commands/sketch editing are preserved. Missing graph coverage cannot produce unused markers. Selection failure restores previous selection/group state where available.

## Browser

Chrome with a 440 × 680 viewport, using the production frontend and a read-only snapshot captured from the dedicated Fusion test model. Verified the dashed unused name, reference popup, direct/indirect expressions, dependent-parameter drill-down and breadcrumb return. Browser feature selection was not connected to Fusion. Screenshots were saved outside the repository. Popup entry/exit and result animations honor reduced motion; browser screenshots do not establish native WebView animation acceptance.

## Native macOS Fusion

A new unsaved document named `Paramood Find References TEMP` contains `width`, `half_width = width / 2`, `unused`, a diameter-driven circle sketch and an extrusion driven by `half_width`. Lookup returned the sketch as direct and Extrude1 as indirect, and identified only `unused` as unused. Selection API readback confirmed both sketch and extrusion selection. A collapsed timeline group expanded on selection, and a suppressed extrusion remained discoverable/selectable. Parameter expressions and body count were preserved. Expanding the group changed the numeric marker index from 1 to 2 because visible timeline indices changed; both features remained unrolled and the history position was logically unchanged.

The installed palette's complete click-to-timeline path was not accepted. A separate temporary validation palette did not establish bridge delivery. Automatic review rejected a proposed hot patch of the live adapter/dispatcher because it could disrupt the active add-in. The patch was not executed; normal add-in restart is required for installed-palette acceptance. Existing user models were not edited.


## Installed-palette acceptance follow-up

The earlier installed-palette limitation is superseded by this follow-up. Tested on macOS in Fusion **2706.1.17**, using the same disposable model. The Run toggle retained cached Python modules; the add-in was fully stopped, current adapter/protocol sources reloaded, then started through Fusion's real Python console. No adapter/dispatcher monkeypatch was used. The native palette loaded the current production frontend from the workspace.

Passed through real native palette clicks:

- Hovering a parameter row reveals both Find References and Delete; the unused user parameter has a dashed name. The same CSS supports focus-within and keeps controls visible on devices without hover.
- The width popup lists direct Sketch1 use and indirect Extrude1 use through half_width.
- Clicking half_width opens its own Find References popup; the width breadcrumb returns to the original search.
- Clicking Sketch1 or Extrude1 selects that exact entity; native API readback confirms the selected types and names.
- Clicking Extrude1 while its timeline group is collapsed expands the group and selects Extrude1.
- The unused parameter reports no parameter/timeline references. Escape closes the popup.
- During a real active Extrude command, clicking a reference is refused, the native command stays active, no selection is added and expressions are preserved.

The active-command test found stale confirmation text from a previous successful selection. The frontend now clears that confirmation before every selection attempt; a new regression test covers success followed by refusal. Rebuilt the frontend, reloaded its native WebView, and repeated both success and active-command refusal through actual clicks. The refusal now displays only its error, without the old selection confirmation.

The final native scenario again drilled from width to half_width and selected Extrude1. Final readback: SelectCommand active, only Extrude1 selected, all original parameter expressions preserved, one body preserved, timeline group expanded. The test command was cancelled without creating new geometry. Existing user documents were not edited or saved. The temporary model remains open for review.

After the fixes: **665 Python tests plus 22 subtests, 50 IntelliSense tests, 295 frontend tests**, Ruff, Prettier, ESLint, TypeScript/Vite and package build passed. Screenshots of the native popup, drill-down, selection, hover and active-command refusal are saved outside the repository. Native Windows, F3D save/reopen and OS-level reduced-motion changes were not tested in this follow-up.
