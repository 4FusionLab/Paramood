import math

import pytest

from Paramood.core.builtins import CATALOG, FUNCTIONS
from Paramood.core.expressions import (
    ANGLE,
    LENGTH,
    SCALAR,
    ExpressionError,
    LocalEvaluationUnsupported,
    Quantity,
    ParameterSnapshot,
    evaluate,
    plan_batch,
    plan_batch_snapshot,
)


@pytest.mark.parametrize('function', CATALOG['functions'], ids=lambda f: f['name'])
def test_every_catalog_function(function):
    assert function['arity'] == len(function['arguments'])
    assert (
        function['signature']
        == function['name'] + '(' + '; '.join(a['name'] for a in function['arguments']) + ')'
    )
    assert (
        function['category']
        and function['description']
        and function['returns']
        and function['example']
    )
    for arg in function['arguments']:
        assert arg['name'] and arg['type'] and arg['dimension'] and arg['description']
    if function['name'] == 'random':
        with pytest.raises(LocalEvaluationUnsupported):
            evaluate(function['example'], {})
    else:
        result = evaluate(function['example'], {})
        assert math.isfinite(result.value)
        # Both creation and snapshot update planners must recognize each builtin.
        created = plan_batch('probe=' + function['example'], {}, 'mm')[0]
        snapshot = {
            'probe': ParameterSnapshot(created.expression, created.unit, created.quantity, set())
        }
        updated = plan_batch_snapshot('probe=' + function['example'], snapshot, 'mm')[0]
        assert updated.quantity == created.quantity


@pytest.mark.parametrize('constant', CATALOG['constants'], ids=lambda c: c['name'])
def test_every_catalog_constant(constant):
    result = evaluate(constant['name'], {})
    assert math.isfinite(result.value)
    assert math.isfinite(evaluate(constant['example'], {}).value)
    with pytest.raises(ExpressionError, match='reserved'):
        plan_batch(constant['name'] + '=2', {}, 'mm')
    with pytest.raises(ExpressionError, match='Unknown'):
        evaluate(constant['name'].lower(), {})


@pytest.mark.parametrize(
    ('expression', 'value', 'dimension'),
    [
        ('round(2.5)', 3, SCALAR),
        ('round(-2.5)', -3, SCALAR),
        ('sign(-2)', 0, SCALAR),
        ('sign(0)', 0, SCALAR),
        ('sign(2)', 1, SCALAR),
        ('log(100)', 2, SCALAR),
        ('ln(E)', 1, SCALAR),
        ('-2^2', -4, SCALAR),
        ('2^3^2', 512, SCALAR),
        ('-7 % 3', -1, SCALAR),
        ('7 % -3', 1, SCALAR),
        ('pow(4 mm^2; 0.5)', 2, LENGTH),
        ('sqrt(4 mm^2)', 2, LENGTH),
        ('2/4 mm', 0.5, (-1, 0)),
        ('sin(PI/4 * 1 rad)', math.sqrt(0.5), SCALAR),
        ('Gravity / (1 mm/s^2)', 9806.65, SCALAR),
        ('SpeedOfLight / (1 mm/s)', 299792458000, SCALAR),
        ('if((1<2) and not(3<>3); 10 mm; 20 mm)', 10, LENGTH),
        ('if((1>2) or (2>=2); 3; 4)', 3, SCALAR),
        ('if(1==2; 3; if(1<=2; 4; 5))', 4, SCALAR),
        ('asinh(1)', math.asinh(1), ANGLE),
        ('atanh(0)', 0, ANGLE),
    ],
)
def test_fusion_numeric_semantics(expression, value, dimension):
    result = evaluate(expression, {})
    assert result.dimension == dimension
    assert result.value == pytest.approx(value)


@pytest.mark.parametrize(
    'expression',
    [
        'min(1;2;3)',
        'max(1)',
        'pow(2)',
        'sin(1 mm)',
        'ln(-1)',
        'log(0)',
        'asin(2)',
        'acos(-2)',
        'acosh(.5)',
        'atanh(1)',
        'sqrt(-1)',
        'pow(-2;.5)',
        'pow(2;1 mm)',
        'exp(10000)',
        '1%0',
        'min(1 mm;2 deg)',
        'if(1<2;1 mm;2 deg)',
        'pow(2,3)',
        'unknown(1)',
        'PI()',
        'pi',
        '1e-3+e',
        '1!=2',
        '2**3',
        '__import__("os")',
        '(1).__class__',
        '2^10001',
    ],
)
def test_invalid_expression_rejected(expression):
    with pytest.raises(ExpressionError):
        evaluate(expression, {})


@pytest.mark.parametrize('expression', ['random()', 'if(1<2;2;random())'])
def test_random_requires_a_native_evaluator_offline(expression):
    for planner in (plan_batch, plan_batch_snapshot):
        with pytest.raises(LocalEvaluationUnsupported):
            planner('probe=' + expression, {}, 'mm')


def test_unsupported_is_distinct_from_invalid_and_native_fallback_is_narrow():
    with pytest.raises(LocalEvaluationUnsupported):
        evaluate('sin(30)', {})
    calls = []

    def native(name, args, dimension):
        calls.append((name, args, dimension))
        return Quantity(0.5)

    assert evaluate('sin(30)', {}, native).value == 0.5
    assert calls == [('sin', [Quantity(30)], SCALAR)]
    assert evaluate('random()', {}, native, allow_nondeterministic=True).value == 0.5
    assert evaluate('1 kg', {}).dimension == (0, 0, 0, 1)


def test_unitless_parameter_and_scientific_notation_are_not_constants():
    assert evaluate('1e-3 + E', {}).value == pytest.approx(0.001 + math.e)
    assert evaluate('2', {'E': Quantity(999)}).value == 2
    assert len(FUNCTIONS) == len(CATALOG['functions'])


@pytest.mark.parametrize('function', CATALOG['functions'], ids=lambda f: f['name'])
def test_catalog_function_wrong_argument_count(function):
    expression = function['name'] + '(' + ';'.join('1' for _ in range(function['arity'] + 1)) + ')'
    with pytest.raises(ExpressionError, match='arguments'):
        evaluate(expression, {})


def test_derived_dimension_units_for_calculator():
    from Paramood.core.expressions import dimension_unit

    assert dimension_unit(evaluate('Gravity', {}).dimension) == 'mm/s^2'
    assert dimension_unit(evaluate('SpeedOfLight', {}).dimension, 'cm') == 'cm/s'
    assert dimension_unit(SCALAR) == ''
