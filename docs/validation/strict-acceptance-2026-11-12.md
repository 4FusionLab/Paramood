# Independent release-candidate acceptance — 12 November 2026

[Русский](strict-acceptance-2026-11-12.ru.md)

**Verdict: NO-GO. Two P1 blockers and one P2 defect are reproduced.** Passing automated checks do not override the observed unintended model write or false-success rollback.

## Candidate and evidence identity

- Base HEAD: `5d98ff2568a5a46c9f4b80d4cadbcbcf2668b549` (published 2.1.0).
- Candidate: the entire initial dirty working tree, including untracked sources, tests and documents. No checkout/worktree, commit, push, tag, release or deployment was created.
- [Identity manifest](strict-acceptance-2026-11-12.identity.json): all 32 initial modified/new files and their SHA-256 values. Candidate identity SHA-256: `60991887782bf7e5b89cb4796ed5105fc6b2b6c8f8c0bdc2a4d6f3d0df47ddb3`. This hashes HEAD plus sorted `path + NUL + file SHA + LF` records.
- No initially pinned file changed during acceptance. This report and its evidence are additional acceptance artifacts, excluded from that identity.
- Fresh local test package: `Paramood-2.1.0.zip`, SHA-256 `c4f9a6d864995c2cc9944a63b9c384a4e8d0c5341e2a00c7aabb6ce00a033676`. Two fresh builds produced the same checksum. The older package was not reused.
- **2.1.0 was explicitly injected only to test packaging.** This is not a new published release candidate/version. The source manifest remains 1.3.1; CI injects its calculated version. The existing 2.1.0 notes passed the mechanical archive contract, but are not reviewed notes for these unreleased changes.
- [Compact native/browser evidence](strict-acceptance-2026-11-12.evidence.json) contains 23 native snapshots, bridge responses, actual palette requests and document fingerprints. CAD entity tokens and personal document names are omitted.

## Release blockers and defects

### RC-01 — P1: search input can silently become a model edit

**Reproduction: complete installed-palette UI E2E, Fusion 2706.1.17 on macOS; also browser fixture, 3/3 runs.**

1. In the disposable model, `baseline=50 mm`. Open its inline value editor and leave it open.
2. Open search with the magnifying glass.
3. Type `523` as separate ordinary keystrokes.
4. After the first character, search contains `5`, which matches the baseline expression. Focus moves back to the inline editor and selects its existing value.
5. The remaining `23` replaces the expression. Press Enter.

Expected: search contains `523`; the parameter and editor draft remain unchanged. Actual: the real palette sends `parameters.apply`, text `baseline=23 mm`, request `pm-mwcml7m8-ibrz8cwpey-52`; native readback confirms **23 mm**. No fabricated bridge response or direct adapter mutation was used for this reproduction.

Minimal browser reproduction: open the inline editor for `box=8 mm`, wait 400 ms, open search, type `box` with 150 ms between keys. Three independent reloads yielded `{query: 'b', expression: 'ox', focus: 'Expression for box'}`. Waiting before opening search excludes a merely unfinished initial editor-focus effect.

Owning code: `frontend/src/parameter-list.tsx:441–446` switches between an `AnimatedList` wrapper and bare branches on the first nonblank query; the inline editor is remounted. `frontend/src/editor.tsx:408–410` selects its value and focuses on mount. This causal explanation is inferred from the code and the reproduced focus transition. Existing green tests did not catch ordinary interleaved keyboard input.

### RC-02 — P1: rename and Favorites report success, then roll back with Circle

**Reproduction: real installed HtmlHandler and native Fusion data, macOS. Requests were submitted through the Python console to the real handler, not typed in the palette.**

1. In the task-owned sketch, start `CircleCenterRadius`.
2. Submit a current-identity `parameters.rename` for `tray_depth → tray_height`.
3. Observe `ok: true`, `renamed: tray_height`, and the renamed native parameter while Circle remains active.
4. Call the documented `terminateActiveCommand()` without Undo, deletion or a document switch.
5. `tray_height` disappears and `tray_depth` returns. Document and Design are unchanged.

Independently repeat with `parameters.favorite`, `box: false → true`: the handler returns `ok: true`, native state is true during Circle, then false after command termination.

Expected: a successful operation survives completion/cancellation of the native command, or the operation is rejected before writing. Actual: success acknowledges a temporary change inside the native command's transaction.

Evidence labels: `rename-during-circle`, `rename-after-circle-termination`, `favorite-during-circle`, `favorite-after-circle`. The first request IDs are `strict-circle-rename` and `strict-circle-favorite`.

Owning code: `Paramood/Paramood.py:190–193` only forces `parameters.apply` onto the independent transaction route; `:240–255` still directly dispatches rename/Favorites during active commands when selection capture succeeds. This issue predates or shares the earlier Apply rollback mechanism; its release impact remains real. Delete, variants and document-unit changes on this route are **not proven safe or proven broken** by these two reproductions.

### RC-03 — P2: filtering changes a group operation into a single-parameter operation

**Reproduction: real installed palette UI E2E and browser request capture.**

Create `box` with comment `needle` and descendant `box_width` without that comment. Without filtering, the name action is `Rename group box`. Search `needle`: the descendant is hidden and the same row becomes `Rename box`. Rename it; the frontend sends `parameters.rename`, not `parameters.renameGroup`, and leaves `box_width` in the old group.

The native reproduction used the equivalent later names `case` and `case_width`. The actual request renamed only `case → casefiltered`; readback showed `case_width = casefiltered * 2`. The reference followed the object, but the subtree did not move. Expected: filtering preserves the full group's identity and operation scope. The same filtered metadata also selects the single-parameter drag path; that consequence was established by code review, not a separate native filtered drag reproduction.

Owning code: `frontend/src/parameter-list.tsx:94`, `:132` derives group identity from filtered `node.children`; `parameter-search.ts` removes unmatched descendants. `parameter-drag.ts:174–179` consumes that projected identity.

## Risk and acceptance matrix

PASS applies only to the evidence layer named. NOT TESTED is not PASS.

| Risk / requirement | Offline | Browser fixture | Native macOS | Result / boundary |
| --- | --- | --- | --- | --- |
| Complete dirty-tree identity, untracked sources, drift | PASS | — | — | 32 files pinned; no drift |
| Ruff format/lint, Prettier, ESLint | PASS | — | — | Check-only; RC not reformatted |
| Python/core/frontend regression suites | PASS | — | — | 560 + 22 subtests / 50 / 270 |
| TypeScript, production Vite build, ZIP | PASS | — | — | Fresh deterministic ZIP; all shipped Python matches source |
| Search collapsed; open, X, Escape, second magnifier | PASS | PASS | PASS, UI | Native verified floating and restored right docking; visible focus outline after Escape |
| Cyrillic comment, full native/dotted path, expression search | PASS | PASS | PASS for Cyrillic comment, UI | All query categories covered by pure tests/browser; native categories are not all repeated |
| No-match state and ancestor context | PASS | PASS | PASS, UI | Native `no-match-strict` and `Толщина` |
| Search with an open inline editor | Tests green | **FAIL** | **FAIL, UI** | RC-01; actual unintended write |
| Preserve group rename/drag identity in filtered results | Tests green | **FAIL** | **FAIL rename, UI** | RC-03; filtered drag consequence reviewed |
| Restore expansion and end-of-list scroll, Favorites open | PASS | PASS | NOT TESTED at large-list scale | Browser 90-item group; end scroll restored to 1989 px after closing search |
| Narrow/minimum/wide layout | PASS | PASS at 300/360/960 px | PASS at 360 px palette | Native wide/minimum not repeated |
| Light/dark/reduced motion | PASS | PASS | Dark only | Browser light screenshot/reduced-motion media and dark checked; no native light/reduced-motion claim |
| Focus/ARIA and ordinary keyboard typing | PASS | **FAIL** | **FAIL** | Opening/closing semantics pass; RC-01 blocks overall focus acceptance |
| Delete hover/focus without layout shift | PASS | PASS for hover | NOT TESTED dynamically | Value rectangle identical; opacity 0 → 1; keyboard/touch runtime not independently repeated |
| Touch delete availability | CSS rule present | NOT TESTED | NOT TESTED | Real touch device/context unavailable in this acceptance |
| Favorites terminology | PASS, reviewed | PASS | PASS, visual | Native `isFavorite` retained |
| Units are plain spans; no type controls/disclaimers | PASS | PASS | PASS, visual | Document length-unit dropdown retained; no per-parameter unit mutation |
| Group rename, own value, Cyrillic, dependencies/identity/metadata | PASS | — | PASS, real handler | `box → коробка → case`; original tokens, comment, favorite and formulas preserved |
| Saved variants and text through group rename | PASS | — | PASS, real handler | Saved numeric/text row and columns; formula rewritten, text unchanged |
| Stale group membership/expressions; overlapping requests | PASS | — | PASS, real handler | No writes; stale rejected and simultaneous request returns BUSY |
| Late group failure is atomic | PASS | — | PASS, diagnostic | Injected metadata-store failure after renames; whole native transaction rolled back; runtime hook restored |
| Single group Undo/Redo outside sketch | PASS | — | PASS, native commands | Names, formula and variant columns revert/reapply together |
| Independent group Undo while sketch remains open | — | — | NOT DEMONSTRATED | Early probes did not show model reversal; only outside-sketch acceptance is claimed |
| Group drag, root drop, single parameter name drag | PASS | Browser drag attempt inconclusive | PASS, UI | Native group move, root return, `tray_depth → case_depth`; tokens resolve |
| Self-subtree drop | PASS | — | PASS, UI | `Choose a different group`; no move |
| Occupied groups, all conflict/empty-member combinations | PASS in tests | NOT TESTED exhaustively | NOT TESTED exhaustively | Do not promote mocks to native coverage |
| Trailing semicolon and chained batches | PASS | — | PASS, UI/handler | Actual UI `ui_new=11mm;ui_half=ui_new/2;baseline=50mm;` |
| Apply during Circle: new-only/update-only/mixed, text | PASS | — | PASS, real handler | Circle ends; sketch stays; numeric/text values and chains retained |
| Actual palette Apply during Circle | — | — | PASS, UI E2E | Actual outgoing request captured; native 11/5.5/50 mm readback |
| After next Circle, real canvas Escape, Finish Sketch | — | — | PASS for UI-created chain | `ui_new/ui_half` survive; completed API-created circle retained |
| Nonzero unconfirmed Circle preview, all other native commands | — | — | NOT TESTED | No claim of preserving a native preview; chosen behavior discards it |
| Rename/Favorites durability during Circle | — | — | **FAIL, real handler** | RC-02 |
| Delete/variants/unit-change durability during active commands | Existing tests | — | NOT TESTED | Separate high-risk paths; not covered by Apply fix |
| Batch creation single Undo/Redo outside sketch | PASS | — | PASS, UI | Both `undo_probe` and `undo_half` disappear/reappear together with native keyboard Undo/Redo |
| Selection preservation | PASS | — | PASS, API/handler | Selected sketch circle, count and exact entity retained after Apply |
| Document switch / stale document request | PASS | — | PASS, handler | Old request rejected STALE_DOCUMENT; neither owned document receives probe |
| F3D save/reopen, cold restart, full installed ZIP reinstall | Existing tests/evidence not reused | — | NOT TESTED in this run | Native run used current source and current production frontend build |
| Native Windows / local Node 22 parity / three-OS CI for dirty RC | — | — | NOT TESTED | Local Python 3.14.5, Node 26.9.0, macOS; CI config reviewed, not executed remotely |
| User-document protection and cleanup | — | — | PASS | Three original parameter fingerprints, counts, timelines and modified flags unchanged; only owned temporary documents closed |

## Automated checks and package/security review

Executed independently: `npm ci --prefix frontend`; Ruff 0.17.3 format check and lint; Python compileall; pytest; root tests; frontend Prettier check, ESLint and Vitest; TypeScript/Vite build; package build; release contract validation. Mutation-mode formatters were deliberately replaced by their check modes to preserve the tested tree.

Results: **560 Python tests + 22 subtests; 50 root JS tests; 270 frontend tests across 15 files.** All passed. Local tool versions: Python 3.14.5, Node 26.9.0. CI uses Node 22 and a three-OS matrix; this dirty tree has not been pushed to run that matrix.

ZIP inspection: 27 entries, new `fusion/parameter_groups.py` included; manifest version 2.1.0, supported OS `windows|mac`, `runOnStartup: true`; every packaged Python file equals the current source. Frontend asset references exist. No pycache, bytecode, DS_Store, node_modules, Git data or environment files; no matches for checked machine-path/private-key/GitHub-token patterns. This is a scoped pattern check, not proof that arbitrary secrets cannot exist.

Production dependency audit: zero reported vulnerabilities. Full install audit: seven moderate development-dependency findings; no automatic dependency changes made. Manual contract/security review found no new executable input channel in search and checked escaping, identity checks, stale validation, group transactions and package scope. RC-01 is a correctness/data-integrity failure despite ordinary bridge validation; request authentication/identity alone cannot distinguish unintended focused-field input.

## Documentation and independent review axes

The current USER_GUIDE accurately states that Apply ends an active native command and an unfinished preview is discarded; it also limits command coverage. The Circle-specific paragraph is supplemented by the general boundary. Research documents do not promise an implemented unit/type editor. The blanket promise that editing/rename/drag remain available during search needs RC-01/RC-03 fixed before it describes reliable behavior. Earlier validation reports are historical pointers, not this acceptance's evidence.

**Standards axis:** the independent reviewer reported one documented requirement breach: projected group identity changes rename/drag scope (RC-03). No standalone Fowler smell or additional confirmed standard/security breach was reported. Native transaction acceptance was explicitly outside that reviewer's scope.

**Spec axis:** the independent reviewer also identified RC-03 and a candidate backend hardening gap: manual prefix renaming allows merging an existing group or adding the source prefix beneath itself when exact parameter names do not collide. That candidate was reproduced against a mock. It is **not counted as a confirmed defect here**: the guide's occupied-group/self-subtree prohibition is explicitly stated for dropping, and manual full-prefix renaming has a broader contract. Clarify the intended manual-rename policy before treating this as a release requirement. Native self-subtree drag was independently rejected correctly.

## Cleanup, remaining risk and release decision

Two newly owned disposable documents were used; both were closed without saving. None of the three pre-existing documents was changed, saved or closed. Their final fingerprints exactly match the initial ones; modified flags remain true, parameter counts 16/24/6, timeline counts 5/9/1. The original active document was restored. All temporary runtime observers/failure injection were restored/removed, original right docking and palette URL restored, and Run on Startup preserved.

**Release is blocked by RC-01 and RC-02; RC-03 also fails the agreed search/group scope.** Fix these in a new identifiable candidate, add regression coverage at real keyboard/remount and native transaction seams, rerun affected browser/native durability scenarios, and then repeat the required automated/package checks. Native Windows and the NOT TESTED scenarios remain explicit acceptance gaps; no GO is implied for those platforms or paths.

API verification used Context7 resolution/query; the Autodesk transaction query returned no matching documentation. Official references were then checked directly: [command transactions/previews](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/Commands_UM.htm), [terminateActiveCommand](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/core_UserInterface_terminateActiveCommand.htm), [CommandDefinition.execute](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/core_CommandDefinition_execute.htm), [Documents.add](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/core_Documents_add.htm), [Document.close](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/core_Document_close.htm), [palette docking](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/core_Palette_dockingState.htm). Organization [engineering rules](https://github.com/4FusionLab/.github/blob/main/AGENTS.md) and [release contract](https://github.com/4FusionLab/.github/blob/main/RELEASE_PLATFORM.md) were also inspected.
