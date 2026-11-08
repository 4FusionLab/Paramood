# Model-wide variant table (2.0)

[Русская версия](VARIANTS_V2.ru.md)

Paramood 2.0.0 is available on the [Releases page](https://github.com/4FusionLab/Paramood/releases/tag/v2.0.0).

## Workflow

The header's Free/variant switcher keeps its existing switching interaction. Its menu header shows
the shared parameter/feature counts and one Edit variants button. Individual entries only switch
variants; they have no edit button or per-row count. Edit variants and Create variant open the same
summary table for the model. Configure selects a single ordered set of editable user/model/text
parameters and supported parametric timeline features. Every variant has a cell for every selected
item. Parameters outside this set are global: editing them never enrolls them in variants, including
when a variant is active. A small table icon in the parameter list marks controlled parameters;
its tooltip is **Controlled by variants**, also in Free mode.

- At every palette width: variants are rows; configured parameters/features are columns.
- All headings stay horizontal and wrap at word boundaries. A single word that cannot
  fit breaks as a fallback. Horizontal scrolling begins only when readable value columns no longer fit.
- Drag handles reorder either axis. Both orders are stored in the model. Alt + arrow keys on a handle provide a keyboard alternative. External drag data is
  not accepted as a new item or identity.
- Click a parameter value to edit its expression. The shared CodeMirror editor selects its contents on focus and provides the same IntelliSense,
  dotted/Cyrillic names, functions, units, signatures, highlighting and editing history as the main
  palette. Completion and signature popups are attached outside the scrolling table. Enter/blur
  validates the cell into the draft through a read-only, row-aware native preview; neither writes
  CAD data. This includes `this`, relative edits, creating/linking a new name or `x=25`, and supported
  scaled-variable equations. The preview resolves these against that variant's values, not the
  currently displayed model values.
- A checked feature is **Enabled**; an unchecked feature is **Suppressed**.
- A new variant captures current model values for the configured set. Duplicate copies the row.
  Adding a configured item initializes its cell in every variant from the current model state.
- Click a variant name to rename it in place. Duplicate and Delete buttons are beside the name;
  deletion requires confirmation in that row. The final row is always **+ Add variant**. Removing a configured item or deleting a variant never
  deletes the underlying CAD parameter/feature.

All table edits remain a draft until **Save**. Cancel/close asks before discarding a changed draft.
Saving validates every row first. If the current active variant's cells changed, Save also applies
that row to the model. Other rows are stored without switching. In Free mode no row is applied.
If the active row was deleted, the current geometry is retained and the selection becomes Free.
Storage failure after an active-row apply attempts to restore its expressions and suppression;
failed restoration is reported as a partial operation requiring model inspection.

When Fusion state changes externally, the draft remains visible, Save is disabled, and reloading
requires confirmation before replacing nonempty edits. Requests retain the captured document,
storage and model snapshot identities. No live CAD entities are kept in the frontend.

**Pick from timeline** in Configure starts a draft-only selection mode. Click supported features
in Fusion's timeline; each selected feature becomes a column, with its current Enabled state in
every row. Done picking stops listening. Repeated selections do not duplicate a column. The mode
requires the normal Select command; other active commands are neither interrupted nor terminated.
Selection events carry the document identity and cannot add items to a different document's draft.
The searchable feature list remains an alternative.

New parameters created from a cell remain pending global definitions until Save. They do not
become configured columns automatically. Save validates every row and creates/links the pending
parameters in a native Fusion command transaction. Creating parameters while another command is
active is rejected before any writes; finish that command first. Cancellation discards all pending
creations. Source/preview identities are rechecked before persistence.

Native expressions, extended units and stochastic Preview/Apply are supported. Database-unit conversion covers derived dimensions; random samples are not used
to decide whether an unchanged active row needs reapplying.

## Storage and boundaries

Only format 2 in Design attribute `4FusionLab.Paramood / variants.v2` is used. The older
`variants.v1` attribute is neither read nor migrated nor deleted. Existing 1.x example files retain
their geometry, but their old saved variants do not appear in 2.0. Recreate them using the table.
No Autodesk Configuration API or Configured Design conversion is used.

The attribute holds one ordered column list and ordered variant rows. Each row's parameter and
feature cells must exactly match their respective configured lists. CAD entities are resolved by
`Design.findEntityByToken` and compared as entities when checking duplicates. Names alone are not
used to replace deleted identities. Nonempty unique names, cell types, expressions, dependency
snapshots, payload identities, and the 2 MiB storage bound are validated before persistence.

Feature discovery traverses timeline groups and includes valid parametric `Feature` objects.
Direct features, sketches, groups as a whole and operations without a public Feature entity are not
selectable. Individual features within groups are supported. Enables follow timeline order;
suppression follows reverse timeline order, regardless of table sorting. Existing downstream
timeline warnings/errors remain distinct from failed expression/state writes.

This is a replacement for the agreed parameter/suppression workflows, not full feature parity with
Fusion Configurations. Visibility, materials/appearances, part properties, theme tables, rules,
configured inserts and other downstream workflows are not implemented in this build.

## Verification

- Offline: core format and ordering, all-row validation, parameter-set boundaries, active-row Save,
  failed-write restoration, stale requests, feature identity/order and collapsed-group traversal.
- Frontend: global membership, Enabled semantics, draft retention/cancellation, both reorder axes,
  foreign-drop rejection, switcher actions and parameter markers.
- Browser: the real frontend in `frontend/variants-preview.html` with a clearly simulated bridge;
  one consistent orientation at all widths, word-wrapped headings, late overflow, dragging and saved cell order.
- Fusion on macOS, 2706.1.17: `tests/fusion_variants_v2_smoke.py` (`run`, then `finish` after the event loop) ran on a disposable document;
  save in Free did not apply, extrusion suppression/unsuppression worked, physical heights of 35
  and 45 mm were checked, active-row Save applied only that row, outside-set edits stayed global,
  controlled markers were present in state, native feature selection and its event were received,
  legacy data remained untouched, and Free kept geometry.
  A separate native UI test clicked the extrusion icon in the temporary model timeline and
  confirmed the selected ExtrudeFeature and activeSelectionChanged event. The temporary documents
  were discarded and the original document restored. Cell creation preview left the new parameter
  absent; a real command transaction then created `draft_beam` and linked the 27 mm target without
  adding it to the configured set.
- This source-adapter smoke test does not prove the installed palette UI, F3D round-trip, all
  feature types or Windows operation. A separate scoped installed-palette and F3D round-trip check
  is recorded in the [validation record](releases/2.0.0-review-checklist.md).

API sources: [Feature.isSuppressed](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/fusion_Feature_isSuppressed.htm),
[Feature.isParametric](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/fusion_Feature_isParametric.htm),
[TimelineObject.entity](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/fusion_TimelineObject_entity.htm),
[Feature.entityToken](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/fusion_Feature_entityToken.htm).

Selection API: [UserInterface.activeSelectionChanged](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/core_UserInterface_activeSelectionChanged.htm).
