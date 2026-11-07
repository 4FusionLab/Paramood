# Paramood — product concept

[Русский](PRODUCT_CONCEPT.ru.md) · [User guide](USER_GUIDE.md)

## Purpose

Paramood helps Fusion users manage the meaning behind dimensions: names, expressions, results, and dependencies. It works with real Fusion parameters and preserves their formulas. A compact palette keeps the model visible while the user edits or compares configurations.

This document describes the current product direction. The [README](../README.md) gives installation instructions and the release notes distinguish shipped behavior from preparation for the next release.

## Current workflows

### Quick parameters and calculator

One field accepts calculations and batches such as `width=15mm; height=width/2`. Calculations do not write to the model. Assignments are previewed and validated again before applying. IntelliSense offers existing names and virtual groups inferred from underscores.

### Parameter browser

A hierarchical list shows user and model parameters, units, computed values, and known model links. Inline editing keeps source expressions available; driven sketch dimensions remain read-only. Visual grouping is local to Paramood and does not reorder Fusion's native parameters table.

### Hybrid workspace

The default Hybrid view combines the list with a fixed input field. Results, history, and previews appear in a dismissible overlay. Separate Calculator and Parameter list views preserve shared input. Fusion changes are synchronized automatically.

### Saved variants

Named sets of selected parameter expressions allow switching sizes and configurations. Variants live in design attributes and travel with an F3D export. Paramood edits update an active variant; Free lets the user work without updating it. Variants capture their member parameters rather than the entire model. They include text parameters, so a configuration can carry both dimensions and a label.

### Text parameters

Quoted values infer text type. The browser displays computed text while editing preserves references, concatenation, and supported conditional formulas. Text and numeric types remain distinct.

## Technical approach

- A Python add-in performs Fusion API operations in the permitted execution context.
- A TypeScript/Preact HTML palette uses CodeMirror for input.
- Validated JSON messages connect the palette, planning logic, and Fusion adapter.
- Expression planning is independent of `adsk`; the adapter validates document freshness, units, dependencies, and writable entities before writes.
- Writes preserve `expression` rather than replacing formulas with evaluated values or text.
- Variants use design attributes and stable parameter identities; they do not replace native CAD parameters.

## Boundaries and future direction

Per-parameter deletion is available where Fusion allows it. Automatic unused-parameter cleanup remains unavailable. A future cleanup workflow must review dependencies, protect model references, and require explicit parameter selection.

Valid parameter changes may produce failed downstream features. Timeline warnings and errors are reported by Fusion and do not trigger Paramood rollback. Native platform validation remains separate from automated tests; Windows acceptance is outstanding.

## Experience principles

1. Keep common edits quick and keyboard-accessible.
2. Show names, source expressions, units, and dependencies alongside computed results.
3. Make write actions explicit and reject ambiguous or stale requests.
4. Keep the palette compact and the design visible.
5. Document limitations and verify behavior in installed Fusion.

## Mythology

**Paramood — Keeper of Measure** belongs to the original **4FusionLab** pantheon. The elder sage protects the hidden relationships between numbers and geometry.

*Every dimension has a reason.*
