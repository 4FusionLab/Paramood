# Native expression acceptance

Date: 2026-11-08. Autodesk Fusion 2706.1.17, macOS.

## Reproducible native suite

Run `scripts/fusion_expression_parity.py` inside Fusion. It loads the checkout as an isolated package, creates a dedicated temporary model, restores the original document, and never stops the installed add-in. F3D and JSON reports stay in the OS temporary directory outside the repository.

The actual native suite passed:

- All 96 official unit abbreviations: Preview without model writes, Create, finite native readback, unit matching, and canonical aliases.
- All 26 function examples, including `random()` through Preview and Apply.
- 25 additional scenarios: area, volume, physical units, negative Celsius, physical constants as parameters, cube roots of volume, lazy conditions, unitless branch promotion, dimensioned rounding/sign, long unit aliases, native quote/symbol suffixes, random-dependent batches, existing random updates, relative physical-unit edits, and `this` on an area parameter; text creation, references, and concatenation.
- Native random recompute did not invalidate a preview. A deterministic external expression edit did invalidate it.
- A random-containing saved variant retained its active identity after recompute. F3D export/reopen preserved all parameter expressions and units and restored the active variant.

These checks used real Fusion APIs and actual model parameters, not mocks. The complete suite created and reopened 144 parameters. No original user document was modified.

## Automated checks

Catalog-driven unit and native-callback contract tests cover all 96 units, affine offsets, compound dimensions, fractional powers producing valid dimensions, raw expression preservation, random dependency propagation, snapshot identity, variant matching, quote suffixes, and sampled preview rendering. Native-callback fixtures are reported as offline tests, not native evidence.

Native Windows Fusion, cloud Save, and full add-in stop/restart are separate unverified scopes. Existing Windows/macOS/Linux CI checks do not establish native Windows CAD acceptance.

## Native Palette rendering

The production frontend from an installed test ZIP was loaded in an isolated 363-pixel Fusion Palette. Supported prefill/state notifications drove the visual check: `randomBatch=random();randomSize=randomBatch*10 mm` showed sample markers and explanatory text for both rows, and remained applicable. The actual native adapter applied the original formulas; a state refresh showed their native values. Long before/after values wrap inside the narrow palette. These checks cover native rendering and adapter integration; pointer/keyboard interaction was not reaccepted in this run. The test document and palette were closed and the original document restored.

## Local quality gates

496 Python tests plus 22 subtests, 162 frontend tests, and 48 IntelliSense tests passed. Ruff 0.17.3 formatting/lint, Python compilation, Prettier, ESLint, TypeScript, production build, package/catalog integrity, SHA-256 and the stable release contract passed. PR and main CI are checked independently.
