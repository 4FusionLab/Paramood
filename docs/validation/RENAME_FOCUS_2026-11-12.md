# Rename focus validation — November 12, 2026

Working notes for the dirty shared checkout; no publication or CAD writes.

Reproduced multiple name inputs with a failing focus-transition regression test. Blur closure alone did not guarantee exclusivity in the real browser because dynamically mounted autofocus inputs did not always receive focus. ParameterList now owns one active rename session through context. Every Branch has a unique session identity (including repeated favorite rows), explicitly focuses its input in a layout effect, and closes only its own session on blur, Escape or successful Enter. A late completion from an old session cannot close a different active field. Leaving a field cancels the unsubmitted name and never invokes a rename request.

Verified in real Chrome using the current production bundle and an isolated fixture: width → height → group box leaves one rename input and correct focus; an unfinished draft is discarded; selecting the width value leaves zero rename inputs and the value editor open. The singleton rule also has a test where button clicks do not move focus first. The one-line blur-only implementation was replaced before acceptance.

Checks passed on the current shared checkout: 306 frontend tests, 686 Python tests plus 22 subtests, 50 IntelliSense tests, Prettier, ESLint, Ruff, TypeScript/Vite and package build. Source changes are confined to rename-session handling in parameter-list.tsx and its focused regression tests. The simultaneously developed cleanup feature and previous search/preview fixes were preserved. Native Fusion was not used for this follow-up, to avoid interfering with the separate cleanup task's session. A browser screenshot is saved outside the repository.
