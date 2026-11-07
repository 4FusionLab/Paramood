# Paramood 1.5.0 acceptance

[Русская версия](ACCEPTANCE.ru.md)

Checked on 7 November 2026. This records tested behavior, separately from platform support.

## Installed Autodesk Fusion

macOS, Fusion 2706.1.17, Fusion Python 3.14.7. The registered add-in loaded the current repository's Python sources and built frontend; only the add-in was restarted. Run on Startup remained enabled. Native palette screenshots are in [assets/screenshots](../assets/screenshots/).

| Scenario | Result |
| --- | --- |
| Create Classic, Compact and Garden in the installed variant editor | Passed; geometry, captions and saved membership checked through Fusion API |
| Assignment search changes only the draft until Save & apply | Passed |
| Parent parameter with children: numeric `post` and text `caption` | Passed in list and variant editor; values, expansion and membership are independent |
| Bare numeric inline edit of dimensionless `post`: 4 → 6 → 4 | Passed; child dimensions unchanged |
| Inline text edit, dependent concatenation and active-variant capture | Passed; computed text changes and source formulas remain intact |
| Free and external changes | Passed; Free retains current values, Free edits preserve saved variants, external mismatch switches to Free |
| Variant rename, member removal and variant deletion | Passed on a disposable F3D copy; CAD parameters remain |
| Thirty variants, search and internal menu scrolling | Passed on a disposable copy; narrow and wide palette layouts inspected |
| Hybrid/Calculator shared input and dismissible result overlay | Passed |
| mm, cm, m, in and ft display units | Passed; parameter values and physical bounding box unchanged |
| Copy result with units | Passed: actual system clipboard pasted `30.00 mm`; success notification disappeared |
| Mixed numeric/text batch, apostrophe, separators, empty text and conditional text | Passed; source expressions and exact computed values checked |
| One Undo/Redo for the mixed creation batch | Passed |
| Numeric/text type change | Rejected before writing; original parameters preserved |
| Model parameter edit, rename, favorite and independent parameter deletion | Passed on the disposable copy; geometry remained healthy |

The disposable QA and reimport documents were closed. The authorized source demonstration remains open in healthy Classic. Other open user documents were not changed, saved or closed.

## Downloadable model

[Cedar-Sage-Paramood.f3d](../examples/cedar-sage/Cedar-Sage-Paramood.f3d) contains three variants with eight members each. The exact exported file was imported as a new document: all 24 member identities resolved, Classic was recognized automatically, and Compact/Garden/Classic were applied through the installed palette. Each retained 14 bodies and a healthy timeline. Text formulas and values survived the round trip. The exported default is healthy Classic; there are no external document references.

The file's checksum and dimensions are in [model-info.json](../examples/cedar-sage/model-info.json). See the [demonstration walkthrough](DEMO.md).

## Automated checks and review

- Python: 269 tests and 19 subtests passed.
- Frontend: 106 tests passed; standalone IntelliSense: 13 tests passed.
- Ruff format/check, Prettier, ESLint, TypeScript and Vite production build passed.
- Release ZIP and SHA-256 are validated by the release contract and the automated main-branch pipeline.
- Independent read-only correctness/security review found a text-descendant size-limit bypass; it was fixed and the original repro now fails before allocation. The follow-up review found no remaining confirmed blockers.
- Regressions also cover Fusion's transitive API dependency lists, dimensionless edits and the non-settling Qt Clipboard API path.

Earlier isolated Fusion tests cover timeline failures without rollback, unit changes with model-parameter variants, string escapes and stale-request safeguards. They are distinct from the installed-palette scenarios above. Browser mock checks are not used as evidence of native Fusion behavior.

## Limits

Native Windows acceptance, a fresh installed-palette pass in light theme and save/reopen through Fusion cloud storage were not performed in this pass. F3D persistence was tested locally. Platform metadata and cross-platform CI do not substitute for native Windows testing. Variant changes remain partial parameter sets; downstream timeline errors do not automatically undo an applied value.
