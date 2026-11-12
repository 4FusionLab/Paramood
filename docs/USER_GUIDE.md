# Paramood user guide

[Русский](USER_GUIDE.ru.md) · [Overview and installation](../README.md)

This guide describes the current source version. Check the notes for the release you install when comparing available features.

## Work in the palette

Open the Paramood palette in the active Fusion design. **Hybrid** is the default view: browse the parameter tree, then use the fixed bottom field for calculations or assignments. Results, history, and previews appear over the list; close that panel to expose the list again. The **Calculator** and **Parameter list** buttons switch views without clearing the shared input.

Enter `2+3` to calculate without writing to the model. Enter `width=30mm; height=width/2` to preview a batch. Review the names, expressions, units, and calculated values, then choose **Apply parameters**. The expression referencing `width` remains a dependency in Fusion.
While editing a definition, the previous preview stays visible until the current expression has been checked. Apply remains disabled while that preview is outdated. Search opens and closes with a short height animation; reduced-motion preferences are respected.

A trailing semicolon is allowed in a batch: `width=30mm; height=width/2;`.

Names separated by underscores form virtual groups: `box_wall_thickness` appears as `box.wall.thickness`. Both forms work in input. `dN` dimensions appear under **Model parameters**. Driven sketch dimensions are read-only. Click an editable value to edit it; **Enter** validates and applies, and **Escape** cancels. Renaming an editable parameter updates references without changing matching words inside quoted text.

Drag an editable parameter by its name onto an existing virtual group to move it there. The drop preview shows the resulting native name: moving `box_width` into `tray.inner` renames it to `tray_inner_width`. Drop onto **Named parameters** to return it to the root (`width`). Only the dragged parameter is renamed. A conflicting name blocks the move; **Escape** or releasing outside a group cancels. Clicking the name still opens manual renaming.

Click a group name to rename the entire subtree, including groups without a value. Edit the full underscore-separated prefix (`box_inner` → `tray_inside`), then press **Enter**; **Escape** cancels. Every nested parameter receives the new prefix, and saved variant formulas and column names follow the rename. A group that also has its own value renames that parameter too. Conflicting names, read-only members, or a changed group block the operation before writing.

Drag a group by its name onto another group to move the whole subtree, including all nested groups and parameters. For example, moving `box` onto `tray` changes `box_inner_depth` to `tray_box_inner_depth`. Drop the group onto **Named parameters** to return it to the root. Its own value, if present, moves too. The preview shows the new prefix. Occupied destination names or groups and dropping inside the source subtree are rejected; **Escape** cancels.

Right-click a parameter row and choose **Copy parameter reference** to copy its full native name, such as `box_wall_thickness`, for pasting into Fusion expression fields. Virtual groups are not parameters and have no copy action. Text editors retain their standard context menu.

IntelliSense offers model dimensions such as `d1` only when the current token is exactly `d` or `D`, on either side of an assignment. Typing `de`, `d1`, or a number hides those suggestions; existing dimension names remain valid in expressions.

Unit suggestions appear only after you start typing a unit after a value (for example, `25m` or `25 m`); a number or trailing space alone does not open the unit list.

In an inline numeric edit, use `+=5`, `-=5`, `*=2`, or `/=2` to update the existing expression. Addition and subtraction use the parameter's unit for a bare number; multiplication and division use a dimensionless number. Existing formula dependencies are preserved.

The unit selector beside the design name changes the design's display units to `mm`, `cm`, `m`, `in`, or `ft`. It preserves physical sizes. In an inline numeric edit or a variant table cell, a bare number uses that parameter's unit; explicit units make examples easier to share.

Use the copy icon beside a calculator result to copy its value with units. **Copy expression** copies the input expression. A success notification disappears after 3.5 seconds; errors remain until dismissed.

Changes made while a native command such as Circle is active are checked before Paramood ends that command, then applied in a separate transaction while leaving the sketch open. This covers parameter Apply, rename, group rename, Favorites, deletion, variant actions and document display units. Unconfirmed preview geometry is discarded, and the native command is not resumed; completed geometry remains. The request is checked again after the preview ends. A changed parameter, plan or snapshot is rejected before writing and requires a refresh; invalid requests do not end the command. Finish Sketch remains your choice.

Search is collapsed by default. Click the magnifying glass beside **Named parameters** to open **Search parameters** and filter by name, full native name (`box_inner_width`), virtual path (`box.inner.width`), expression, or comment. Search ignores case and supports Cyrillic. Matching rows retain their group context and open automatically; **Close search** or **Escape** closes the field and restores the previous group expansion and scroll position. Editing, favorites and group moves remain available in the results.

**Favorite parameters** mirrors Fusion's Favorites. The delete cross appears on row hover or keyboard focus and reserves its space; Fusion's deletion restrictions still apply.

## Variant table 2.0

Open the common table through **Create variant** or **Edit variants** in the variant menu header. Configure selects one model-wide set
of parameters and supported features. Click a cell to edit that variant's expression; a checked
feature is enabled, and an unchecked feature is suppressed. Drag handles reorder either axis. Mouse gestures and saved-order round-trip were checked in Fusion on macOS.
Variants are always rows; parameters/features are always columns, at every width. Names wrap at word boundaries;
scrolling begins only when readable value columns no longer fit.

The table remains a draft until Save. Cancel/close lets you confirm discarding changes without
changing the model. Save validates every row, applies only the edited active variant, and stores
the table. In Free it only stores values. Parameters outside the configured set stay global and
are never enrolled automatically. A table icon in the common parameter list marks configured items.

Old 1.x variants are neither read nor migrated; 2.0 uses a separate storage format.
See [Variants 2.0](VARIANTS_V2.md).

## Save and share with F3D

Variants are stored in the Fusion design's attributes. Use Fusion's ordinary save or F3D export to retain them; Paramood does not initiate a cloud save. Share the F3D, then open it in Fusion with Paramood running to read its variants.

On reopening, Paramood compares saved member values with the model. Numeric comparisons use a tolerance in Fusion's internal units; text comparisons are exact, including spaces and empty text. A complete match selects that variant. If several match, the first row in the saved order is selected; if none matches, the header shows **Free**. A previous explicit Free choice is not a persistent reset instruction for a later reopen.

Applying a valid parameter expression can still produce a failed feature in Fusion's timeline. Timeline warnings and errors do not trigger a rollback of the applied variant. Inspect geometry and choose a healthy configuration before saving a model for others. Expression errors, stale requests, and incomplete writes are reported separately.

## Text parameters

A quoted literal creates text automatically:

```text
caption='Body'
```

`caption="Body"` is also accepted. The list shows the computed text; opening its editor shows the source expression. Formula editing preserves references:

```text
label=caption+' / Compact'
```

For an existing length parameter `width`, a conditional text expression is:

```text
label=if(width<20 mm; 'Short'; 'Long')
```

Supported text expressions include literals, text parameter references, `+` concatenation, and `if` with a single comparison of compatible values. Numeric and text operands cannot be mixed, and an existing parameter's type cannot be changed.

| Input | Content |
| --- | --- |
| `caption=''` | Empty text |
| `caption='a=b;c'` | Equals sign and semicolon inside text |
| `caption='Bird\'s feeder'` | An embedded apostrophe |
| `caption='Line 1\nLine 2'` | A line break |
| `caption='C:\\Example'` | A literal backslash |

Both input quote styles are normalized to Fusion's single-quoted expression syntax. Supported escapes are `\'`, `\\`, `\n`, `\r`, and `\t`; an unescaped double quote can appear inside a single-quoted literal. Unknown escapes and adjacent literals such as `'a''b'` are rejected; use `'a'+'b'` to concatenate.

A text result is limited to 65,536 characters. The projected text across a planned batch is limited to 262,144 characters. Unsupported expressions that are needed for a requested update are rejected; unrelated text formulas do not by themselves prevent numeric changes. Dependency checks still apply to the full model graph.

## Clean unused parameters

Click the broom beside tree search. The separate **Paramood-Cleanup** palette analyzes the active model and lists candidate names, expressions and values. Opening or refreshing the preview does not change the model.

Candidates are initially selected. Uncheck any parameter to keep it; all inputs required by its formula are also kept, with a reason shown beside them. Favorites, parameters needed by model operations and saved variant targets/formulas are protected. Search filters the displayed rows; it does not change the selection. Use **Deselect all** to clear the full selection.

Click **Delete selected…**, review the count and confirm **Delete parameters**. Paramood rechecks the document, parameter identities, model graph, saved variants and preview, then checks native deletion permission at each step. A refusal aborts the whole transaction. Use Fusion Undo to restore a successful cleanup. Refresh the preview after any conflict or external model change. A chain may still be refused if Fusion exposes an additional native blocker only after its dependent parameters have been removed; that transaction is rolled back.

## Boundaries

- Only parameters of the active design are edited; externally linked components are not modified.
- Fusion may prevent edits or deletion. Driven dimensions remain read-only.
- A valid model-changing request ends an active native command before writing in a separate Paramood transaction. Finish or cancel the native command yourself first if its current preview needs to be completed. Idle sketch editing remains supported. Variant and document-unit snapshots are not silently replaced after preview cancellation; a changed snapshot requires refreshing and retrying.
- Ordinary selections exposed by Fusion are captured before starting the parameter transaction and restored after it ends. Restoration stops if the active document or command changes; invalid objects and unrelated new selections are left alone. Selection from an ended native preview is not restored. Parameter creation is re-evaluated after preview rollback and continues only when the planned operations still match the original preview. Circle transactions, saved variants, text, deletion, document units and selection restoration have been checked in a disposable model on macOS; other native commands are not fully validated. See [the independent repeat acceptance](validation/strict-reacceptance-2026-11-12.md).
- Cleanup only removes user parameters after an explicit preview and confirmation. An uncertain native dependency graph, unresolved saved variants or an outdated preview blocks deletion.
- Automated checks and temporary-design Fusion checks are different from a complete installed-palette acceptance test. Native Windows validation remains outstanding; see the release's validation notes for its tested scope.

## Model walkthrough

See the [Cedar & Sage example](DEMO_V2_DRAFT.md) for variant switching, parameter-and-group names, and text formulas on a feeder model.

### Find References

Hover over a parameter row to reveal its magnifying glass, then click it to open **Find References**. The popup lists owning sketches and timeline features, the expressions that use the parameter, and dependent user parameters. **Direct** references name the parameter in their expression; **Indirect** references show the intervening parameter path. Multiple uses in one feature are grouped together.

Click a dependent parameter to run Find References for that parameter. Use the breadcrumb buttons to return to an earlier search. Click a feature or sketch to select it in Fusion. Finish the active command or sketch edit before selecting a result. Selection rechecks the active document, parameter identity and current reference membership; it does not move the timeline marker or change expressions.

A dashed underline marks a user parameter with no verified dependents and no use in saved variant columns or formulas. Model parameters are already owned by model objects. Unknown or inconsistent dependency data never produces an unused marker. A result with an unresolved timeline owner displays a warning instead of claiming there are no uses. External or private references not exposed by Fusion's parameter API cannot be enumerated.
