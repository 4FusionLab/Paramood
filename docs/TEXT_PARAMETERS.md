# Text parameters — implementation and validation

English | [Русский](TEXT_PARAMETERS.ru.md)

Date: 7 November 2026. Working branch: `codex/variants`.

## Contract

- A single- or double-quoted literal creates a text parameter without manually selecting its type: `caption='Корпус'` or `caption="Корпус"`. An unknown unquoted identifier does not become text.
- The list receives the computed `textValue`; the editor receives the original `expression`. Applying an edit changes only `expression`: `textValue` is never written because its setter destroys the formula.
- References to text parameters, `+` concatenation and `if(condition; text; text)` with a single comparison of compatible values are supported. An existing parameter's type cannot be changed.
- Inside literals, `;`, line breaks, `=`, virtual dotted names and `this` are content. Batch splitting and identifier substitution respect quotes and parentheses.
- Quotes are normalized to Fusion syntax: single quotes with `\'`, `\\`, `\n`, `\r`, and `\t` escapes. Unknown escape sequences are rejected. SQL-style `'a''b'` is not accepted; concatenation requires `+`. After writing, the result is checked by exact `textValue` comparison.
- A string is limited to 65,536 characters, and the combined computed strings in a batch to 262,144. Combined lengths are checked before concatenation so that a short doubling chain cannot exhaust Fusion memory.

## Mixed models and variants

The adapter reads types and both sides of the API dependency graph for all parameters. Text is not excluded from dependency consistency checks. Completeness and cycles in the entire graph are checked before numeric planning; only text nodes unnecessary for the requested operations and numeric parameters are excluded from the evaluated subgraph. Thus an unused text formula, even outside Paramood's supported grammar, does not block numeric edits. Unknown dependencies and an inconsistent graph still cause rejection. Unsupported expressions in the subgraph actually required are rejected.

Variants store text values with the `Text` unit, original expressions and entityTokens. On opening, strings are compared exactly, including empty strings and spaces. Saving, applying, automatically adding changed text to an active variant, and reopening F3D were checked in real Fusion. Renaming replaces only identifiers in expressions; matching words inside text content remain unchanged.

## Sources and native observations

- [UserParameters.add](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/fusion_UserParameters_add.htm): the `Text` unit.
- [Parameter.valueType](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/fusion_Parameter_valueType.htm).
- [Parameter.expression](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/fusion_Parameter_expression.htm): references, concatenation and conditional strings.
- [UserParameter.textValue](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/fusion_UserParameter_textValue.htm): its setter overwrites expression.
- [ParameterValueTypes](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/fusion_ParameterValueTypes.htm).

Context7 was used; its copy of the UserParameters.add reference does not describe modern Text parameters, so final decisions were checked against official Autodesk pages and the installed Fusion. Fusion 2706.1.17 on macOS rejects double-quoted expressions and SQL-style quotes, but accepts `\'`, `\\`, line breaks and an empty literal. `fusionUnitsManager.isValidExpression(expr, 'Text')` returns false even for a valid `'Корпус'` accepted by UserParameters.add. Text therefore uses the pure typed planner with a subsequent check of the actual written result; numeric validation via isValidExpression remains in place.

## Validation

An isolated document covered both input quoting styles, empty strings, apostrophes and double quotes, backslashes, line breaks and tabs, `a=b;c` as content, the formula `quote+' / '+note`, conditional text based on width, numeric updates in a mixed model, rejection of numeric↔text changes, automatically adding a string to the active variant, applying a text variant, and recovery after F3D export/import. Original documents were unchanged; their names and isModified states were checked before and after. Temporary documents were closed.

An independent read-only review found and confirmed fixes for four defects: adjacent literals, interpreting comparisons as assignments, the `__CURRENT__` marker inside text, and exponential concatenation. Regression tests were added. Full validation of the installed UI on a user test model and preparation of public documentation were handed off for follow-up.
