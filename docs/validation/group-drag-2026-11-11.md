# Group drag validation — 11 November 2026

[Русский](group-drag-2026-11-11.ru.md)

Dragging a group now uses the subtree rename bridge, including a group's own parameter and nested groups. Dropping onto Named parameters moves it to the root. The gesture preview shows the new prefix; self/descendant drops, occupied destinations, and groups with driven or unidentified members are rejected. Escape, pointer cancellation, focus loss, and snapshot changes cancel the gesture.

## Automated checks

- 545 Python tests and 22 subtests, 50 IntelliSense tests, and 262 frontend tests passed.
- Group pointer tests cover pure/value-bearing groups, nesting, returning to the root, occupied/case-insensitive destinations, self/descendant drops, uneditable members, no-op drops, cancellation, and snapshot changes.
- Ruff, Prettier, ESLint, frontend build, and package build passed.

## Browser

Real Chromium mouse gestures through Playwright moved `box` into `tray` and back to Named parameters. The actual App sent one `parameters.renameGroup` request per move with both descendant identities. Refreshed names and dependency expressions matched the new prefix. This browser check used a simulated Fusion transport. The only browser console error was the development server's missing favicon.

## Installed Fusion

Autodesk Fusion 2706.1.17 on macOS, using a dedicated temporary model and the updated running add-in:

- Dragging `box` into `tray` produced `tray_box_width` and `tray_box_inner_depth`; Fusion changed the dependent expression to `tray_box_width / 2`, preserving its value.
- Dragging `tray.box` onto Named parameters restored both original names and the dependent expression.
- One native Undo restored the entire nested group; Redo returned the entire group to the root.
- Dragging `box` onto its own `inner` subgroup displayed “Choose a different group.” Names and expressions stayed unchanged.
- The temporary document was closed without saving. The original document was restored, and its parameter names, expressions, and units matched the pre-test snapshot.

The add-in was reloaded in Fusion's main Python context for the native gesture checks. Native Windows acceptance and every possible CAD model remain untested.
