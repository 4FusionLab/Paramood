# Strict repeat acceptance — 12 November 2026

[Русская версия](strict-reacceptance-2026-11-12.ru.md)

**Verdict: GO for the tested macOS scope.** The three defects in the [initial NO-GO report](strict-acceptance-2026-11-12.md) are closed. A scroll-restoration regression found during repeat acceptance was also fixed and retested. Native Windows acceptance remains **NOT TESTED**; this is not an unrestricted cross-platform release approval.

## Candidate and ownership

The candidate is the entire dirty working tree, including untracked product sources, on HEAD `5d98ff2568a5a46c9f4b80d4cadbcbcf2668b549`. The [identity](strict-reacceptance-2026-11-12.identity.json) pins 46 changed/untracked files; only these new repeat-acceptance artifacts are excluded to avoid self-reference. The initial report and evidence remain historical and unchanged. Candidate identity SHA-256: `bfcfc569a8dfaa22f31d8c32ad21f1eb198047e2952ffd1212fc8ec91063a477`.

Fixes were implemented in three separate Codex chats and independently accepted here:

| Defect | Fix chat | Result |
| --- | --- | --- |
| RC-01: search focus redirected digits into an inline editor | `01a1cc96-b03e-70e2-9385-d695c528fe88` | CLOSED |
| RC-02: successful writes rolled back with the native Circle preview | `01a1cc96-fee4-7ff1-9ffe-e85b20a3e4ad` | CLOSED |
| RC-03: filtered group own value became a single leaf | `01a1cc97-4ac0-7580-ad0e-904e6649bc37` | CLOSED |

RC-01 preserves list ancestry and guards editor autofocus. RC-03 retains structural group identity from the full tree while collecting the complete subtree for rename/drag; Favorites still operate on one parameter. RC-02 preflights mutating requests without writes, ends an active native command, and revalidates identity and snapshots before writing in the Paramood command. The existing idle-sketch direct Apply path remains guarded.

The additional scroll defect came from restoring scroll while returned rows still had animated zero height. Search and its first restoration render now settle layout immediately, without remounting matching editors; ordinary animations resume outside search.

## Independent automated and browser checks

| Check | Result |
| --- | --- |
| Ruff 0.17.3 format/check; Python compile | PASS |
| Python suite | 656 passed + 22 subtests |
| Root IntelliSense suite | 50 passed |
| Frontend suite | 289 passed, 17 files |
| Prettier, ESLint, frontend production build | PASS |
| Package contract and deterministic rebuild | PASS |
| Production dependency audit | No vulnerabilities; seven existing moderate development-tool findings remain |

Local runners were Python 3.14.5 and Node 26.9.0. These results do not substitute for Fusion's embedded Python or CI's Node 22/three-OS matrix.

The independent browser replay used the final production bundle `index-SYGhOCcp.js`, not a source-only harness. Three reloads reproduced the original sequence with an open baseline editor: typing `523` retained search focus and query, Enter sent zero Apply requests, and closing search restored the `50` draft and search-button focus. Actual mouse drag and filtered rename each included both `box` and hidden `box_width`. Units remained plain spans. Widths 300/360/960, light/dark and reduced-motion modes were checked.

The final scroll replay measured bottom position `2058/2058` before search and `2014/2014` after Escape; the smaller extent reflects removal of the search row. A stale cached pre-fix bundle was explicitly excluded after inspecting loaded scripts. The fix chat additionally reported 16 scroll scenarios, four editor-identity cases and six original focus cases; those are supporting evidence, separate from the independent replay.

## Native Autodesk Fusion acceptance

Environment: macOS, Fusion `2706.1.17`. Tests used three owned temporary documents. Backend checks ran against the corrected source; after the final frontend-only animation fix, focus and scroll were repeated with the final bundle in a 93-parameter model.

**Real palette/UI interactions:**

- With an inline `baseline=50 mm` editor open, `5`, `2`, `3`, Enter produced search query `523`, no matching parameters, and no unintended write. Final-bundle readback remained `50 mm`, with 93 parameters unchanged.
- Filtering by a comment matching only a group's own value, then renaming and dragging, included hidden descendants. Names, dependent formulas and variant columns followed the full group. Entity identity remained valid.
- Renaming `tray_depth` to `tray_height` and changing a Favorite during Circle remained durable after starting another Circle and cancelling it with actual canvas Escape.
- A mixed numeric/text batch through the actual Apply button during Circle created `ui_new=25 mm`, `ui_half=12.5 mm`, changed `baseline=40 mm` and text `caption='Verified'`. A subsequent Circle, canvas Escape and Finish Sketch preserved the results and completed circle geometry.
- In the final 93-parameter model, closing a bottom-of-list search visually restored the bottom rows. This native observation is visual; numeric scroll measurements above belong to the browser test.

**Real backend/handler tests, invoked from the native Python console rather than presented as full UI coverage:**

- Invalid entity identity, foreign document identity and malformed payload were rejected while Circle remained active.
- Delete, variant Apply/table Save/Free/Delete and document-unit change were durable after ending Circle. A stale unit snapshot was rejected without ending it; valid mm→cm retained internal values and circle radius.
- A preview-only expression changed from `100 mm` back to `50 mm` on command termination. Revalidation rejected the dependent Favorite request with `CONFLICT` before its write.
- Injecting a variant-metadata store failure during group rename rolled back the native transaction without partial names/metadata. The hook was restored.
- Group rename to `корпус`, real Undo and Edit-menu Redo changed names, formulas and variant columns together. Completed circle selection survived ordinary Apply.
- A stale request after switching between owned documents returned `STALE_DOCUMENT`; neither document received the proposed parameter.

Temporary observers forwarded the original handlers and were restored; no success responses were fabricated. During setup, event registration from an MCP script did not survive its execution context, so the add-in was restarted through Fusion's real Python console. That setup failure is not counted as a product defect or a passing test.

## Safety, evidence and package

The [sanitized evidence](strict-reacceptance-2026-11-12.evidence.json) records 23 native snapshots, responses, real UI requests separately from console calls, final browser checks and cleanup. Document IDs and entity/snapshot tokens are omitted. The three pre-existing documents retained their checked parameter/timeline fingerprints and modified flags after the main native suite. The last frontend check touched only the third owned model. All three owned models were closed without saving; the original active document and palette docking were restored, with three original documents still open and `SelectCommand` active. No pre-existing model was saved or closed. Run on Startup remains enabled.

The final local test ZIP contains 27 entries; all shipped Python files match source and frontend assets match the final build. Rebuilding produced identical bytes. SHA-256: `40e07b589f8182355d9f8174c878b397f31eca121875f330f1942e8bad6abb4c`.

`2.1.0` was an explicit local package version override, not a newly published version. The unchanged source manifest remains `1.3.1`; the package builder injects the test version. Existing 2.1.0 notes were used only for the mechanical release-contract check. No commit, push, tag, release or deployment was performed.

## Remaining acceptance gaps

Native Windows; exhaustive native-command coverage and nonzero in-progress Circle geometry preview; F3D save/reopen and cold restart; touch input; remote three-OS CI/Node 22 on this dirty candidate are **NOT TESTED**. The verdict covers the reproduced defects and documented macOS scenarios, with these limits retained.
