# Fusion expression reference

Paramood uses the case-sensitive Autodesk Fusion expression language. This reference and the editor share the metadata in `Paramood/core/expression_catalog.json`.

## Functions

Arguments are separated with semicolons. Function completion reuses existing parentheses and places the cursor inside. Runtime numeric validity and results come from Fusion itself.

### `sin(angle)`

Returns the sine of an angle.

Category: Trigonometry. Returns: unitless.

| Argument | Type / dimension | Description |
| --- | --- | --- |
| `angle` | angle | Angle to evaluate. |

Example: `sin(30 deg)`.

Use explicit deg or rad units. Bare arguments use Fusion angle preferences.

### `cos(angle)`

Returns the cosine of an angle.

Category: Trigonometry. Returns: unitless.

| Argument | Type / dimension | Description |
| --- | --- | --- |
| `angle` | angle | Angle to evaluate. |

Example: `cos(30 deg)`.

Use explicit deg or rad units. Bare arguments use Fusion angle preferences.

### `tan(angle)`

Returns the tangent of an angle.

Category: Trigonometry. Returns: unitless.

| Argument | Type / dimension | Description |
| --- | --- | --- |
| `angle` | angle | Angle to evaluate. |

Example: `tan(30 deg)`.

Use explicit deg or rad units. Bare arguments use Fusion angle preferences.

### `sinh(angle)`

Returns the hyperbolic sine of an angle.

Category: Trigonometry. Returns: unitless.

| Argument | Type / dimension | Description |
| --- | --- | --- |
| `angle` | angle | Angle to evaluate. |

Example: `sinh(30 deg)`.

Use explicit deg or rad units. Bare arguments use Fusion angle preferences.

### `cosh(angle)`

Returns the hyperbolic cosine of an angle.

Category: Trigonometry. Returns: unitless.

| Argument | Type / dimension | Description |
| --- | --- | --- |
| `angle` | angle | Angle to evaluate. |

Example: `cosh(30 deg)`.

Use explicit deg or rad units. Bare arguments use Fusion angle preferences.

### `tanh(angle)`

Returns the hyperbolic tangent of an angle.

Category: Trigonometry. Returns: unitless.

| Argument | Type / dimension | Description |
| --- | --- | --- |
| `angle` | angle | Angle to evaluate. |

Example: `tanh(30 deg)`.

Use explicit deg or rad units. Bare arguments use Fusion angle preferences.

### `asin(value)`

Returns the inverse sine as an angle.

Category: Trigonometry. Returns: angle.

| Argument | Type / dimension | Description |
| --- | --- | --- |
| `value` | unitless | Unitless input value. |

Example: `asin(0.5)`.

-1 <= value <= 1.

### `acos(value)`

Returns the inverse cosine as an angle.

Category: Trigonometry. Returns: angle.

| Argument | Type / dimension | Description |
| --- | --- | --- |
| `value` | unitless | Unitless input value. |

Example: `acos(0.5)`.

-1 <= value <= 1.

### `atan(value)`

Returns the inverse tangent as an angle.

Category: Trigonometry. Returns: angle.

| Argument | Type / dimension | Description |
| --- | --- | --- |
| `value` | unitless | Unitless input value. |

Example: `atan(1)`.

### `asinh(value)`

Returns the inverse hyperbolic sine as an angle.

Category: Trigonometry. Returns: angle.

| Argument | Type / dimension | Description |
| --- | --- | --- |
| `value` | unitless | Unitless input value. |

Example: `asinh(1)`.

### `acosh(value)`

Returns the inverse hyperbolic cosine as an angle.

Category: Trigonometry. Returns: angle.

| Argument | Type / dimension | Description |
| --- | --- | --- |
| `value` | unitless | Unitless input value. |

Example: `acosh(2)`.

value >= 1.

### `atanh(value)`

Returns the inverse hyperbolic tangent as an angle.

Category: Trigonometry. Returns: angle.

| Argument | Type / dimension | Description |
| --- | --- | --- |
| `value` | unitless | Unitless input value. |

Example: `atanh(0.5)`.

-1 < value < 1.

### `sqrt(value)`

Returns the square root.

Category: Mathematics. Returns: square root of input dimension.

| Argument | Type / dimension | Description |
| --- | --- | --- |
| `value` | numeric | Value to evaluate. |

Example: `sqrt(4)`.

The input must be nonnegative; dimension powers must admit a square root.

### `abs(value)`

Returns the absolute value.

Category: Mathematics. Returns: same as input.

| Argument | Type / dimension | Description |
| --- | --- | --- |
| `value` | numeric | Value to evaluate. |

Example: `abs(-5 mm)`.

### `floor(value)`

Rounds down to the nearest integer.

Category: Mathematics. Returns: same as input.

| Argument | Type / dimension | Description |
| --- | --- | --- |
| `value` | numeric | Value to evaluate. |

Example: `floor(-1.5)`.

### `ceil(value)`

Rounds up to the nearest integer.

Category: Mathematics. Returns: same as input.

| Argument | Type / dimension | Description |
| --- | --- | --- |
| `value` | numeric | Value to evaluate. |

Example: `ceil(1.5)`.

### `round(value)`

Rounds to the nearest integer.

Category: Mathematics. Returns: same as input.

| Argument | Type / dimension | Description |
| --- | --- | --- |
| `value` | numeric | Value to evaluate. |

Example: `round(-1.5)`.

Halfway values round away from zero.

### `sign(value)`

Returns 1 for positive input and 0 otherwise.

Category: Mathematics. Returns: unitless.

| Argument | Type / dimension | Description |
| --- | --- | --- |
| `value` | numeric | Value to evaluate. |

Example: `sign(-2)`.

Fusion sign is not the mathematical -1/0/1 signum.

### `exp(value)`

Returns e raised to the input power.

Category: Mathematics. Returns: unitless.

| Argument | Type / dimension | Description |
| --- | --- | --- |
| `value` | unitless | Value to evaluate. |

Example: `exp(2)`.

The result must be finite.

### `ln(value)`

Returns the natural logarithm.

Category: Mathematics. Returns: unitless.

| Argument | Type / dimension | Description |
| --- | --- | --- |
| `value` | unitless | Value to evaluate. |

Example: `ln(E)`.

value > 0.

### `log(value)`

Returns the base-10 logarithm.

Category: Mathematics. Returns: unitless.

| Argument | Type / dimension | Description |
| --- | --- | --- |
| `value` | unitless | Value to evaluate. |

Example: `log(100)`.

value > 0.

### `min(first; second)`

Returns the smaller of two values.

Category: Mathematics. Returns: same as input.

| Argument | Type / dimension | Description |
| --- | --- | --- |
| `first` | numeric | First value. |
| `second` | same as first | Second value, with the same dimension. |

Example: `min(2 mm; 3 mm)`.

Exactly two arguments; dimensions must match.

### `max(first; second)`

Returns the larger of two values.

Category: Mathematics. Returns: same as input.

| Argument | Type / dimension | Description |
| --- | --- | --- |
| `first` | numeric | First value. |
| `second` | same as first | Second value, with the same dimension. |

Example: `max(2 mm; 3 mm)`.

Exactly two arguments; dimensions must match.

### `pow(base; exponent)`

Raises a base to the specified exponent.

Category: Mathematics. Returns: base dimension raised to exponent.

| Argument | Type / dimension | Description |
| --- | --- | --- |
| `base` | numeric | Base value. |
| `exponent` | unitless | Exponent value. |

Example: `pow(2; 3)`.

Fusion rounds decimal powers at the eighth decimal place. The result must be real and finite.

### `random()`

Returns a nondeterministic unitless random value.

Category: Mathematics. Returns: unitless.

Example: `random()`.

Preview shows a sample. Fusion evaluates the original expression again when applied or recomputed; the resulting value can change.

### `if(condition; whenTrue; whenFalse)`

Returns one of two expressions according to a logical condition.

Category: Logic. Returns: same as branches.

| Argument | Type / dimension | Description |
| --- | --- | --- |
| `condition` | boolean | Logical test using comparisons, and, or, or not. |
| `whenTrue` | any | Value when the test is true. |
| `whenFalse` | same as whenTrue | Value when the test is false, with the same dimension and type. |

Example: `if(2 mm < 3 mm; 10 mm; 20 mm)`.

Fusion evaluates only the selected branch. Unitless numeric branches can adopt the other branch dimension.

## Constants

Names are case-sensitive. Constants are values, not callable functions. Their dedicated color distinguishes them from parameters and functions.

| Name | Value | Unit / dimension | Example |
| --- | --- | --- | --- |
| `PI` | 3.141592653589793 | unitless | `2 * PI * 5 mm` |
| `E` | 2.718281828459045 | unitless | `ln(E)` |
| `Gravity` | 980.665 | cm/s^2 | `Gravity / (1 mm / s^2)` |
| `SpeedOfLight` | 29979245800 | cm/s | `SpeedOfLight / (1 mm / s)` |

## Operators

Arithmetic: `+`, `-`, `*`, `/`, `%`, `^`. Exponentiation is right-associative and precedes unary minus: `-2^2` is `-4`; `2^3^2` is `512`. Modulo follows the dividend sign: `-7 % 3` is `-1`.

Inside `if` conditions: `>`, `<`, `>=`, `<=`, `==`, `<>`, `and`, `or`, `not`. Use parentheses to group logical expressions. Python-style `!=` and `**` are not Fusion operators.

## Units and dimensions

The editor recognizes these abbreviations from the Autodesk unit reference:

`rad`, `deg`, `grad`, `rpm`, `acre`, `circular_mil`, `farad`, `coulomb`, `S`, `mho`, `dol`, `A`, `J`, `erg`, `calorie`, `Btu`, `V`, `ccs`, `cis`, `cfm`, `cmh`, `gpm`, `lph`, `N`, `dyne`, `lbforce`, `ounceforce`, `tonforce`, `Hz`, `lx`, `H`, `mm`, `cm`, `m`, `hm`, `micron`, `in`, `ft`, `yd`, `mi`, `nauticalMile`, `mil`, `cd`, `EV`, `lm`, `Wb`, `maxwell`, `T`, `gamma`, `gauss`, `oersted`, `g`, `kg`, `slug`, `lbmass`, `ouncemass`, `tonmass`, `pcs`, `W`, `hp`, `Pa`, `psi`, `psf`, `ksi`, `bar`, `atm`, `inH2O`, `ftH2O`, `mH2O`, `mmHg`, `inHg`, `ohm`, `sr`, `mps`, `fps`, `mph`, `knots`, `mmpm`, `mpm`, `inpm`, `ftpm`, `mole`, `K`, `C`, `F`, `R`, `s`, `min`, `hr`, `poise`, `l`, `gal`, `qt`, `pt`, `cup`, `fl_oz`.

Preview, Calculate, and Apply support the 96 abbreviations above, compound dimensions, and native unit aliases. The metadata includes Fusion-verified dimensions, scale factors, offsets, and canonical aliases. Examples include `area=10 mm*20 mm`, `mass=5 kg`, `force=2 N`, `temperature=-20 C`, `speed=SpeedOfLight`, and `root=pow(8 mm^3;1/3)`. A decimal exponent is accepted when Fusion accepts its resulting dimension. Fusion itself rejects unsupported fractional dimensions such as a standalone `sqrt(4 mm)`; Paramood does not impose an additional dimension allowlist.

Native quote and symbol suffixes are accepted: `1"`, `1'`, `2 µ`, and `30 °`. Quote suffixes do not start text literals or swallow subsequent batch definitions. Quoted text such as `'1"'` remains text. Long native aliases such as `2 centimeter` are normalized with Fusion's `formatUnits`.

`n` remains a Paramood-only unitless suffix, removed before sending formulas to Fusion. The planner retains mm internally; conversions account for the length exponent in derived units, while Fusion uses cm. Other base dimensions use Fusion's internal units. Affine temperature offsets are preserved.

## Signature Help and diagnostics

Typing `(` opens the function signature. The current argument is emphasized; `;` advances it. Nested calls, grouped expressions, cursor movement, and editing existing formulas update the signature. Closing a nested call restores the outer signature. Descriptions, argument dimensions, restrictions, return types, and examples fit a narrow palette and scroll when necessary.

Confirmed errors receive a wavy underline and an English explanation on hover: unknown calls and completed parameter references, unknown unit abbreviations, wrong argument counts, clearly incompatible argument dimensions, commas, invalid operators, extra closing parentheses, and calling a constant. Missing trailing arguments, opening parentheses, strings, and identifier prefixes are treated as unfinished input. Dimension diagnostics intentionally cover only expressions whose types can be established locally; Preview and Apply remain the authoritative full validation steps. An unclosed opening parenthesis is reported by Preview rather than while typing.

## Native evaluation and random expressions

The production bridge delegates original numeric expressions to `FusionUnitsManager.isValidExpression` and `evaluateExpression` on Fusion's main thread. The symbolic layer infers unit hints and substitutes planned values for parameters not yet created or modified. Existing unchanged references and source formulas are preserved. A local numerical approximation does not veto a valid native result. No temporary model parameters are created during Preview.

`random()` works in Calculator, Preview, Apply, inline edits, dependencies, and saved variants. Preview rows show `≈` and explain that the value is a sample. Apply writes the original formula, including `random()`, and the parameter list refreshes from actual native values. Sample values are not substituted into the model formula. The adapter verifies expression, type, and finiteness without requiring a fresh random result to equal a previous sample. The sample marker propagates through dependencies.

Preview snapshots retain document identity, expressions, units, variant identity, and deterministic values. A natural change in a random-dependent value does not create a false stale-preview failure; a formula, unit, document, or deterministic-value edit still invalidates the preview. Random-containing variants match their expressions after recompute and reopen.

Native semantics also control lazy `if` branches, implicit numeric units, dimensioned `floor`/`ceil`/`round`, and `sign` of dimensioned input. For example, `if(1<2;2;1/0)` is accepted because Fusion does not evaluate the unused branch. Errors from Fusion remain structured bridge errors. Cycles, changed document identity, incompatible existing parameter types, and stale deterministic data are still checked before mutation.

The pure offline evaluator is retained for host-independent tests and unit algebra. Host-dependent values, including random samples and angle preferences, require a native callback. This is not a runtime rejection policy. Existing input/payload size bounds remain in place to protect the palette bridge.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| Ctrl+Space | Open completion explicitly |
| Up / Down | Select a completion |
| Tab / Enter | Accept the selected completion |
| Escape | Close completion; cancel an inline edit when completion is closed |
| Enter without completion | Submit the expression / preview |
| Shift+Enter | Insert a line break in multiline editors |

## Sources and verification

- [Autodesk Parameters reference](https://help.autodesk.com/cloudhelp/ENU/Fusion-Model/files/GUID-76272551-3275-46C4-AE4D-10D58B408C20.htm)
- [Autodesk Unit types](https://help.autodesk.com/cloudhelp/ENU/Fusion-Model/files/DSN-REF-PARAMETERS-UNITS.htm)
- [FusionUnitsManager](https://autodeskfusion360.github.io/FusionAPIReference/Fusion_API_Documentation/files/FusionUnitsManager.htm)
- [CodeMirror tooltip API](https://codemirror.net/docs/ref/#view.showTooltip)

The Autodesk reference contains loose type descriptions for `sign` and `exp`; Paramood documents their observed numeric behavior. `sign(-2)=0`, `sign(0)=0`, halfway rounding away from zero, two-argument min/max, and angle-valued inverse hyperbolic functions were checked in Fusion 2706.1.17 on macOS. See [native acceptance evidence](EXPRESSION_ACCEPTANCE.md).
