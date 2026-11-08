# Expression IntelliSense acceptance

Date: 2026-11-08. Native platform: macOS, Autodesk Fusion 2706.1.17.

## Native numerical and adapter checks

An isolated copy of the new modules ran on Fusion's main thread in a dedicated temporary design. Existing user documents were preserved and the original document was restored afterward.

- Catalog-driven batch Preview produced no model writes; Apply created 29 parameters: examples for all 25 deterministic functions and all four constants.
- All 25 function results matched the local planner within `1e-9` relative/absolute tolerance, after converting Fusion's internal cm to the planner's mm where required.
- Existing-parameter update, relative addition, `this`, virtual paths, and a dependent conditional parameter passed.
- Quick Calculator evaluated all 25 deterministic function examples, two preference-sensitive bare trigonometric calls through the native fallback, one native `random()` sample, and both physical constants as derived calculator quantities.
- Stable random-dependent Preview was rejected with `NONDETERMINISTIC_EXPRESSION`.
- A local F3D export was reopened through Fusion's archive importer: all 31 parameters retained units and values; the saved variant retained its identity. This is a native archive round trip, not a cloud Save test.

The native script used actual `FusionUnitsManager`, `UserParameters`, `Design.modifyParameters`, export/import, and the new Fusion adapter. These checks were not mock tests. Windows Fusion and cloud document save/reopen were not exercised.

## Native palette checks

The production frontend from an installed test ZIP was loaded in an isolated 361-pixel-wide Fusion Palette with the new adapter and a temporary document. The installed user add-in was not stopped or restarted.

- Selecting `pow` inserted parentheses and placed the cursor inside.
- Typing `probe=pow(2; max(` displayed the nested `max(first; second)` signature. After `3; `, `second` was emphasized. Closing `max` restored `pow(base; exponent)` with `exponent` emphasized; closing `pow` hid Signature Help.
- Dark-theme text contrast and narrow-width wrapping were visually checked after correcting a native-only tooltip styling conflict.
- Incomplete calls produced no automatic native Preview requests after the draft guard was added.
- The completed expression previewed as `16`, and clicking Apply created the actual Fusion parameter with value `16`.
- Inline editing to `PI * 2` displayed the constant color and committed the value `6.283185307179586`; this value was read back through the Fusion API.
- The test palette and test document were closed, and the original document was restored.

Full add-in stop/restart, Windows UI, light-theme native rendering, and cloud Save were not tested. The previously reported restart crash is outside this change.

## Automated validation

Local macOS checks passed: 379 Python tests plus 22 subtests, 160 frontend tests, and 47 standalone IntelliSense tests. Ruff 0.17.3 formatting/lint, Prettier, ESLint, TypeScript, Vite production build, Python compilation, deterministic ZIP tests, embedded catalog checks, and the stable release archive contract passed. CI is evaluated separately on the PR and on the merge commit.
