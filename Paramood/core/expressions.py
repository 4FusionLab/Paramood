"""Conservative expression planner. Values use millimetres and radians internally.

Only explicit supported units and a restricted arithmetic grammar are accepted.
Fusion must validate planned expressions again before any model modification.
"""

from __future__ import annotations

import ast
import math
import re
from dataclasses import dataclass, replace
from typing import ClassVar, Mapping, Tuple
from itertools import zip_longest

from .builtins import CATALOG, FUNCTIONS, CONSTANT_NAMES, UNIT_NAMES

from .text import decode_literal, map_code, normalize_literals, segments, split_definitions

Dimension = Tuple[float, ...]  # powers of length, angle, and optional time
SCALAR = (0, 0)
LENGTH = (1, 0)
ANGLE = (0, 1)
TEXT = 'text'
MAX_TEXT_LENGTH = 65536
MAX_BATCH_TEXT_LENGTH = 262144
UNITS = {
    item['name']: (item['factor'], tuple(item['dimension'])) for item in CATALOG['unitDefinitions']
}
for item in CATALOG['unitDefinitions']:
    for alias in item['aliases']:
        UNITS[alias] = (item['factor'], tuple(item['dimension']))
UNITS['n'] = (1.0, SCALAR)
UNIT_OFFSETS = {
    name: item['offset']
    for item in CATALOG['unitDefinitions']
    for name in [item['name'], *item['aliases']]
}
_UNIT_PATTERN = '|'.join(re.escape(u) for u in sorted(UNIT_NAMES | {'n'}, key=len, reverse=True))
_LITERAL = re.compile(
    r'(?<![\w.])((?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*(' + _UNIT_PATTERN + r')\b(?!\s*\()'
)
_NAME = re.compile(r'^[A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё_0-9]*$')
_NUMERIC = re.compile(r'^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$')
_NUMERIC_WITH_UNIT = re.compile(
    r'^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?\s*(' + '|'.join(UNITS) + r')$'
)


def _literal_unit(expression, dimension, fallback):
    match = _NUMERIC_WITH_UNIT.fullmatch(expression.strip())
    if match and UNITS[match.group(1)][1] == dimension:
        return '' if match.group(1) == 'n' else match.group(1)
    return fallback


_FUNCTIONS = set(FUNCTIONS) | {'__if__'}
_DOTTED = re.compile(
    r'(?<![\w.])[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё0-9]*(?:\.[A-Za-zА-Яа-яЁё0-9]+)+(?![\w.])'
)


class ExpressionError(ValueError):
    """An expression cannot be evaluated safely."""


class LocalEvaluationUnsupported(ExpressionError):
    """Valid Fusion syntax whose result cannot be established by the local evaluator."""


def _dimension(values):
    result = [round(v) if math.isclose(v, round(v), abs_tol=1e-7) else round(v, 8) for v in values]
    while len(result) > 2 and result[-1] == 0:
        result.pop()
    return tuple(result)


def dimension_unit(dimension, length_unit='mm'):
    """Serialize native dimensions; all base units come from the Fusion catalog."""
    bases = (length_unit, 'rad', 's', 'kg', 'A', 'K', 'mole', 'cd', 'dol', 'pcs', 'sr')
    if len(dimension) > len(bases):
        raise LocalEvaluationUnsupported('Unknown Fusion base dimension')
    numerator, denominator = [], []
    for unit, power in zip(bases, dimension):
        if power:
            magnitude = abs(power)
            part = unit if magnitude == 1 else unit + '^' + format(magnitude, '.8g')
            (numerator if power > 0 else denominator).append(part)
    if not numerator and denominator:
        # Fusion unit strings need a unit numerator, not the numeric token "1".
        numerator.append(length_unit)
        denominator.insert(0, length_unit)
    top = '*'.join(numerator)
    return top + '/' + '/'.join(denominator) if denominator else top


def unit_definition(unit):
    if not unit:
        return 1.0, SCALAR, 0.0
    if unit in UNITS:
        factor, dim = UNITS[unit]
        return factor, dim, UNIT_OFFSETS.get(unit, 0.0)
    quantity = evaluate('1 ' + unit, {})
    if isinstance(quantity, TextValue):
        raise ExpressionError('Expected a numeric unit')
    return quantity.value, quantity.dimension, 0.0


def stochastic_expression(expression, parameters=None):
    tree = _tree(expression)
    return any(
        isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id == 'random'
        for n in ast.walk(tree)
    ) or any(
        getattr((parameters or {}).get(name), 'stochastic', False) for name in _dependencies(tree)
    )


def mark_stochastic(expressions, dependencies):
    names = {name for name, expr in expressions.items() if stochastic_expression(expr)}
    while True:
        expanded = names | {name for name, deps in dependencies.items() if deps & names}
        if expanded == names:
            return names
        names = expanded


def _assignment(item: str) -> tuple[str, str, str]:
    parts = item.split('=', 1)
    if len(parts) != 2 or not parts[1].strip():
        raise ExpressionError('Expected name=expression')
    left = parts[0].strip()
    operator = left[-1:] if left[-1:] in ('+', '-', '*', '/') else ''
    if operator:
        left = left[:-1].strip()
    if not (_NAME.fullmatch(left) or _DOTTED.fullmatch(left)):
        raise ExpressionError('Expected name=expression')
    return left.replace('.', '_'), operator, parts[1].strip()


def normalize_expression(expression: str, names) -> str:
    """Resolve virtual paths only when the exact flat parameter is available."""
    available = set(names)

    def replace(match):
        name = match.group().replace('.', '_')
        if name not in available:
            raise ExpressionError('Unknown parameter: ' + match.group())
        return name

    return map_code(normalize_literals(expression), lambda code: _DOTTED.sub(replace, code))


@dataclass(frozen=True)
class Quantity:
    value: float
    dimension: Dimension = SCALAR
    stochastic: bool = False


@dataclass(frozen=True)
class TextValue:
    value: str
    stochastic: bool = False
    dimension: ClassVar[str] = TEXT


@dataclass(frozen=True)
class Operation:
    name: str
    expression: str
    quantity: Quantity | TextValue
    unit: str
    status: str
    previous: Quantity | TextValue | None = None


def _tree(expression: str) -> ast.Expression:
    previous_literal = False
    for literal, raw in segments(expression):
        if literal and previous_literal:
            raise ExpressionError('Use + to concatenate text literals')
        if literal or raw.strip():
            previous_literal = literal
    if any(
        not literal and re.search(r'\b__unit__\b', raw) for literal, raw in segments(expression)
    ):
        raise ExpressionError('Reserved internal identifier')

    def code(raw):
        if ',' in raw:
            raise ExpressionError('Separate function arguments with a semicolon (;)')
        if '!=' in raw or '**' in raw:
            raise ExpressionError('Use Fusion operators <> and ^')
        raw = re.sub(r'\bif\s*\(', '__if__(', raw).replace(';', ',')
        raw = raw.replace('<>', '!=').replace('^', '**')
        # A postfix unit power applies to the unit, not the coefficient: 4 mm^2.
        raw = re.sub(
            _LITERAL.pattern + r'\s*\*\*\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)',
            lambda m: '(' + m.group(1) + '*__unit__(1,"' + m.group(2) + '")**(' + m.group(3) + '))',
            raw,
        )
        raw = _LITERAL.sub(lambda m: '__unit__(' + m.group(1) + ',"' + m.group(2) + '")', raw)
        return re.sub(
            r'(?<=[\w)])\s+(' + _UNIT_PATTERN + r')\b(?!\s*\()',
            lambda m: '*__unit__(1,"' + m.group(1) + '")',
            raw,
        )

    source = ''.join(
        repr(decode_literal(raw)) if literal else code(raw) for literal, raw in segments(expression)
    )
    try:
        return ast.parse(source, mode='eval')
    except (SyntaxError, ValueError) as exc:
        raise ExpressionError('Invalid expression syntax') from exc


def _dependencies(tree: ast.Expression) -> set[str]:
    names = {n.id for n in ast.walk(tree) if isinstance(n, ast.Name)}
    calls = {
        n.func.id
        for n in ast.walk(tree)
        if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)
    }
    return names - calls - CONSTANT_NAMES - set(UNITS) - {'n'}


def evaluate(
    expression: str,
    parameters: Mapping[str, Quantity | TextValue],
    native_function=None,
    allow_nondeterministic=False,
) -> Quantity | TextValue:
    """Evaluate supported operations, rejecting unknown units/functions and dimensions."""
    if len(expression) > 10000:
        raise ExpressionError('Expression is too long')
    expression = normalize_expression(expression, parameters)
    if hasattr(native_function, 'evaluate'):
        return native_function.evaluate(expression, parameters)
    tree = _tree(expression)
    if sum(1 for _ in ast.walk(tree)) > 2000:
        raise ExpressionError('Expression is too complex')
    for call in ast.walk(tree):
        if (
            isinstance(call, ast.Call)
            and isinstance(call.func, ast.Name)
            and call.func.id in FUNCTIONS
        ):
            if len(call.args) != FUNCTIONS[call.func.id]['arity'] or call.keywords:
                raise ExpressionError('Invalid function arguments')

    def logical(node):
        if isinstance(node, ast.BoolOp) and isinstance(node.op, (ast.And, ast.Or)):
            values = [logical(value) for value in node.values]
            return all(values) if isinstance(node.op, ast.And) else any(values)
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.Not):
            return not logical(node.operand)
        if isinstance(node, ast.Compare) and len(node.ops) == 1:
            a, b = calc(node.left), calc(node.comparators[0])
            if a.dimension != b.dimension:
                raise ExpressionError('Incompatible conditional types')
            comparisons = {
                ast.Lt: lambda: a.value < b.value,
                ast.LtE: lambda: a.value <= b.value,
                ast.Gt: lambda: a.value > b.value,
                ast.GtE: lambda: a.value >= b.value,
                ast.Eq: lambda: a.value == b.value,
                ast.NotEq: lambda: a.value != b.value,
            }
            compare = comparisons.get(type(node.ops[0]))
            if compare:
                return compare()
        raise ExpressionError('Unsupported conditional expression')

    def power(a, b):
        if b.dimension != SCALAR:
            raise ExpressionError('Exponent must be dimensionless')
        exponent = b.value
        if abs(exponent) > 10000:
            raise ExpressionError('Exponent is too large')
        dim = [round(d * exponent, 8) for d in a.dimension]
        if a.value < 0 and exponent != int(exponent):
            raise ExpressionError('Power must have a real result')
        return Quantity(math.pow(a.value, exponent), _dimension(dim))

    def calc(node: ast.AST) -> Quantity | TextValue:
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            return TextValue(node.value)
        if isinstance(node, ast.Constant) and type(node.value) in (int, float):
            return Quantity(float(node.value))
        if isinstance(node, ast.Name):
            if node.id not in parameters:
                constants = {
                    'PI': Quantity(math.pi),
                    'E': Quantity(math.e),
                    'Gravity': Quantity(9806.65, (1, 0, -2)),
                    'SpeedOfLight': Quantity(299792458000.0, (1, 0, -1)),
                }
                if node.id in constants:
                    return constants[node.id]
                if node.id in UNITS:
                    factor, dimension = UNITS[node.id]
                    return Quantity(factor, dimension)
                if node.id in UNIT_NAMES:
                    raise LocalEvaluationUnsupported(
                        'Unit requires native Fusion evaluation: ' + node.id
                    )
                raise ExpressionError('Unknown parameter: ' + node.id)
            value = parameters[node.id]
            if isinstance(value, TextValue) and len(value.value) > MAX_TEXT_LENGTH:
                raise ExpressionError('Text result exceeds 65536 characters')
            return value
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
            q = calc(node.operand)
            if isinstance(q, TextValue):
                raise ExpressionError('Text cannot be used in numeric operations')
            return Quantity(q.value if isinstance(node.op, ast.UAdd) else -q.value, q.dimension)
        if isinstance(node, ast.BinOp) and isinstance(
            node.op, (ast.Add, ast.Sub, ast.Mult, ast.Div, ast.Pow, ast.Mod)
        ):
            a, b = calc(node.left), calc(node.right)
            if isinstance(a, TextValue) or isinstance(b, TextValue):
                if (
                    isinstance(node.op, ast.Add)
                    and isinstance(a, TextValue)
                    and isinstance(b, TextValue)
                ):
                    if len(a.value) + len(b.value) > MAX_TEXT_LENGTH:
                        raise ExpressionError('Text result exceeds 65536 characters')
                    return TextValue(a.value + b.value)
                raise ExpressionError('Cannot mix text and numeric values')
            if isinstance(node.op, ast.Pow):
                return power(a, b)
            if isinstance(node.op, ast.Mod):
                if a.dimension != b.dimension:
                    raise ExpressionError('Incompatible dimensions')
                if b.value == 0:
                    raise ExpressionError('Division by zero')
                return Quantity(math.fmod(a.value, b.value), a.dimension)
            if isinstance(node.op, (ast.Add, ast.Sub)):
                if a.dimension != b.dimension:
                    raise ExpressionError('Incompatible dimensions')
                return Quantity(
                    a.value + b.value if isinstance(node.op, ast.Add) else a.value - b.value,
                    a.dimension,
                )
            sign = 1 if isinstance(node.op, ast.Mult) else -1
            dim = _dimension(
                x + sign * y for x, y in zip_longest(a.dimension, b.dimension, fillvalue=0)
            )
            if sign == -1 and b.value == 0:
                raise ExpressionError('Division by zero')
            return Quantity(a.value * b.value if sign == 1 else a.value / b.value, dim)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and not node.keywords:
            name = node.func.id
            if name == '__if__' and len(node.args) == 3:
                condition = logical(node.args[0])
                yes, no = calc(node.args[1]), calc(node.args[2])
                if yes.dimension != no.dimension:
                    raise ExpressionError('Conditional branches must have the same type')
                return yes if condition else no
            if (
                name == '__unit__'
                and len(node.args) == 2
                and isinstance(node.args[1], ast.Constant)
            ):
                unit = node.args[1].value
                if unit not in UNITS:
                    raise LocalEvaluationUnsupported(
                        'Unit requires native Fusion evaluation: ' + str(unit)
                    )
                q = calc(node.args[0])
                if q.dimension != SCALAR:
                    raise ExpressionError('Unit requires a dimensionless number')
                factor, dim = UNITS[unit]
                return Quantity(q.value * factor + UNIT_OFFSETS.get(unit, 0), dim)
            if name not in _FUNCTIONS:
                raise ExpressionError('Unknown function: ' + name)
            args = [calc(arg) for arg in node.args]
            if any(isinstance(arg, TextValue) for arg in args):
                raise ExpressionError('Numeric functions cannot use text')
            if len(args) != FUNCTIONS.get(name, {}).get('arity'):
                raise ExpressionError('Invalid function arguments')
            if name == 'random':
                if native_function:
                    return native_function(name, args, SCALAR)
                raise LocalEvaluationUnsupported(
                    'Native Fusion evaluation is required for random()'
                )
            q = args[0]
            if name == 'pow':
                return power(q, args[1])
            if name in {'min', 'max'}:
                if any(a.dimension != q.dimension for a in args):
                    raise ExpressionError('Incompatible dimensions')
                return Quantity((min if name == 'min' else max)(a.value for a in args), q.dimension)
            if name == 'sqrt':
                if q.value < 0:
                    raise ExpressionError('Invalid sqrt dimension or value')
                return Quantity(math.sqrt(q.value), _dimension(d / 2 for d in q.dimension))
            if name in {'sin', 'cos', 'tan', 'sinh', 'cosh', 'tanh'}:
                if q.dimension == SCALAR:
                    if native_function:
                        return native_function(name, args, SCALAR)
                    raise LocalEvaluationUnsupported(
                        'Bare trigonometric arguments require Fusion angle preferences'
                    )
                if q.dimension != ANGLE:
                    raise ExpressionError('Trigonometric functions require an angle')
                return Quantity(getattr(math, name)(q.value))
            if name == 'abs':
                return Quantity(abs(q.value), q.dimension)
            if q.dimension != SCALAR:
                raise ExpressionError('Function requires a dimensionless value')
            if name in {'asin', 'acos', 'atan', 'asinh', 'acosh', 'atanh'}:
                return Quantity(getattr(math, name)(q.value), ANGLE)
            if name == 'round':
                return Quantity(math.copysign(math.floor(abs(q.value) + 0.5), q.value))
            if name == 'sign':
                return Quantity(float(q.value > 0))
            method = {'ln': 'log', 'log': 'log10'}.get(name, name)
            return Quantity(getattr(math, method)(q.value))
        raise ExpressionError('Unsupported expression')

    try:
        result = calc(tree.body)
    except (OverflowError, ValueError, ZeroDivisionError, RecursionError) as exc:
        if isinstance(exc, ExpressionError):
            raise
        raise ExpressionError('Invalid numerical result') from exc
    if not isinstance(result, TextValue) and not math.isfinite(result.value):
        raise ExpressionError('Result must be finite')
    if isinstance(result, TextValue) and len(result.value) > MAX_TEXT_LENGTH:
        raise ExpressionError('Text result exceeds 65536 characters')
    return replace(result, stochastic=stochastic_expression(expression, parameters))


def _increment_unit(
    expression: str,
    raw: Mapping[str, str],
    existing: Mapping[str, Quantity],
    default_unit: str,
    native_function=None,
) -> str:
    """Infer the unit of a previously declared parameter for a bare increment."""
    values = {name: value for name, value in existing.items() if name not in raw}
    active: set[str] = set()

    def resolve(name: str) -> None:
        if name in values:
            return
        if name in active:
            raise ExpressionError('Cyclic parameter dependency')
        if name not in raw:
            raise ExpressionError('Use an explicit unit for this relative update')
        active.add(name)
        for dep in _dependencies(_tree(raw[name])):
            resolve(dep)
        values[name] = evaluate(raw[name], values, native_function)
        active.remove(name)

    for dependency in _dependencies(_tree(expression)):
        resolve(dependency)
    dimension = evaluate(expression, values, native_function).dimension
    if dimension == SCALAR:
        return ''
    if dimension == LENGTH:
        return default_unit
    if dimension == ANGLE:
        return 'deg'
    return dimension_unit(dimension, default_unit)


def _fold_assignments(
    text: str,
    existing: Mapping[str, Quantity],
    original_exprs: Mapping[str, str],
    units: Mapping[str, str],
    default_unit: str,
    native_function=None,
) -> dict[str, str]:
    """Fold sequential updates into one expression per parameter, without self references."""
    entries = [_assignment(item) for item in split_definitions(text)]
    if not entries:
        raise ExpressionError('No parameter definitions')
    known = set(existing) | {name for name, _, _ in entries}

    def numeric_literal(name: str, expression: str) -> str:
        if not _NUMERIC.fullmatch(expression):
            return expression
        if name in existing and isinstance(existing[name], TextValue):
            raise ExpressionError('Cannot change existing parameter type or dimension: ' + name)
        # A scalar's empty display unit is meaningful, not a missing length unit.
        unit = (
            (
                'n'
                if existing[name].dimension == SCALAR
                else units.get(name) or dimension_unit(existing[name].dimension, default_unit)
            )
            if name in existing
            else default_unit
        )
        return expression + ' ' + unit

    initial: dict[str, str] = {}
    for name, operator, expression in entries:
        if name not in initial and not operator:
            expression = normalize_expression(expression, known)
            initial[name] = numeric_literal(name, expression)
    raw: dict[str, str] = {}
    for name, operator, expression in entries:
        if name in _FUNCTIONS or name in CONSTANT_NAMES or name in {'__unit__', 'this'}:
            raise ExpressionError('Duplicate or reserved parameter: ' + name)
        expression = normalize_expression(expression, known)
        dependencies = _dependencies(_tree(expression))
        relative = bool(operator or name in dependencies or 'this' in dependencies)
        if name in raw and not relative:
            raise ExpressionError('Duplicate or reserved parameter: ' + name)
        if relative:
            previous = raw.get(name, original_exprs.get(name))
            if previous is None:
                raise ExpressionError('Relative updates require an existing parameter: ' + name)
            replacement = '(' + previous + ')'
            pattern = r'(?<![\w.])(?:this|' + re.escape(name) + r')(?![\w.])'
            expression = map_code(
                expression, lambda code: re.sub(pattern, lambda _match: replacement, code)
            )
            if operator:
                if operator in '+-' and _NUMERIC.fullmatch(expression):
                    unit = units.get(name)
                    if unit is None:
                        unit = _increment_unit(
                            previous, {**initial, **raw}, existing, default_unit, native_function
                        )
                    if unit:
                        expression += ' ' + unit
                expression = replacement + operator + '(' + expression + ')'
        elif _NUMERIC.fullmatch(expression):
            expression = numeric_literal(name, expression)
        if len(expression) > 10000:
            raise ExpressionError('Expanded expression is too long')
        raw[name] = expression
    return raw


def plan_batch(
    text: str, existing: Mapping[str, Quantity], default_unit: str, native_function=None
) -> list[Operation]:
    """Validate the complete batch before returning dependency-ordered operations."""
    if default_unit not in UNITS or UNITS[default_unit][1] != LENGTH:
        raise ExpressionError('Unsupported project length unit')
    raw = _fold_assignments(text, existing, {}, {}, default_unit, native_function)
    trees = {name: _tree(expr) for name, expr in raw.items()}
    deps = {name: _dependencies(tree) for name, tree in trees.items()}
    ordered: list[str] = []
    visiting: set[str] = set()
    done: set[str] = set()

    def visit(name: str) -> None:
        if name in visiting:
            raise ExpressionError('Cyclic parameter dependency')
        if name in done:
            return
        visiting.add(name)
        for dep in sorted(deps[name]):
            if dep in raw:
                visit(dep)
            elif dep not in existing:
                raise ExpressionError('Unknown parameter: ' + dep)
        visiting.remove(name)
        done.add(name)
        ordered.append(name)

    for name in raw:
        visit(name)
    values = dict(existing)
    operations = []
    text_size = 0
    for name in ordered:
        expr = raw[name]
        if _NUMERIC.fullmatch(expr):
            expr += ' ' + default_unit
        value = evaluate(expr, values, native_function)
        if isinstance(value, TextValue):
            text_size += len(value.value)
            if text_size > MAX_BATCH_TEXT_LENGTH:
                raise ExpressionError('Combined text results exceed 262144 characters')
        if name in existing and existing[name].dimension != value.dimension:
            raise ExpressionError('Cannot change existing parameter type or dimension: ' + name)
        fusion_expr = map_code(expr, lambda code: re.sub(r'(?<=\d)\s*n\b', '', code))
        unit = (
            default_unit
            if value.dimension == LENGTH
            else (
                'deg'
                if value.dimension == ANGLE
                else (
                    'Text'
                    if value.dimension == TEXT
                    else dimension_unit(value.dimension, default_unit)
                )
            )
        )
        if name not in existing:
            unit = _literal_unit(expr, value.dimension, unit)
        operations.append(
            Operation(
                name,
                fusion_expr,
                value,
                unit,
                'Update' if name in existing else 'New',
                existing.get(name),
            )
        )
        values[name] = value
    return operations


def validate_final_graph(
    operations: list[Operation], existing_graph: Mapping[str, set[str]]
) -> None:
    """Reject hidden cycles and stale previews using a complete parameter graph.

    Graph includes all user/model parameters, with edges to dependencies. A
    caller that cannot enumerate the complete graph must not call this as a
    substitute for verification. Run it before preview or apply, against a
    fresh snapshot, and revalidate the snapshot before any modification.
    """
    graph = {name: set(deps) for name, deps in existing_graph.items()}
    changed = {op.name for op in operations}
    for op in operations:
        graph[op.name] = _dependencies(_tree(op.expression))
    if any(not deps <= graph.keys() for deps in graph.values()):
        raise ExpressionError('Incomplete parameter dependency graph')
    done: set[str] = set()
    active: set[str] = set()

    def visit(name: str) -> None:
        if name in active:
            raise ExpressionError('Cyclic parameter dependency')
        if name in done:
            return
        active.add(name)
        for dep in graph[name]:
            visit(dep)
        active.remove(name)
        done.add(name)

    for name in graph:
        visit(name)

    def affected(name: str, seen: set[str]) -> bool:
        if name in seen:
            return False
        seen.add(name)
        return any(dep in changed or affected(dep, seen) for dep in graph[name])

    for operation in operations:
        for dep in graph[operation.name] - changed:
            if affected(dep, set()):
                raise ExpressionError('Preview is stale through existing parameter: ' + dep)


def dependency_closure(graph: Mapping[str, set[str]]) -> dict[str, set[str]]:
    """Return proven reachability; unknown nodes and cycles fail closed."""
    validate_final_graph([], graph)
    closure: dict[str, set[str]] = {}

    def ancestors(name: str) -> set[str]:
        if name not in closure:
            result = set(graph[name])
            for dependency in graph[name]:
                result.update(ancestors(dependency))
            closure[name] = result
        return closure[name]

    for name in graph:
        ancestors(name)
    return closure


@dataclass(frozen=True)
class ParameterSnapshot:
    """One typed Fusion parameter from a single coherent document snapshot.

    Dependencies must come from Fusion's parameter API, not from this parser.
    API lists may include transitive ancestors as well as direct references.
    Values use mm/rad, regardless of the parameter's displayed unit.
    """

    expression: str
    unit: str
    quantity: Quantity | TextValue
    dependencies: set[str]


def plan_batch_snapshot(
    text: str, snapshot: Mapping[str, ParameterSnapshot], default_unit: str, native_function=None
) -> list[Operation]:
    """Conservatively project a batch through a complete dependency snapshot.

    This pure approximation does not replace Fusion validation. A caller must
    supply *all* relevant parameters and compare document revision before
    committing. Unsupported Fusion syntax, units, or graph semantics fail closed.
    """
    if default_unit not in UNITS or UNITS[default_unit][1] != LENGTH:
        raise ExpressionError('Unsupported project length unit')
    validate_final_graph([], {name: set(item.dependencies) for name, item in snapshot.items()})
    needed = {name for name, item in snapshot.items() if not isinstance(item.quantity, TextValue)}
    definitions = [_assignment(item) for item in split_definitions(text)]
    known = set(snapshot) | {name for name, _, _ in definitions}
    dependents: dict[str, set[str]] = {}
    for name, item in snapshot.items():
        for dependency in item.dependencies:
            dependents.setdefault(dependency, set()).add(name)
    # Existing text descendants can expand after either a text or numeric edit.
    # Keep only descendants of actual writes, so unrelated unsupported text
    # expressions do not block otherwise independent numeric updates.
    affected = {name for name, _, _ in definitions}
    pending = list(affected)
    while pending:
        for dependent in dependents.get(pending.pop(), set()) - affected:
            affected.add(dependent)
            pending.append(dependent)
    needed.update(affected)
    for name, _, expression in definitions:
        needed.add(name)
        needed.update(_dependencies(_tree(normalize_expression(expression, known))))
    pending = list(needed)
    while pending:
        item = snapshot.get(pending.pop())
        if item:
            for dependency in item.dependencies - needed:
                needed.add(dependency)
                pending.append(dependency)
    snapshot = {name: item for name, item in snapshot.items() if name in needed}
    original_values = {name: item.quantity for name, item in snapshot.items()}
    original_exprs: dict[str, str] = {}
    original_graph: dict[str, set[str]] = {}
    for name, item in snapshot.items():
        if isinstance(item.quantity, TextValue):
            if item.unit != 'Text':
                raise ExpressionError('Invalid text snapshot unit: ' + name)
        elif item.unit:
            if unit_definition(item.unit)[1] != item.quantity.dimension:
                raise ExpressionError('Unsupported snapshot unit: ' + name)
        elif item.quantity.dimension != SCALAR:
            raise ExpressionError('Missing snapshot unit: ' + name)
        expr = normalize_literals(item.expression.strip())
        if _NUMERIC.fullmatch(expr) and item.unit:
            expr += ' ' + item.unit
        original_exprs[name] = expr
        parsed = _dependencies(_tree(expr))
        if not parsed <= item.dependencies:
            raise ExpressionError('Mismatched snapshot dependencies: ' + name)
        if not parsed <= snapshot.keys():
            raise ExpressionError('Incomplete snapshot dependencies: ' + name)
        original_graph[name] = parsed
    closure = dependency_closure(original_graph)
    for name, item in snapshot.items():
        # Every explicit reference must be reported. Additional API entries are
        # accepted only when the parsed expressions independently prove the path.
        if not original_graph[name] <= item.dependencies <= closure[name]:
            raise ExpressionError('Mismatched snapshot dependencies: ' + name)
    for name, expr in original_exprs.items():
        actual = evaluate(expr, original_values, native_function)
        expected = snapshot[name].quantity
        same_value = (
            actual.value == expected.value
            if isinstance(actual, TextValue)
            else not isinstance(expected, TextValue)
            and math.isclose(actual.value, expected.value, rel_tol=1e-10, abs_tol=1e-10)
        )
        if actual.dimension != expected.dimension or (
            not same_value and not actual.stochastic and not expected.stochastic
        ):
            raise ExpressionError('Inconsistent snapshot value: ' + name)
    raw = _fold_assignments(
        text,
        original_values,
        original_exprs,
        {name: item.unit for name, item in snapshot.items()},
        default_unit,
        native_function,
    )
    graph = dict(original_graph)
    graph.update({name: _dependencies(_tree(expr)) for name, expr in raw.items()})
    if any(not deps <= graph.keys() for deps in graph.values()):
        raise ExpressionError('Incomplete parameter dependency graph')
    visiting: set[str] = set()
    done: set[str] = set()
    ordered: list[str] = []

    def visit(name: str) -> None:
        if name in visiting:
            raise ExpressionError('Cyclic parameter dependency')
        if name in done:
            return
        visiting.add(name)
        for dep in sorted(graph[name]):
            visit(dep)
        visiting.remove(name)
        done.add(name)
        ordered.append(name)

    for name in graph:
        visit(name)
    values: dict[str, Quantity] = {}
    operations: list[Operation] = []
    text_size = 0
    for name in ordered:
        if name in raw:
            expr = raw[name]
            value = evaluate(expr, values, native_function)
            if name in snapshot and snapshot[name].quantity.dimension != value.dimension:
                raise ExpressionError('Cannot change existing parameter type or dimension: ' + name)
            unit = (
                default_unit
                if value.dimension == LENGTH
                else (
                    'deg'
                    if value.dimension == ANGLE
                    else (
                        'Text'
                        if value.dimension == TEXT
                        else dimension_unit(value.dimension, default_unit)
                    )
                )
            )
            if name not in snapshot:
                unit = _literal_unit(expr, value.dimension, unit)
            fusion_expr = map_code(expr, lambda code: re.sub(r'(?<=\d)\s*n\b', '', code))
            operations.append(
                Operation(
                    name,
                    fusion_expr,
                    value,
                    unit,
                    'Update' if name in snapshot else 'New',
                    snapshot[name].quantity if name in snapshot else None,
                )
            )
        else:
            value = evaluate(original_exprs[name], values, native_function)
            if value.dimension != snapshot[name].quantity.dimension:
                raise ExpressionError('Dependent parameter dimension changed: ' + name)
        values[name] = value
        if isinstance(value, TextValue):
            text_size += len(value.value)
            if text_size > MAX_BATCH_TEXT_LENGTH:
                raise ExpressionError('Combined text results exceed 262144 characters')
    return operations
