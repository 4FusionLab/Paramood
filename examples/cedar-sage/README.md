# Cedar & Sage — Paramood example

[Русский](README.ru.md) · [Step-by-step walkthrough](../../docs/DEMO.md)

> **Legacy 1.x example:** Paramood 2.0 does not read or migrate the variants in this file. A separate 2.0 demo export is pending.

Download [Cedar-Sage-Paramood.f3d](Cedar-Sage-Paramood.f3d) to try saved model variants in Autodesk Fusion. The file contains the feeder geometry and all three Paramood variants; no separate variant settings file is required. Use Paramood 1.5.0 for the variants and text workflows described in the repository’s main README.

1. Save the actual F3D file from GitHub to your computer.
2. Run Paramood in Fusion and enable **Run on Startup**.
3. Open the F3D from your computer and make the imported document active.
4. Open the variant menu and choose **Classic**, **Compact**, or **Garden**. Inspect the geometry and caption text after switching.
5. Choose **Free** before experimenting without overwriting a supplied variant. Save or export your own copy.

| Variant | Tray width | Tray depth | Post height | Roof pitch |
| --- | --- | --- | --- | --- |
| Classic | 180 mm | 130 mm | 120 mm | 25 deg |
| Compact | 140 mm | 100 mm | 100 mm | 30 deg |
| Garden | 220 mm | 160 mm | 150 mm | 20 deg |

Each variant contains these four geometry parameters plus `post=4` (dimensionless), `caption='Cedar & Sage'`, its own `caption_variant`, and the formula `caption_label=caption+' / '+caption_variant`. The parent rows `post` and `caption` retain their own editable values while expanding to show grouped children.

The exported file defaults to healthy **Classic**. Its exact F3D was reimported and all three variants were applied through the installed palette in Fusion 2706.1.17 on macOS: 24 variant entries resolved and each configuration retained 14 healthy bodies. The imported model was returned to Classic. Native Windows acceptance remains outstanding. See [model-info.json](model-info.json) for the file's SHA-256, size, and recorded checks, and the [walkthrough](../../docs/DEMO.md) for real Fusion screenshots.

Variants store selected parameters rather than a complete model snapshot. Changes through Paramood update an active variant automatically; Free retains the current values without updating variants. A valid parameter change may still produce timeline errors, which do not cause automatic rollback. Inspect geometry before saving a modified copy.

This example is distributed under the project's [PolyForm Noncommercial License 1.0.0](../../LICENSE). Commercial use outside its permitted purposes requires a separate agreement with 4FusionLab.
