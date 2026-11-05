# Paramood — product concept

> **Status: design concept.** This document captures intended behavior, not features already implemented or tested in Autodesk Fusion.

## Purpose

Paramood helps Fusion users manage the **meaning** behind dimensions: names, expressions, results, and dependencies. It complements Fusion's native parameters instead of replacing the model or changing its underlying parametric behavior.

## Primary workflows (planned)

### 1. Quick Parameters

A compact editor accepts multiple named definitions, for example:

~~~text
w=15; h=10; l=h/2
~~~

The editor should provide completion, syntax highlighting, in-place errors, and a preview of interpreted assignments **before** any changes are applied. Expressions referring to other parameters must remain expressions rather than being flattened to numeric values.

### 2. Reactive calculator

When typing formulas, the UI should identify existing parameter names, validate expressions, and show calculated results where Fusion API evaluation supports them. Unresolved names, duplicate names, invalid expressions, incompatible units, and cycles must be clear to the user.

### 3. Parameter manager

A dedicated HTML interface should support finding, filtering, and visually sorting parameters. The visual sort is **local to Paramood**: the Fusion API does not offer general-purpose reordering of the native parameters table. Never imply that it does.

### 4. Reviewable cleanup

Unused-parameter detection must consider dependency relationships and model references. Any removal should be **opt-in**, with explicit selection, a dependency review, and failure-safe handling. No automatic bulk deletion.

### 5. Quick Tools

The intended workflow includes a compact, optionally persistent HTML Palette. It must remain **separate from Fusion's built-in Comments panel**; no claims of replacing or embedding in that system.

## Technical direction (proposed, not committed)

- **Fusion integration:** Python add-in using the Fusion API.
- **UI:** HTML Palette, with TypeScript, Preact, and CodeMirror as the current design direction.
- **Communication:** validated JSON messages across the HTML-to-Python bridge.
- **Parameter updates:** update a parameter's `expression` where appropriate, rather than overwriting its evaluated `value`.
- **Safety:** preview, validate, and report errors before write operations; preserve parametric dependencies.
- **Compatibility:** verify concrete API behavior in Fusion before promising a platform or release. Avoid depending on unstable Preview-only APIs for core functionality.

## Experience principles

1. **Fast:** most common changes should need few interactions.
2. **Legible:** show parameter names and dependencies, not unexplained numeric results.
3. **Safe:** explain the effect of a change before applying it.
4. **Compact:** a focused panel, good keyboard support, dark and light themes.
5. **Honest:** the UI must not suggest capabilities that Fusion itself cannot provide.

## Delivery status

The repository currently records the direction and identity of the project. There is no published build, validated installer, or release. Implementation details, licensing, and supported platforms are to be documented once established.

## Mythology

**Paramood — Keeper of Measure** belongs to the original **4FusionLab** pantheon. The elder sage protects the hidden relationships between numbers and geometry.

*Every dimension has a reason.*
