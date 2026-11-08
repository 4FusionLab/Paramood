# Paramood user guide

[Русский](USER_GUIDE.ru.md) · [Overview and installation](../README.md)

This guide describes the current source version. Check the notes for the release you install when comparing available features.

## Work in the palette

Open the Paramood palette in the active Fusion design. **Hybrid** is the default view: browse the parameter tree, then use the fixed bottom field for calculations or assignments. Results, history, and previews appear over the list; close that panel to expose the list again. The **Calculator** and **Parameter list** buttons switch views without clearing the shared input.

Enter `2+3` to calculate without writing to the model. Enter `width=30mm; height=width/2` to preview a batch. Review the names, expressions, units, and calculated values, then choose **Apply parameters**. The expression referencing `width` remains a dependency in Fusion.

Names separated by underscores form virtual groups: `box_wall_thickness` appears as `box.wall.thickness`. Both forms work in input. `dN` dimensions appear under **Model parameters**. Driven sketch dimensions are read-only. Click an editable value to edit it; **Enter** validates and applies, and **Escape** cancels. Renaming an editable parameter updates references without changing matching words inside quoted text.

IntelliSense offers model dimensions such as `d1` only when the current token is exactly `d` or `D`, on either side of an assignment. Typing `de`, `d1`, or a number hides those suggestions; existing dimension names remain valid in expressions.

In an inline numeric edit, use `+=5`, `-=5`, `*=2`, or `/=2` to update the existing expression. Addition and subtraction use the parameter's unit for a bare number; multiplication and division use a dimensionless number. Existing formula dependencies are preserved.

The unit selector beside the design name changes the design's display units to `mm`, `cm`, `m`, `in`, or `ft`. It preserves physical sizes. In an inline numeric edit or a variant table cell, a bare number uses that parameter's unit; explicit units make examples easier to share.

Use the copy icon beside a calculator result to copy its value with units. **Copy expression** copies the input expression. A success notification disappears after 3.5 seconds; errors remain until dismissed.

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
See [Variants 2.0](VARIANTS_V2.md). Release awaits the owner's personal acceptance.

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

## Boundaries

- Only parameters of the active design are edited; externally linked components are not modified.
- Fusion may prevent edits or deletion. Driven dimensions remain read-only.
- Existing-parameter updates can use the supported direct path while a Fusion command is active; creating and linking a new parameter can require finishing the command or sketch first.
- Automatic unused-parameter cleanup is unavailable.
- Automated checks and temporary-design Fusion checks are different from a complete installed-palette acceptance test. Native Windows validation remains outstanding; see the release's validation notes for its tested scope.

## Model walkthrough

See the [Cedar & Sage example](DEMO.md) for variant switching, parameter-and-group names, and text formulas on a feeder model.
