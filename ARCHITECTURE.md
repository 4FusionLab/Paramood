# Paramood architecture

[Русская версия](ARCHITECTURE.ru.md)

## Layers

The Preact interface runs in a Fusion Palette and uses a single JSON bridge. The bridge carries a request ID, action, data, and active document ID; responses contain the same ID and either a result or a structured error. A document-change event prompts the interface to fetch state again. Document values must not be cached between models.

The Fusion Adapter rereads the active Design and calls the Fusion API on the main thread. Parameter mutation code must run in a command context, rechecking the active document and current state. Fusion remains the source of truth. Implementation status and limitations of operations are documented in `docs/PROJECT_STATUS.md`.

The pure core parses a limited subset of expressions without `eval`, constructs dependencies, evaluates dimensions, and prepares operation order. Core values are represented in millimeters, radians, and dimensionless units; these are not Fusion's internal storage units. An additional Fusion check is required before writing. Unknown units and dimensions are rejected rather than guessed.

Cleanup analysis must account for used parameters, favorites, user-saved parameters, and transitive dependencies. Absence of proof that dependencies are complete is not proof that deletion is safe. See `docs/FUSION_API_RESEARCH.md`.

## Recovery and transactions

Fusion command operations may be grouped in Undo. This alone does not prove atomicity for every failure. The core contains a compensation mechanism, but writing an expression back does not guarantee restoration of all metadata and relationships. Final semantics depend on real checks inside Fusion; do not claim them before verification.

## Events and lifecycle

Subscriptions and handlers are retained until the add-in stops. After a document switch, the interface receives a notification and requests state again. Fusion can remove a palette when changing workspaces; code must check its validity before showing it again. API documentation and open questions are in `docs/FUSION_API_RESEARCH.md`.
