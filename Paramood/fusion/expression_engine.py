"""Native numeric evaluation with symbolic unit inference and no model mutations.

Fusion evaluates the original formula. The AST only supplies a result-unit hint
and safely substitutes values of parameters that have not been created yet.
"""

import ast
import math
import re
from itertools import zip_longest

from ..core.expressions import (
    ANGLE,
    SCALAR,
    TEXT,
    Quantity,
    TextValue,
    ExpressionError,
    _dimension,
    _tree,
    dimension_unit,
    unit_definition,
    stochastic_expression,
    evaluate as offline_evaluate,
)
from ..core.text import map_code, text_literal


class NativeExpressionEngine:
    def __init__(self, manager, baseline=None):
        self.manager = manager
        self.baseline = baseline or {}

    def __call__(self, name, arguments, dimension):
        source = name + '(' + ';'.join(self.literal(arg) for arg in arguments) + ')'
        return self.numeric(source, dimension)

    @staticmethod
    def literal(quantity):
        if isinstance(quantity, TextValue):
            return text_literal(quantity.value)
        unit = dimension_unit(quantity.dimension)
        return '(' + format(quantity.value, '.17g') + (' ' + unit if unit else '') + ')'

    def numeric(self, source, dimension):
        unit = dimension_unit(dimension)
        if not self.manager.isValidExpression(source, unit):
            raise ExpressionError('Fusion cannot validate this expression.')
        value = self.manager.evaluateExpression(source, unit)
        # Fusion's internal length is cm; the planner retains mm, including derived units.
        value *= 10.0 ** dimension[0]
        if not math.isfinite(value):
            raise ExpressionError('Fusion returned a non-finite result')
        return Quantity(value, dimension)

    def evaluate(self, expression, parameters):
        tree = _tree(expression)
        stochastic = stochastic_expression(expression, parameters)

        def render(node):
            if isinstance(node, ast.Constant):
                return text_literal(node.value) if isinstance(node.value, str) else repr(node.value)
            if isinstance(node, ast.Name):
                return (
                    self.literal(parameters[node.id])
                    if node.id in parameters and parameters[node.id] != self.baseline.get(node.id)
                    else node.id
                )
            if isinstance(node, ast.UnaryOp):
                op = {ast.USub: '-', ast.UAdd: '+', ast.Not: 'not '}.get(type(node.op))
                if op is not None:
                    return '(' + op + render(node.operand) + ')'
            if isinstance(node, ast.BinOp):
                op = {
                    ast.Add: '+',
                    ast.Sub: '-',
                    ast.Mult: '*',
                    ast.Div: '/',
                    ast.Pow: '^',
                    ast.Mod: '%',
                }.get(type(node.op))
                if op:
                    return '(' + render(node.left) + op + render(node.right) + ')'
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and not node.keywords:
                if node.func.id == '__unit__':
                    return '(' + render(node.args[0]) + ' ' + node.args[1].value + ')'
                name = 'if' if node.func.id == '__if__' else node.func.id
                return name + '(' + ';'.join(render(a) for a in node.args) + ')'
            if isinstance(node, ast.Compare) and len(node.ops) == 1:
                op = {
                    ast.Lt: '<',
                    ast.LtE: '<=',
                    ast.Gt: '>',
                    ast.GtE: '>=',
                    ast.Eq: '==',
                    ast.NotEq: '<>',
                }.get(type(node.ops[0]))
                if op:
                    return '(' + render(node.left) + op + render(node.comparators[0]) + ')'
            if isinstance(node, ast.BoolOp):
                op = ' and ' if isinstance(node.op, ast.And) else ' or '
                return '(' + op.join(render(a) for a in node.values) + ')'
            raise ExpressionError('Invalid expression syntax')

        def dimension(node):
            if isinstance(node, ast.Constant):
                return TEXT if isinstance(node.value, str) else SCALAR
            if isinstance(node, ast.Name):
                if node.id in parameters:
                    return parameters[node.id].dimension
                if node.id in {'PI', 'E'}:
                    return SCALAR
                if node.id == 'Gravity':
                    return (1, 0, -2)
                if node.id == 'SpeedOfLight':
                    return (1, 0, -1)
                return unit_definition(self.manager.formatUnits(node.id))[1]
            if isinstance(node, ast.UnaryOp):
                return dimension(node.operand)
            if isinstance(node, ast.BinOp):
                a, b = dimension(node.left), dimension(node.right)
                if TEXT in (a, b):
                    return TEXT
                if isinstance(node.op, (ast.Add, ast.Sub, ast.Mod)):
                    return b if a == SCALAR else a
                if isinstance(node.op, ast.Pow):
                    exponent = self.numeric(render(node.right), SCALAR).value
                    return _dimension(d * exponent for d in a)
                sign = -1 if isinstance(node.op, ast.Div) else 1
                return _dimension(x + sign * y for x, y in zip_longest(a, b, fillvalue=0))
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
                name = node.func.id
                if name == '__unit__':
                    return unit_definition(node.args[1].value)[1]
                if name in {
                    'sin',
                    'cos',
                    'tan',
                    'sinh',
                    'cosh',
                    'tanh',
                    'sign',
                    'random',
                    'exp',
                    'ln',
                    'log',
                }:
                    return SCALAR
                if name in {'asin', 'acos', 'atan', 'asinh', 'acosh', 'atanh'}:
                    return ANGLE
                if name == '__if__' and len(node.args) == 3:
                    branches = []
                    for branch in node.args[1:]:
                        try:
                            branches.append(dimension(branch))
                        except (ExpressionError, RuntimeError):
                            # Fusion may never evaluate this branch. The complete
                            # native formula is still validated below before sampling.
                            continue
                    return next((d for d in branches if d != SCALAR), SCALAR)
                if name == 'pow' and len(node.args) == 2:
                    exponent = self.numeric(render(node.args[1]), SCALAR).value
                    return _dimension(d * exponent for d in dimension(node.args[0]))
                if name == 'sqrt' and len(node.args) == 1:
                    return _dimension(d / 2 for d in dimension(node.args[0]))
                if node.args:
                    dims = [dimension(a) for a in node.args]
                    return next((d for d in dims if d != SCALAR), SCALAR)
                return SCALAR
            return SCALAR

        inferred = dimension(tree.body)
        if inferred == TEXT:
            # Text references/concatenation are pure. Native numeric conditions are
            # resolved lazily so an unused invalid numeric branch does not veto text.
            def text_value(node):
                if isinstance(node, ast.Name) and node.id in parameters:
                    return parameters[node.id]
                if (
                    isinstance(node, ast.Call)
                    and isinstance(node.func, ast.Name)
                    and node.func.id == '__if__'
                ):
                    test = 'if(' + render(node.args[0]) + ';1;0)'
                    branch = node.args[1] if self.numeric(test, SCALAR).value else node.args[2]
                    return text_value(branch)
                if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
                    return TextValue(text_value(node.left).value + text_value(node.right).value)
                return offline_evaluate(render(node), {})

            value = text_value(tree.body)
            return TextValue(value.value, stochastic)

        # Preserve the original Fusion syntax and literal unit binding. Substitute
        # only references, never function names, units, constants, or quoted text.
        identifiers = re.compile(r'(?<![\w.])[A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё_0-9]*(?![\w.])')
        source = map_code(
            expression,
            lambda code: identifiers.sub(
                lambda m: (
                    self.literal(parameters[m.group()])
                    if m.group() in parameters
                    and parameters[m.group()] != self.baseline.get(m.group())
                    else m.group()
                ),
                code,
            ),
        )
        source = map_code(source, lambda code: re.sub(r'(?<=\d)\s*n\b', '', code))
        result = self.numeric(source, inferred)
        return Quantity(result.value, result.dimension, stochastic)
