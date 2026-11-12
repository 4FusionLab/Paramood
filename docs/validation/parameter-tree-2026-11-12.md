# Parameter tree verification — 12 November 2026

[Русский](parameter-tree-2026-11-12.ru.md)

## Implemented scope

Search by native/virtual name, expression and comment, case-insensitive Unicode matching,
ancestor context, empty results, independent search expansion and prior scroll restoration.
Favorites terminology and hover/focus deletion retain the existing bridge and deletion policy.
Units are plain text without a change control, click action or disclaimer; no parameter-unit mutation,
replacement, dependency-based permission claim or document-unit substitution is introduced.
See [the unit matrix](../PARAMETER_UNITS.md).

## Offline

- Frontend: 270 tests passed, including eight added regressions for search, Unicode,
  ancestor values, restoration, existing row actions, noninteractive units, collapsed search and the interaction
  between a completed drop, manual collapse and clearing a search.
- Final combined run after the separate Circle fix: Python **560 passed + 22 subtests**;
  root JavaScript **50 passed**; frontend **270 passed** (15 files).
- Prettier, ESLint, Ruff formatting/lint and TypeScript/Vite build passed.
- A local release ZIP was built with an explicit 2.1.0 version for package validation only;
  no tag, commit, push or release was created by this task.
- Manual contract/security review: search renders escaped text through Preact; it introduces
  no executable input or bridge action. Delete/favorite/rename requests and document checks
  remain the owning backend's responsibility. Drag calculations continue to use the full
  parameter snapshot, including when the visible tree is filtered.

## Browser — fixture bridge, not native acceptance

Playwright Chromium, 360×680 and 960×720, normal motion:

- Cyrillic comments, full dotted path, expression and no-match state checked.
- Inline editor remains present and search retains focus when filtering an edited row.
- Favorite action sends the original native name, entity token, expected state and document ID.
- Delete opacity settles at 0 off-row and 1 on hover/focus. Value x-position and width stay equal.
- Clearing restores 500 px of palette scrolling (also 1544 px at the bottom with Favorites open) and the independent collapsed group state.
- Units have no buttons, selectors or disclosure text. Search starts collapsed, opens with the magnifying glass, focuses its field and closes with Escape/X while restoring focus and the tree.
- Visual layouts inspected. Only console error was the development server's missing favicon.

## Fusion

Installed Fusion 2706.1.17 on macOS: read-only inspection confirmed that both
`UserParameter.unit.fset` and `UserParameter.valueType.fset` are absent. No setters or
change-type methods are exposed on UserParameter. This confirmed the API boundary before palette validation. Temporary models subsequently verified:

- Creation with every one of the 96 named units in the existing catalog, plus Text and
  dimensionless parameters. All creations succeeded; Fusion normalizes some unit spellings.
- `1 in` in a millimeter parameter and `1 rad` in a degree parameter preserve the assigned
  unit. Physical values, dependent formula, original entity token resolution, comment and
  favorite state remained valid. Conversion to a new assigned unit remains unavailable.
- Installed palette before the final collapsed-search refinement, normal native bridge, dark theme: Cyrillic comment search, group context,
  20→25 mm inline editing, moving the filtered `box_inner_depth` into `tray` by dragging its
  name, Favorites toggle, empty search and Escape restoration. Native readback confirmed
  `tray_depth = box_width / 2`, value 12.5 mm, and unchanged comment.
- Both task-owned temporary documents were closed without saving; the previous document,
  parameter fingerprint and modified state were restored.

The separate [Circle investigation](circle-parameter-transactions.md) reproduced and fixed
parameter rollback in a native command. Its runtime changes were included in the final
combined checks above. That native acceptance belongs to the separate task.

Windows native acceptance has not been performed.

## Follow-up refinement

The user requested search collapsed by default and removal of all unit/type-change affordances.
Implemented and covered by the final 270 frontend tests and browser checks. The refreshed native
palette visually shows the collapsed search trigger and plain units. Interactive open/close and
focus behavior for this refinement was verified in the browser fixture; the preceding native
editing/drag/favorites acceptance remains recorded above. Formatting, lint, build and local
package checks passed. No model changes were made for this refinement.
