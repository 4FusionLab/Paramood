# Paramood architecture

[Русская версия](ARCHITECTURE.ru.md)

> **Historical design note.** Some statements below describe intended architecture and unresolved behavior. For the current implementation and limitations, see the [README](README.md).

## Layers

The Preact interface runs in a Fusion Palette and uses a single JSON bridge. The bridge carries a request ID, action, data, and active document ID; responses contain the same ID and either a result or a structured error. A document-change event prompts the interface to fetch state again. Document values must not be cached between models.

The Fusion Adapter rereads the active Design and calls the Fusion API on the main thread. Parameter mutation code must run in a command context, rechecking the active document and current state. Fusion remains the source of truth. For current operation status and limitations, see the [README](README.md).

The pure core parses a limited subset of expressions without `eval`, constructs dependencies, evaluates dimensions, and prepares operation order. Core values are represented in millimeters, radians, and dimensionless units; these are not Fusion's internal storage units. An additional Fusion check is required before writing. Unknown units and dimensions are rejected rather than guessed.

Cleanup analysis must account for used parameters, favorites, user-saved parameters, and transitive dependencies. Absence of proof that dependencies are complete is not proof that deletion is safe.

## Recovery and transactions

Fusion command operations may be grouped in Undo. This alone does not prove atomicity for every failure. The core contains a compensation mechanism, but writing an expression back does not guarantee restoration of all metadata and relationships. Final semantics depend on real checks inside Fusion; do not claim them before verification.

## Events and lifecycle

Subscriptions and handlers are retained until the add-in stops. After a document switch, the interface receives a notification and requests state again. Fusion can remove a palette when changing workspaces; code must check its validity before showing it again. See the [active-command investigation](docs/ACTIVE_COMMAND_APPLY_INVESTIGATION.md) for recorded checks and open questions.

## Text, variants, and display

The core distinguishes numeric Quantity from TextValue. It parses literals with awareness of quotation, so separators and identifiers inside strings do not become commands or references. Length limits are checked before concatenation and writes. The adapter reads computed textValue for the list, but writes the original expression to preserve formulas.

Versioned variant storage resides in Design attributes. It contains stable variant IDs, participant entityTokens, expressions, units, and values. Writes check documentId, snapshotToken, and storage version; unknown or corrupt formats are not overwritten. A full value match determines the active variant on opening. Successful Paramood edits update the active set; an external mismatch switches to Free.

Parameters and variants share the frontend grouping algorithm. An independent parameter can coexist with a group of the same name; the shared ParameterIndex converts a dotted path to its actual Fusion name. Hybrid, Calculator, and Parameter list share input state.

Length-unit changes are sent as a separate validated request to FusionUnitsManager.distanceDisplayUnits and preserve physical sizes. Clipboard operations belong to the frontend: Fusion/Qt uses synchronous copying on the user click through a temporary field, checking success and restoring focus. In an ordinary browser, the Clipboard API is tried first, with the same limited fallback on failure. Native clipboard acceptance is recorded separately from automated tests.
