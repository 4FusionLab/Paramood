"""Solve a conservative scaled-variable equation for an inline edit."""

import ast
import math
import re

from .expressions import ANGLE, LENGTH, SCALAR, UNITS, ExpressionError, evaluate


def solve_inline_equation(equation, target, unit, parameters, existing_names=None):
    parts = equation.split('=')
    if len(parts) != 2 or not all(part.strip() for part in parts):
        raise ExpressionError('Enter one equation.')
    left, right = (part.strip() for part in parts)
    try:
        tree = ast.parse(left, mode='eval')
    except (SyntaxError, ValueError) as exc:
        raise ExpressionError('Invalid equation.') from exc
    names = {node.id for node in ast.walk(tree) if isinstance(node, ast.Name)}
    existing = set(existing_names if existing_names is not None else parameters)
    unknown = names - existing
    if len(unknown) != 1:
        raise ExpressionError('The equation must contain exactly one new parameter.')
    name = next(iter(unknown))
    if name.lower() in {item.lower() for item in existing} or name in UNITS or name == 'this':
        raise ExpressionError('Choose a new parameter name.')

    def coefficient(node):
        if isinstance(node, ast.Name):
            if node.id == name:
                return 1.0, 1
            value = parameters.get(node.id)
            if value is None or value.dimension != SCALAR:
                raise ExpressionError('Equation factors must be dimensionless.')
            return value.value, 0
        if isinstance(node, ast.Constant) and type(node.value) in (float, int):
            return float(node.value), 0
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
            value, count = coefficient(node.operand)
            return (-value if isinstance(node.op, ast.USub) else value), count
        if isinstance(node, ast.BinOp) and isinstance(node.op, (ast.Mult, ast.Div)):
            a, count_a = coefficient(node.left)
            b, count_b = coefficient(node.right)
            if count_a + count_b > 1 or (isinstance(node.op, ast.Div) and (count_b or b == 0)):
                raise ExpressionError('Only linear multiplication and division are supported.')
            return (a * b if isinstance(node.op, ast.Mult) else a / b), count_a + count_b
        raise ExpressionError('Use a single new parameter multiplied or divided by numbers.')

    factor, count = coefficient(tree.body)
    if count != 1 or not math.isfinite(factor) or factor == 0:
        raise ExpressionError('The equation has no unique solution.')
    if re.fullmatch(r'[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?', right):
        right += (' ' + unit) if unit else 'n'
    quantity = evaluate(right, parameters)
    dimension = UNITS[unit][1] if unit in UNITS else SCALAR if not unit else None
    if dimension is None or quantity.dimension != dimension:
        raise ExpressionError('The equation value has incompatible units.')
    value = quantity.value / factor
    if not math.isfinite(value):
        raise ExpressionError('The equation has no finite solution.')
    suffix = ' mm' if dimension == LENGTH else ' rad' if dimension == ANGLE else 'n'
    return f'{name}={repr(value)}{suffix};{target}={left}'
