# Paramood development rules

[Русская версия](AGENTS.ru.md)

- Write documents in English and maintain separate Russian versions of documentation. Intermediate working notes do not require translation. Communicate and make plans in Russian; UI text is English.
- The specification is `docs/REQUIREMENTS.md`; current status and limitations are in the [README](README.md).
- Fusion API is the source of truth. Check every API call against official Autodesk documentation; do not invent methods.
- Pure logic does not import `adsk`; execute Fusion API only in a permitted main-thread context.
- Recheck the active document, expressions, dimensions and dependencies before changing anything. Do not delete data when uncertain.
- Cover changes with meaningful tests. Report offline, browser and real Fusion results separately.
- Do not modify user documents during validation; use a dedicated temporary model and check state before writing.
- The bridge includes a request ID, structured errors and a check for current document identity.
- Align contracts among frontend, core and adapter; perform security review and tests before integration.
- Keep builds and formatting compatible with the Python version supported by Fusion. Normal GitHub Releases for runtime changes on `main` are already automated and authorized; other publication and external deployment require separate permission.

## Code style and checks

- Use UTF-8, LF and spaces; keep code and tests readable and names meaningful. Comments explain reasons and limitations rather than repeating code.
- Python: Ruff 0.17.3, `py39` target compatibility, line length 100, single quotes; from the root run `python -m ruff format Paramood scripts tests`, `python -m ruff format --check Paramood scripts tests`, `python -m ruff check Paramood scripts tests`. The formatter target does not replace execution checks in supported Fusion.
- TypeScript, JavaScript, CSS, HTML, JSON and YAML: use root Prettier settings and ESLint for executable JS/TS. After `npm ci --prefix frontend`, run `npm run format --prefix frontend`, `npm run format:check --prefix frontend` and `npm run lint --prefix frontend`. Checks cover root sources and IntelliSense test, frontend and configurations.
- Do not automatically format dependencies, lockfiles, generated files or builds; edit documentation and SVG deliberately, preserving structure. Maintain TOML readably by hand in the existing style.
- Before delivery run formatting and lint checks, `python -m pytest -q`, `npm test`, `npm test --prefix frontend`, `npm run build --prefix frontend` and package build. CI performs these checks; local success does not replace validation in Fusion.

## Shared 4FusionLab engineering contract

- Organization rules and shared CI components are described in [4FusionLab/.github](https://github.com/4FusionLab/.github/blob/main/AGENTS.md) and [Release Platform](https://github.com/4FusionLab/.github/blob/main/RELEASE_PLATFORM.md). These product-specific rules apply in addition.
- Before edits inspect existing Git changes, documentation, automated checks and Autodesk Fusion compatibility. Do not delete user data or change existing command IDs, manifest UUID or add-in structure without a migration plan.
- Use Conventional Commits for ordinary development; a small PR with CI is preferred, though direct push to `main` is allowed by repository policy. Do not rewrite history or modify published tags/artifacts.
- **Automatic releases occur only for shipped product changes**: push or merge to `main` → check `.github/release-paths.txt` → tests → GitVersion 6.8.2 → a new immutable tag and GitHub Release. Do not create tags manually; changes to README, documentation, tests, workflows or `AGENTS.md` must not independently publish a release.
- Pin shared GitHub Actions to the **exact SHA** of a reviewed `4FusionLab/.github` commit, not `@main`. Package, manifest, SHA-256, release notes and version must agree; do not overwrite existing releases.
- Passing unit tests and building a ZIP **does not prove** operation in installed Autodesk Fusion. Record actual CAD acceptance and OS separately for Fusion API and UI changes.
- Preserve existing English and Russian documentation, licenses, limitations and project-specific workflows. Do not publish secrets, personal CAD documents, tokens or local-machine artifacts.
