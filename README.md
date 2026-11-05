<p align="center"><img src="assets/paramood-banner.svg" alt="Paramood — Keeper of Measure" width="100%"></p>

<h1 align="center">Paramood for Autodesk Fusion</h1>
<p align="center"><strong>Keeper of Measure. Every dimension has a reason.</strong><br>A planned Fusion add-in for working with parameters, expressions, and the relationships that shape your design.</p>

<p align="center">
  <a href="#the-idea">The idea</a> · <a href="#planned-capabilities">Planned capabilities</a> · <a href="README.ru.md">Русский</a> · <a href="https://github.com/4FusionLab/Paramood/issues">Ideas and feedback</a>
</p>

<p align="center"><img src="https://img.shields.io/badge/status-planned-ff9251" alt="Status: planned"></p>

---

## The idea

**Change the rule, not every dimension.**

Parametric models become much easier to maintain when their dimensions have names, expressions, and clear dependencies. Paramood is designed to make that work quick and understandable inside Autodesk Fusion.

A possible quick-entry interaction:

~~~text
width = 15
height = 10
length = height / 2
~~~

A single place to define relationships, inspect the results, and refine the model. **This is a product concept, not a currently available command.**

## Planned capabilities

| Area | Intended experience |
| --- | --- |
| **Quick Parameters** | Enter several named expressions in a compact editor. |
| **Live expression feedback** | See calculated results, suggestions, and validation before applying changes. |
| **Parameter manager** | Search, filter, and organize parameters in a dedicated interface. |
| **Dependency-aware cleanup** | Review unused parameters and their relationships before any removal. |
| **Quick Tools palette** | Keep parameter work close to the modeling workflow without taking over Fusion's Comments panel. |

The details and implementation are **subject to change**. Follow this repository for progress; there is **no release or installer yet**.

## Design principles

- **Expressions first.** Preserve relationships instead of replacing them with fixed values.
- **Clarity before action.** Surface errors and affected dependencies before changing the model.
- **No surprise deletion.** Cleanup must be explicit, reviewable, and safe.
- **Native model, focused UI.** Respect Fusion's API limits; sorting in Paramood does not imply reordering Fusion's native parameter table.
- **Less repetition. More design.** Small tools should reduce friction, not create another workflow to manage.

[Product concept and technical notes](docs/PRODUCT_CONCEPT.md)

## A little workshop mythology

In the original **4FusionLab mythology**, **Paramood** is the **Keeper of Measure**: an ancient sage who knows the laws connecting form, proportion, and number. He does not shape every piece by hand. He understands the few rules from which the whole design follows.

*Every dimension has a reason.*

## The 4FusionLab family

**[Perfora](https://github.com/4FusionLab/Perfora)** — goddess of holes · **[Selectra](https://github.com/4FusionLab/Selectra)** — goddess of choice · **[Ejix](https://github.com/4FusionLab/Ejix)** — spirit of extraction · **[RuEn](https://github.com/4FusionLab/RuEn)** — hero of translation · **[Planara](https://github.com/4FusionLab/Planara)** — goddess of flat worlds (planned)

Paramood is an independent **[4FusionLab](https://github.com/4FusionLab)** project. It is not affiliated with or endorsed by Autodesk. Licensing, platform compatibility, and installation details will be documented when an implementation is released.
