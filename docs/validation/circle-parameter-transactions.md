# Parameter persistence during native sketch commands

[Русская версия](circle-parameter-transactions.ru.md)

## Reproduced failure

Native acceptance used Autodesk Fusion 2706.1.17 on macOS and a dedicated unsaved
`Paramood Circle Repro TEMP` document. Existing user documents were neither changed nor closed.

1. Create `baseline=20 mm` before starting the native command.
2. Edit a sketch and start `CircleCenterRadius`.
3. Submit `parameters.preview` and `parameters.apply` through the installed add-in's
   actual `HtmlHandler`, using the current document ID and preview snapshot token.
4. The handler reports success and `Design.userParameters` includes the newly created parameter.
5. Cancel the native Circle command with Escape.

Before the fix, `circle_size=30 mm` disappeared from the native user-parameter collection.
A second run applied `circle_second=30 mm;baseline=40 mm`: after Escape,
`circle_second` disappeared and `baseline` reverted to `20 mm`. The captured Document and
Design objects were unchanged. The assertion `CREATED PARAMETER LOST AFTER CIRCLE` failed
in both reproductions. No manual deletion or Undo was involved.

This is model rollback, not a palette filter or failed `state.get`. The direct apply path
allowed palette writes to be absorbed by the running native command's transaction.
Autodesk documents that preview transactions are aborted on regeneration and before execution:
[Fusion command transactions and previews](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/Commands_UM.htm).
Native cancellation was reproduced; loss on successful Circle confirmation was not separately
established and is not needed to reproduce this failure.

## Fix and chosen interaction

For `parameters.apply` while a native command is active, always use the existing independent
`ParamoodApply` transaction path, even when Fusion exposes the current selection:

- Validate the submitted preview token before terminating the native command.
- End the native command through the documented `terminateActiveCommand` API.
- Revalidate the plan in `ParamoodApply.execute`, including document identity, before writing.
  A changed plan is rejected as `STALE_PREVIEW`; a matching plan uses its fresh snapshot token.
- An adapter guard refuses direct parameter Apply while a native command is still active.

The user explicitly chose automatic Circle termination and reliable parameter persistence while
leaving the sketch open. The native command is ended, not transparently suspended and resumed;
an unconfirmed native preview is not preserved. Previously completed sketch geometry remains.
The user can start Circle again and use the saved parameter. The idle sketch (`SelectCommand`)
path is unchanged. This change covers parameter creation and expression updates, including
mixed batches; it does not redesign favorite, rename, deletion, or variant operations.

API references:
[terminateActiveCommand](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/core_UserInterface_terminateActiveCommand.htm),
[CommandDefinition.execute](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/core_CommandDefinition_execute.htm),
[activeCommand](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/core_UserInterface_activeCommand.htm).
Context7 resolution and queries were attempted; they returned no matching transaction documentation,
so the official Autodesk pages were used directly.

## Verification

Offline checks on the shared working copy:

- Ruff formatting and lint: pass; Prettier and ESLint: pass.
- Python: 560 tests and 22 subtests pass, including the new active-command guard cases and
  transaction routing with both accessible and inaccessible selections.
- Root IntelliSense tests: 50 pass; frontend tests: 269 pass across 15 files.
- Frontend production build and local ZIP package build: pass. No tag, commit, push, or release.
- Review: existing request validation, document identity and stale-plan checks remain in force;
  the change adds no new input channels or filesystem/network operations.

Native macOS results after loading the changed installed source:

- During Circle, actual `HtmlHandler` Apply returned success for
  `circle_fixed=25mm;circle_half=circle_fixed/2;baseline=40mm`.
- Circle ended, the sketch remained the active edit object, and all three expressions were saved.
- A subsequent native Circle was created. Its diameter expression was assigned `circle_fixed`
  through the documented `ModelParameter.expression` API, producing a radius of `1.25 cm`.
- After Escape and Finish Sketch, the native user parameters and the diameter reference remained.
- A separate baseline test confirmed idle-sketch creation survives Finish Sketch.

The requests above were submitted through Fusion's Python console to the real installed bridge
handler; this was not an end-to-end test of typing into the palette editor. Browser interaction
was not separately tested for this backend-only change. Native Windows acceptance and preserving
an unfinished Circle preview were not tested. Run on Startup was not changed.
