# Search and preview stability — November 12, 2026

Working validation notes for the current dirty checkout; no publication.

Reproduced both defects with failing tests: search had no animated reveal; editing an assignment immediately removed its existing preview DOM. Search now uses the shared Collapsible component, retaining an inert closing region and restoring focus to its trigger. Its sticky positioning belongs to the animated wrapper. Filtering/scroll restoration still skips tree-row animation as before.

Assignment previews retain their previous data during incomplete input, debounce and pending requests. The panel also stays mounted when calculation input becomes an incomplete assignment. New responses update keyed rows in place. A separate readiness flag prevents a retained preview from authorizing Apply, including when the draft changes back to its previous text before revalidation. Same-document model refresh retains the display while invalidating readiness; document changes clear it. Errors replace results without unmounting the panel.

Verification:

- 299 frontend tests passed, including search entry/exit and inert/focus behavior, stable preview panel/row identity, pending old-text Apply rejection and calculation-to-assignment continuity. Existing uncommitted tests were preserved. An accidental test-file overwrite during test authoring was restored from an exact pre-existing 1106-line snapshot; its diff against HEAD matched the original 57 added lines before the new tests were appended.
- 665 Python tests plus 22 subtests, 50 root JavaScript tests, Ruff format/check, Prettier, ESLint, TypeScript/Vite and package build passed.
- Real Chrome at 440 × 680 with the production bundle and a delayed fixture bridge: search called Web Animations with 0→43px and 43→0px over 180ms. Typing width=20mm, then an incomplete plus, then 2mm preserved the exact panel: one insertion, zero removals. No parameters.apply request. The final bundle also preserved the panel when calculation input changed to width=.
- Native macOS Fusion on the existing dedicated temporary document: search opened/focused and closed; preview remained visible for d=20mm+, Apply was disabled, and completing 2mm updated it to 22 mm. Apply was never clicked and the test draft was cleared. The final bundle was loaded into the native palette afterward. This was a frontend-only refresh, with no adapter or dispatcher patch. No CAD write was requested.

Screenshots are outside the repository. The separate unused-parameter cleanup feature is intentionally handed to its own requested thread.
