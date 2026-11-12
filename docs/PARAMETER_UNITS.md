# Existing parameter units

[Русский](PARAMETER_UNITS.ru.md)

## Confirmed API boundary

The requested feature is a change to an individual parameter's assigned native unit/type,
not the document's display units. As of 11 November 2026, Autodesk documents
[`UserParameter.unit`](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/fusion_UserParameter_unit.htm)
and [`valueType`](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/fusion_UserParameter_valueType.htm)
as read-only. The installed Fusion 2706.1.17 Python bindings also expose no setters for either property.
The same boundary applies to model parameters through the base `Parameter` API.

Consequently Paramood does **not** offer an assigned-unit or type mutation for existing
parameters, including unused parameters. Units in the tree are plain text with no interaction.
Text and dimensionless parameters show `Text` and `—`, respectively.
This is an API limitation, not evidence that an unused parameter is being used.

## Support matrix

Each family below has the same result: **no in-place assigned-unit/type change through the API**.
The matrix covers all families in Autodesk's
[unit type reference](https://help.autodesk.com/cloudhelp/ENU/Fusion-Model/files/DSN-REF-PARAMETERS-UNITS.htm)
and the existing Fusion unit catalog; it is not restricted to length and angle.

| Families | Examples | Existing parameter change |
| --- | --- | --- |
| Length; angle | mm, in; deg, rad | Unavailable |
| Area; volume; time | cm^2; l; s | Unavailable |
| Angular velocity; speed; flow rate | rpm; m/s; cfm | Unavailable |
| Mass; force; energy; power; pressure; viscosity | kg; N; J; W; Pa; poise | Unavailable |
| Temperature; substance | K; mole | Unavailable |
| Current; charge; capacitance; conductance; resistance; electromotive force; inductance | A; coulomb; farad; S; ohm; V; H | Unavailable |
| Magnetic flux; magnetic field; magnetizing field | Wb; T; oersted | Unavailable |
| Luminosity; luminous flux; illuminance; solid angle | cd; lm; lx; sr | Unavailable |
| Frequency; currency; pieces | Hz; dol; pcs | Unavailable |
| Other valid compound dimensions | kg*m/s^2 | Unavailable |
| Dimensionless | empty unit string | Unavailable |
| Text; numeric ↔ text | Text | Unavailable |

The API accepts units when **creating** a new parameter through
[`UserParameters.add`](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/fusion_UserParameters_add.htm).
Creation is not a way to mutate an existing parameter while preserving its identity.

## Alternatives assessed

- [`expression`](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/fusion_UserParameter_expression.htm)
  accepts compatible explicit units. For example, a millimeter parameter can use `1 in`.
  This edits the formula/value; it does not change its assigned unit. Replacing a formula
  with its converted numeric result would lose dependencies and is not an automatic conversion.
- [`UnitsManager.convert`](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/core_UnitsManager_convert.htm)
  and `formatValue` convert or format compatible values without changing parameter metadata.
  A palette-only display preference would not meet the requested native-unit behavior.
- `FusionUnitsManager.distanceDisplayUnits` affects the design's length display setting,
  not a specific parameter's type. It remains the separate selector beside the document name.
- Deleting and recreating a parameter cannot preserve its entity identity and would risk
  formulas, geometry, comments, favorites and saved variants. Paramood does not attempt it.
- Fusion's native **Change Parameters** dialog is the manual route for native unit editing,
  subject to Fusion's own restrictions. Paramood does not automate that dialog or claim
  it validates Paramood's saved variants for a cross-dimension change.

A future mutation implementation needs a supported API first. It must recheck the active
document and snapshot, real parameter/geometry dependents and all saved variant expressions.
Incomplete dependency evidence must never classify a parameter as free. Used parameters may
only change within their dimension; changing dimension requires an explicit expression/value
preview and preservation of entity identity and metadata. Those mutation paths are currently
unavailable rather than simulated.
