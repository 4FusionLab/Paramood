<p align="center">
  <img src="assets/paramood-banner.svg" alt="Paramood — Keeper of Measure" width="100%">
</p>

<h1 align="center">Paramood for Autodesk Fusion</h1>
<p align="center">
  <strong>Keeper of Measure. Every dimension has a reason.</strong><br>
  A compact, keyboard-friendly workspace for parameters, formulas, and calculations — without leaving Fusion.
</p>

<p align="center">
  <a href="README.ru.md">Русский</a> ·
  <a href="https://github.com/4FusionLab/Paramood/releases">Download</a> ·
  <a href="https://github.com/4FusionLab/Paramood/issues">Issues & feedback</a>
</p>

<p align="center">
  <a href="https://github.com/4FusionLab/Paramood/actions/workflows/ci.yml"><img src="https://github.com/4FusionLab/Paramood/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
</p>

## Parameters should feel like code

Paramood puts an expression editor, calculator, and a browsable parameter list into **one Fusion palette**. Define several dimensions at once, inspect the preview, and apply changes without navigating the native Parameters dialog for every edit.

The idea is simple: **use the precision of parametric CAD with the speed of an IDE**. Paramood is an interface over real Fusion parameters, not a separate parameter storage system.

## What works today

| Area | Capability |
| --- | --- |
| **Quick input** | One field for calculations and parameter assignments. Expressions without `=` are evaluated; assignments open a preview and require an explicit **Apply parameters** action. |
| **Batch parameters** | Create and update parameters from semicolon-separated definitions, preserving formula references. |
| **IntelliSense** | CodeMirror completion for parameter names, nested virtual paths, and keyboard navigation. |
| **Parameter browser** | A collapsible, hierarchical list of named parameters and Fusion-generated model parameters, with displayed values and units. |
| **Inline editing** | Click a parameter value to edit its expression; press **Enter** to validate/apply or **Escape** to cancel. |
| **Parameter removal** | Delete individual parameters from the list when Fusion permits it; failed or unsupported deletions return an error. |
| **Model awareness** | Refresh on document changes; show indicators for known sketch, feature, or other parameter links. |
| **Calculator** | Evaluate expressions against the current design, see formatted results, reuse recent calculations, and copy results or expressions. |

### A short example

Type the following in the Paramood field:

```text
box.inner.size = 25mm; box.width = box.inner.size * 2
```

Paramood presents the definitions for review. After you apply them, the **actual Fusion parameter names** are `box_inner_size` and `box_width`; the dotted syntax is a readable virtual view of those names. Fusion continues to store and evaluate ordinary parameter expressions.

The virtual hierarchy is also used for completion:

| Fusion parameter | Paramood editor |
| --- | --- |
| `box_size` | `box.size` |
| `box_wall_thickness` | `box.wall.thickness` |
| `box_width` | `box.width` |

Typing `b` prioritizes `box`. Typing `box.` narrows the suggestions to its members. Original underscore-separated names remain usable.

Other supported workflows include:

```text
2 + 3                 # calculate, without changing the model
width = 15mm          # preview then create/update
width += 2mm          # modify an existing expression
height = width / 2    # retain the parameter dependency
```

These are separate examples: enter the expression or definition without the explanatory comments.

## Install

1. Download the latest **Paramood ZIP** from [Releases](https://github.com/4FusionLab/Paramood/releases), then extract it.
2. In Autodesk Fusion, open **Utilities → Scripts and Add-Ins → Add-Ins**.
3. Click **+**, select the extracted `Paramood` folder, then select **Paramood** and click **Run**.
4. Optionally turn on **Run on Startup**. Paramood opens as a dockable palette; use its toolbar command to reopen it.

The packaged add-in includes the compiled frontend. **Node.js is not required for installation.**

## Compatibility and boundaries

- **Platforms:** Windows and macOS are declared in the manifest. Automated checks run on both (and Linux); interactive Fusion testing has been performed on macOS, while native Windows validation remains outstanding.
- **Scope:** the active Fusion design. User parameters and editable model parameters are supported where Fusion allows changes; parameters in externally linked components are not edited.
- **Safety:** assignment previews are validated again against the current document before applying. Unsupported expressions, dimensions, and stale previews are rejected rather than guessed. Fusion may still report downstream feature errors after a legitimate parameter change.
- **Deletion:** per-parameter deletion is available, subject to Fusion's restrictions. **Automatic unused-parameter cleanup is not available in the current release.**
- **Known limitations:** expression and unit support is intentionally conservative. Virtual dotted names do not create objects inside Fusion; they are a convenience in Paramood.

## Build from source

Development uses **Node.js 22.12+** and Python; the CI Python environment is **3.14**.

```sh
cd frontend
npm ci
npm run lint
npm run format:check
npm test
npm run build
cd ..
python -m pip install pytest ruff
python -m ruff check Paramood scripts tests
python -m pytest -q
python scripts/build_release.py
```

The release builder creates `dist/Paramood-<version>.zip` and a matching `.sha256` file. GitVersion computes release versions from tags and Conventional Commit messages. After successful CI checks, pushes to `main` trigger automated release publishing.

**Tech stack:** Fusion Python API · Preact · TypeScript · CodeMirror 6 · Vite · Vitest · Pytest.

## Part of 4FusionLab

**[Perfora](https://github.com/4FusionLab/Perfora)** · **[Selectra](https://github.com/4FusionLab/Selectra)** · **[Ejix](https://github.com/4FusionLab/Ejix)** · **[RuEn](https://github.com/4FusionLab/RuEn)** · **[Planara](https://github.com/4FusionLab/Planara)**

Paramood is an independent [4FusionLab](https://github.com/4FusionLab) project and is not affiliated with Autodesk.
