import math

import pytest

from Paramood.core.builtins import CATALOG
from Paramood.core.expressions import (
    LENGTH,
    SCALAR,
    ExpressionError,
    ParameterSnapshot,
    Quantity,
    TextValue,
    dimension_unit,
    evaluate,
    mark_stochastic,
    plan_batch,
    plan_batch_snapshot,
    unit_definition,
)
from Paramood.bridge.formatting import display_quantity
from Paramood.fusion.expression_engine import NativeExpressionEngine


@pytest.mark.parametrize('unit', CATALOG['unitDefinitions'], ids=lambda u: u['name'])
def test_all_native_unit_metadata_and_compounds(unit):
    factor, dimension, offset = unit_definition(unit['name'])
    assert math.isfinite(factor) and factor > 0
    assert dimension == tuple(unit['dimension'])
    assert offset == unit['offset']
    quantity = evaluate('1 ' + unit['name'], {})
    assert quantity.dimension == dimension
    assert display_quantity(quantity, unit['name']) == pytest.approx(1)
    canonical = dimension_unit(dimension)
    assert unit_definition(canonical)[1] == dimension
    for alias in unit['aliases']:
        assert unit_definition(alias) == unit_definition(unit['name'])


@pytest.mark.parametrize(
    ('text', 'value', 'unit'),
    [
        ('area=10 mm*20 mm', 200, 'mm^2'),
        ('root=pow(8 mm^3;1/3)', 2, 'mm'),
        ('mass=5 kg', 5, 'kg'),
        ('force=2 N', 2, 'N'),
        ('pressure=3 Pa', 3, 'Pa'),
        ('velocity=SpeedOfLight', 299792458000, 'mm/s'),
        ('acceleration=Gravity', 9806.65, 'mm/s^2'),
    ],
)
def test_creation_and_snapshot_updates_accept_derived_dimensions(text, value, unit):
    op = plan_batch(text, {}, 'mm')[0]
    assert op.unit == unit
    assert display_quantity(op.quantity, unit) == pytest.approx(value)
    snapshot = {op.name: ParameterSnapshot(op.expression, op.unit, op.quantity, set())}
    result = plan_batch_snapshot(op.name + '=this*2', snapshot, 'mm')[0]
    assert display_quantity(result.quantity, unit) == pytest.approx(value * 2)


class NativeManager:
    """A strict callback fixture, not native Fusion acceptance."""

    def __init__(self, results):
        self.results = results
        self.log = []

    def isValidExpression(self, expression, unit):
        self.log.append(('validate', expression, unit))
        return (expression, unit) in self.results

    def evaluateExpression(self, expression, unit):
        self.log.append(('evaluate', expression, unit))
        return self.results[expression, unit]

    def formatUnits(self, unit):
        return unit


def test_native_engine_evaluates_original_formula_once_and_preserves_references():
    manager = NativeManager({('box_size+2 mm', 'mm'): 1.2})
    baseline = {'box_size': Quantity(10, LENGTH)}
    engine = NativeExpressionEngine(manager, baseline)
    result = evaluate('box.size+2 mm', baseline, engine)
    assert result == Quantity(12, LENGTH)
    assert manager.log == [('validate', 'box_size+2 mm', 'mm'), ('evaluate', 'box_size+2 mm', 'mm')]


def test_native_fusion_controls_implicit_units_and_lazy_numeric_branches():
    manager = NativeManager({('if(1<2;1 mm;2)', 'mm'): 0.1, ('if(1<2;2;1/0)', ''): 2})
    engine = NativeExpressionEngine(manager)
    assert evaluate('if(1<2;1 mm;2)', {}, engine) == Quantity(1, LENGTH)
    assert evaluate('if(1<2;2;1/0)', {}, engine) == Quantity(2)


def test_random_creation_update_and_dependencies_are_sampled_without_rejection():
    samples = iter([0.2, 0.7, 0.9, 0.4, 0.3, 0.1, 0.8, 0.6, 0.5, 0.2, 0.1, 0.3, 0.4, 0.7, 0.9, 0.2])

    class Sampler:
        def __call__(self, name, args, dimension):
            assert name == 'random'
            return Quantity(next(samples))

    native = Sampler()
    ops = plan_batch('roll=random();span=roll*10 mm', {}, 'mm', native)
    assert [op.quantity.stochastic for op in ops] == [True, True]
    assert ops[0].expression == 'random()' and ops[1].expression == 'roll*10 mm'
    snapshot = {
        'roll': ParameterSnapshot('random()', '', Quantity(0.8, SCALAR, True), set()),
        'span': ParameterSnapshot('roll*10 mm', 'mm', Quantity(8, LENGTH, True), {'roll'}),
    }
    updated = plan_batch_snapshot('roll=random()', snapshot, 'mm', native)
    assert updated[0].quantity.stochastic and updated[0].expression == 'random()'
    assert mark_stochastic(
        {'roll': 'random()', 'span': 'roll*10 mm', 'fixed': '2'},
        {'roll': set(), 'span': {'roll'}, 'fixed': set()},
    ) == {'roll', 'span'}


def test_unselected_random_branch_is_still_labeled_as_a_sample():
    result = evaluate('if(1<2;2;random())', {}, lambda *_: Quantity(0.5))
    assert result.value == 2 and result.stochastic


def test_native_engine_refuses_an_expression_only_when_native_validation_fails():
    engine = NativeExpressionEngine(NativeManager({}))
    with pytest.raises(ExpressionError, match='Fusion cannot validate'):
        evaluate('1 mm+1 kg', {}, engine)


def test_affine_temperature_comes_from_original_native_expression():
    manager = NativeManager({('-20 C', 'K'): 253.15})
    result = evaluate('-20 C', {}, NativeExpressionEngine(manager))
    assert display_quantity(result, 'C') == pytest.approx(-20)


@pytest.mark.parametrize(
    ('source', 'unit', 'value'),
    [('1"', 'in', 1), ("1'", 'ft', 1), ('2 µ', 'micron', 2), ('30 °', 'deg', 30)],
)
def test_native_unit_symbols_preserve_strings_and_batch_boundaries(source, unit, value):
    from Paramood.core.text import split_definitions, normalize_literals

    assert len(split_definitions('size=' + source + ';other=2')) == 2
    quantity = evaluate(source, {})
    assert display_quantity(quantity, unit) == pytest.approx(value)
    assert normalize_literals("'1\\\"' ") == "'1\"' "


def test_native_text_references_and_concatenation_preserve_values():
    parameters = {'caption': TextValue('Body')}
    engine = NativeExpressionEngine(NativeManager({}), parameters)
    assert evaluate('caption', parameters, engine) == TextValue('Body')
    assert evaluate("caption+' X'", parameters, engine) == TextValue('Body X')
