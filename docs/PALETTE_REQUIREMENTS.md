# Interface clarification of 5 November 2026

[Русская версия](PALETTE_REQUIREMENTS.ru.md)

> **Historical requirements.** This note records decisions and implementation limits at the time. For current behavior and validation status, see the [README](../README.md).

These requirements replace conflicting provisions of the original `REQUIREMENTS.md`.

- One main `Paramood` palette contains a shared field: an expression without `=` is calculated, while assignments show a preview and are applied explicitly. Batches are separated by `;`.
- Default placement is the lower-left modeling area above Comments, as in the supplied image; if Fusion limits placement, use the nearest officially supported option and state the verified limits.
- The interface is vertically compact without losing information. IntelliSense is visually aligned with Fusion.
- Parameter Cleanup is a separate palette, initially closed. It opens from a button in the Paramood palette or a command next to Show Paramood in the top menu. Only analysis is available at this stage; deletion is blocked.
- Other requirements of the original specification remain, including model safety and the absence of parameter sorting.
- The name `Paramood` appears in the native Fusion title without duplicate branding inside.

## Structured parameter list — 5 November

- In a narrow palette, icon buttons switch between the main editor and list; the editor is shown by default. At widths from 640 px, both areas appear side by side and the buttons are hidden.
- The list shows user parameters before model parameters, preserving order within groups. Names with nonempty `_`-separated segments form a collapsible hierarchy as in IntelliSense. A chain indicates a discovered direct or indirect dependency of a model parameter on a user parameter.
- A user parameter is edited in the list through preview and explicit application with a document-snapshot check. At this stage, model-parameter editing is blocked by the existing adapter and requires separate validation; this is an implementation limitation, not a target requirement.
- Editing a user parameter opens by clicking its expression or edit icon in the row. In the two-column layout, the areas scroll independently.
- Clarification: the expression is changed in a compact inline field at the value; Enter applies, Escape cancels. Visible preview and separate buttons are unnecessary; validation and model snapshot remain inside the operation.
