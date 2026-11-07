"""Conservative expression planner. Values use millimetres and radians internally.

Only explicit supported units and a restricted arithmetic grammar are accepted.
Fusion must validate planned expressions again before any model modification.
"""

from __future__ import annotations

import ast
import math
import re
from dataclasses import dataclass
from typing import Mapping, Tuple

Dimension = Tuple[int, int]  # powers of length and angle
SCALAR = (0, 0)
LENGTH = (1, 0)
ANGLE = (0, 1)
UNITS = {
    'mm': (1.0, LENGTH),
    'cm': (10.0, LENGTH),
    'm': (1000.0, LENGTH),
    'in': (25.4, LENGTH),
    'ft': (304.8, LENGTH),
    'deg': (math.pi / 180, ANGLE),
    'rad': (1.0, ANGLE),
    'n': (1.0, SCALAR),
}
_LITERAL = re.compile(
    r'(?<![\w.])((?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*(mm|cm|deg|rad|in|ft|m|n)\b'
)
_NAME = re.compile(r'^[A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё_0-9]*$')
_NUMERIC = re.compile(r'^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$')
_NUMERIC_WITH_UNIT = re.compile(
    r'^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?\s*(mm|cm|deg|rad|in|ft|m|n)$'
)


def _literal_unit(expression, dimension, fallback):
    match = _NUMERIC_WITH_UNIT.fullmatch(expression.strip())
    if match and UNITS[match.group(1)][1] == dimension:
        return '' if match.group(1) == 'n' else match.group(1)
    return fallback


_FUNCTIONS = {'sqrt', 'sin', 'cos', 'tan', 'abs', 'floor', 'ceil', 'round', 'min', 'max'}
_DOTTED = re.compile(
    r'(?<![\w.])[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё0-9]*(?:\.[A-Za-zА-Яа-яЁё0-9]+)+(?![\w.])'
)


class ExpressionError(ValueError):
    """An expression cannot be evaluated safely."""


def _assignment(item: str) -> tuple[str, str, str]:
    parts = item.split('=')
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

    return _DOTTED.sub(replace, expression)


@dataclass(frozen=True)
class Quantity:
    value: float
    dimension: Dimension = SCALAR


@dataclass(frozen=True)
class Operation:
    name: str
    expression: str
    quantity: Quantity
    unit: str
    status: str
    previous: Quantity | None = None


def _tree(expression: str) -> ast.Expression:
    if re.search(r'\b__unit__\b', expression):
        raise ExpressionError('Reserved internal identifier')
    source = _LITERAL.sub(lambda m: '__unit__(' + m.group(1) + ',"' + m.group(2) + '")', expression)
    try:
        return ast.parse(source, mode='eval')
    except (SyntaxError, ValueError) as exc:
        raise ExpressionError('Invalid expression syntax') from exc


def _dependencies(tree: ast.Expression) -> set[str]:
    names = {n.id for n in ast.walk(tree) if isinstance(n, ast.Name)}
    return names - _FUNCTIONS - {'__unit__'}


def evaluate(expression: str, parameters: Mapping[str, Quantity]) -> Quantity:
    """Evaluate supported operations, rejecting unknown units/functions and dimensions."""
    tree = _tree(normalize_expression(expression, parameters))

    def calc(node: ast.AST) -> Quantity:
        if isinstance(node, ast.Constant) and type(node.value) in (int, float):
            return Quantity(float(node.value))
        if isinstance(node, ast.Name):
            if node.id not in parameters:
                raise ExpressionError('Unknown parameter: ' + node.id)
            return parameters[node.id]
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
            q = calc(node.operand)
            return Quantity(q.value if isinstance(node.op, ast.UAdd) else -q.value, q.dimension)
        if isinstance(node, ast.BinOp) and isinstance(
            node.op, (ast.Add, ast.Sub, ast.Mult, ast.Div)
        ):
            a, b = calc(node.left), calc(node.right)
            if isinstance(node.op, (ast.Add, ast.Sub)):
                if a.dimension != b.dimension:
                    raise ExpressionError('Incompatible dimensions')
                return Quantity(
                    a.value + b.value if isinstance(node.op, ast.Add) else a.value - b.value,
                    a.dimension,
                )
            sign = 1 if isinstance(node.op, ast.Mult) else -1
            dim = tuple(x + sign * y for x, y in zip(a.dimension, b.dimension))
            if sign == -1 and b.value == 0:
                raise ExpressionError('Division by zero')
            return Quantity(a.value * b.value if sign == 1 else a.value / b.value, dim)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and not node.keywords:
            name = node.func.id
            if (
                name == '__unit__'
                and len(node.args) == 2
                and isinstance(node.args[1], ast.Constant)
            ):
                unit = node.args[1].value
                if unit not in UNITS:
                    raise ExpressionError('Unsupported unit')
                q = calc(node.args[0])
                if q.dimension != SCALAR:
                    raise ExpressionError('Unit requires a dimensionless number')
                factor, dim = UNITS[unit]
                return Quantity(q.value * factor, dim)
            if name not in _FUNCTIONS:
                raise ExpressionError('Unsupported function: ' + name)
            args = [calc(arg) for arg in node.args]
            if not args or (name not in {'min', 'max'} and len(args) != 1):
                raise ExpressionError('Invalid function arguments')
            q = args[0]
            if name in {'min', 'max'}:
                if any(a.dimension != q.dimension for a in args):
                    raise ExpressionError('Incompatible dimensions')
                return Quantity((min if name == 'min' else max)(a.value for a in args), q.dimension)
            if name == 'sqrt':
                if any(d % 2 for d in q.dimension) or q.value < 0:
                    raise ExpressionError('Invalid sqrt dimension or value')
                return Quantity(math.sqrt(q.value), tuple(d // 2 for d in q.dimension))
            if name in {'sin', 'cos', 'tan'}:
                if q.dimension != ANGLE:
                    raise ExpressionError('Trigonometric functions require an angle')
                return Quantity(getattr(math, name)(q.value))
            if name in {'floor', 'ceil', 'round'} and q.dimension != SCALAR:
                raise ExpressionError('Function requires a dimensionless value')
            return Quantity(
                getattr(math, name)(q.value)
                if name in {'floor', 'ceil'}
                else (round(q.value) if name == 'round' else abs(q.value)),
                q.dimension,
            )
        raise ExpressionError('Unsupported expression')

    try:
        result = calc(tree.body)
    except (OverflowError, ValueError) as exc:
        if isinstance(exc, ExpressionError):
            raise
        raise ExpressionError('Invalid numerical result') from exc
    if not math.isfinite(result.value):
        raise ExpressionError('Result must be finite')
    return result


def _increment_unit(
    expression: str, raw: Mapping[str, str], existing: Mapping[str, Quantity], default_unit: str
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
        values[name] = evaluate(raw[name], values)
        active.remove(name)

    for dependency in _dependencies(_tree(expression)):
        resolve(dependency)
    dimension = evaluate(expression, values).dimension
    if dimension == SCALAR:
        return ''
    if dimension == LENGTH:
        return default_unit
    if dimension == ANGLE:
        return 'deg'
    raise ExpressionError('Unsupported resulting dimension')


def _fold_assignments(
    text: str,
    existing: Mapping[str, Quantity],
    original_exprs: Mapping[str, str],
    units: Mapping[str, str],
    default_unit: str,
) -> dict[str, str]:
    """Fold sequential updates into one expression per parameter, without self references."""
    entries = [_assignment(item) for item in re.split(r'[;\n]+', text) if item.strip()]
    if not entries:
        raise ExpressionError('No parameter definitions')
    known = set(existing) | {name for name, _, _ in entries}
    initial: dict[str, str] = {}
    for name, operator, expression in entries:
        if name not in initial and not operator:
            expression = normalize_expression(expression, known)
            initial[name] = (
                expression + ' ' + default_unit if _NUMERIC.fullmatch(expression) else expression
            )
    raw: dict[str, str] = {}
    for name, operator, expression in entries:
        if name in _FUNCTIONS or name in {'__unit__', 'this'}:
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
            expression = re.sub(pattern, lambda _match: replacement, expression)
            if operator:
                if operator in '+-' and _NUMERIC.fullmatch(expression):
                    unit = units.get(name)
                    if unit is None:
                        unit = _increment_unit(previous, {**initial, **raw}, existing, default_unit)
                    if unit:
                        expression += ' ' + unit
                expression = replacement + operator + '(' + expression + ')'
        elif _NUMERIC.fullmatch(expression):
            expression += ' ' + default_unit
        if len(expression) > 10000:
            raise ExpressionError('Expanded expression is too long')
        raw[name] = expression
    return raw


def plan_batch(text: str, existing: Mapping[str, Quantity], default_unit: str) -> list[Operation]:
    """Validate the complete batch before returning dependency-ordered operations."""
    if default_unit not in UNITS or UNITS[default_unit][1] != LENGTH:
        raise ExpressionError('Unsupported project length unit')
    raw = _fold_assignments(text, existing, {}, {}, default_unit)
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
    for name in ordered:
        expr = raw[name]
        if _NUMERIC.fullmatch(expr):
            expr += ' ' + default_unit
        value = evaluate(expr, values)
        if value.dimension not in (SCALAR, LENGTH, ANGLE):
            raise ExpressionError('Unsupported resulting dimension')
        if name in existing and existing[name].dimension != value.dimension:
            raise ExpressionError('Cannot change existing parameter dimension: ' + name)
        fusion_expr = re.sub(r'(?<=\d)\s*n\b', '', expr)
        unit = (
            default_unit
            if value.dimension == LENGTH
            else ('deg' if value.dimension == ANGLE else '')
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


@dataclass(frozen=True)
class ParameterSnapshot:
    """One numeric Fusion parameter from a single coherent document snapshot.

    Dependencies must come from Fusion's parameter API, not from this parser.
    Values use mm/rad, regardless of the parameter's displayed unit.
    """

    expression: str
    unit: str
    quantity: Quantity
    dependencies: set[str]


def plan_batch_snapshot(
    text: str, snapshot: Mapping[str, ParameterSnapshot], default_unit: str
) -> list[Operation]:
    """Conservatively project a batch through a complete dependency snapshot.

    This pure approximation does not replace Fusion validation. A caller must
    supply *all* relevant parameters and compare document revision before
    committing. Unsupported Fusion syntax, units, or graph semantics fail closed.
    """
    if default_unit not in UNITS or UNITS[default_unit][1] != LENGTH:
        raise ExpressionError('Unsupported project length unit')
    original_values = {name: item.quantity for name, item in snapshot.items()}
    original_exprs: dict[str, str] = {}
    original_graph: dict[str, set[str]] = {}
    for name, item in snapshot.items():
        if item.quantity.dimension not in (SCALAR, LENGTH, ANGLE):
            raise ExpressionError('Unsupported snapshot dimension: ' + name)
        if item.unit:
            if item.unit not in UNITS or UNITS[item.unit][1] != item.quantity.dimension:
                raise ExpressionError('Unsupported snapshot unit: ' + name)
        elif item.quantity.dimension != SCALAR:
            raise ExpressionError('Missing snapshot unit: ' + name)
        expr = item.expression.strip()
        if _NUMERIC.fullmatch(expr) and item.unit:
            expr += ' ' + item.unit
        original_exprs[name] = expr
        parsed = _dependencies(_tree(expr))
        if parsed != set(item.dependencies):
            raise ExpressionError('Mismatched snapshot dependencies: ' + name)
        if not parsed <= snapshot.keys():
            raise ExpressionError('Incomplete snapshot dependencies: ' + name)
        original_graph[name] = parsed
    for name, expr in original_exprs.items():
        actual = evaluate(expr, original_values)
        expected = snapshot[name].quantity
        if actual.dimension != expected.dimension or not math.isclose(
            actual.value, expected.value, rel_tol=1e-10, abs_tol=1e-10
        ):
            raise ExpressionError('Inconsistent snapshot value: ' + name)
    raw = _fold_assignments(
        text,
        original_values,
        original_exprs,
        {name: item.unit for name, item in snapshot.items()},
        default_unit,
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
    for name in ordered:
        if name in raw:
            expr = raw[name]
            value = evaluate(expr, values)
            if value.dimension not in (SCALAR, LENGTH, ANGLE):
                raise ExpressionError('Unsupported resulting dimension')
            if name in snapshot and snapshot[name].quantity.dimension != value.dimension:
                raise ExpressionError('Cannot change existing parameter dimension: ' + name)
            unit = (
                default_unit
                if value.dimension == LENGTH
                else ('deg' if value.dimension == ANGLE else '')
            )
            if name not in snapshot:
                unit = _literal_unit(expr, value.dimension, unit)
            fusion_expr = re.sub(r'(?<=\d)\s*n\b', '', expr)
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
            value = evaluate(original_exprs[name], values)
            if value.dimension != snapshot[name].quantity.dimension:
                raise ExpressionError('Dependent parameter dimension changed: ' + name)
        values[name] = value
    return operations
