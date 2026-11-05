<p align="center"><img src="assets/paramood-banner.svg" alt="Paramood — Keeper of Measure" width="100%"></p>

<h1 align="center">Paramood for Autodesk Fusion</h1>
<p align="center"><strong>Keeper of Measure. Every dimension has a reason.</strong><br>Work with parameters and expressions in a compact Fusion palette.</p>

<p align="center"><a href="README.ru.md">Русский</a> · <a href="https://github.com/4FusionLab/Paramood/releases">Releases</a> · <a href="https://github.com/4FusionLab/Paramood/issues">Issues</a></p>

## What it does

- Create and update user parameters, with a preview before applying.
- Calculate expressions and use existing parameters.
- Navigate parameter names with IntelliSense: `box.inner.size` refers to `box_inner_size`.
- Update an existing formula using `this`, `+=`, `-=`, `*=`, or `/=`. The previous formula is preserved in the resulting expression.

Example:

```text
box.inner.size=25; width=box.inner.size*2
```

## Install

1. Download the ZIP from [Releases](https://github.com/4FusionLab/Paramood/releases) and extract it.
2. In Fusion, open **Utilities → Scripts and Add-Ins**, select **Add-Ins**, and use **+** to add the extracted `Paramood` folder.
3. Select **Paramood**, enable **Run on Startup** if desired, and click **Run**.

The package targets **Windows and macOS**. CI tests run on both; interactive Fusion testing has been performed on macOS, while native Windows testing remains outstanding. Node.js is not required to run the packaged add-in.

## Scope and limitations

Paramood works with the current Fusion design. It accepts a conservative subset of expressions and units and rejects unsupported cases. Changes are previewed and revalidated before application; external components are not edited. A model feature can report an error after a parameter change, as with Fusion's native parameter editor. Parameter cleanup is not available in 1.2.0.

## Development

Use Node.js 22.12+ and Python; CI uses Python 3.14. Build and verify from the repository root:

```sh
cd frontend
npm ci
npm run lint
npm run format:check
npm test
npm run build
cd ..
python -m pip install pytest ruff
python -m ruff check Paramood scripts tests
python -m pytest -q
python scripts/build_release.py
```

The resulting `dist/Paramood-1.2.0.zip` includes the built interface and a SHA-256 checksum alongside it. CI publishes a release after each push to `main` once all checks pass. GitVersion derives the version from tags and Conventional Commit messages; the CI-generated version is embedded in the packaged manifest.

## The 4FusionLab family

**[Perfora](https://github.com/4FusionLab/Perfora)** · **[Selectra](https://github.com/4FusionLab/Selectra)** · **[Ejix](https://github.com/4FusionLab/Ejix)** · **[RuEn](https://github.com/4FusionLab/RuEn)** · **[Planara](https://github.com/4FusionLab/Planara)**

Paramood is an independent [4FusionLab](https://github.com/4FusionLab) project, not affiliated with Autodesk.
