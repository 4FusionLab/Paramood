"""Existing scalar edits must not inherit the project length default."""

import re

import pytest

from Paramood.core.expressions import (
    LENGTH,
    SCALAR,
    ExpressionError,
    ParameterSnapshot,
    Quantity,
    TextValue,
    evaluate,
    plan_batch,
    plan_batch_snapshot,
)


@pytest.fixture
def snapshot():
    return {
        'post': ParameterSnapshot('4', '', Quantity(4), set()),
        'post_height': ParameterSnapshot('120 mm', 'mm', Quantity(120, LENGTH), set()),
        'post_size': ParameterSnapshot('10 mm', 'mm', Quantity(10, LENGTH), set()),
    }


@pytest.mark.parametrize('planner', ['snapshot', 'values'])
@pytest.mark.parametrize('literal', ['6', '6 n', '-2.5', '1e3'])
def test_existing_scalar_literal_preserves_type(snapshot, planner, literal):
    if planner == 'snapshot':
        operations = plan_batch_snapshot('post=' + literal, snapshot, 'cm')
    else:
        operations = plan_batch(
            'post=' + literal, {name: item.quantity for name, item in snapshot.items()}, 'cm'
        )
    assert len(operations) == 1
    operation = operations[0]
    assert operation.status == 'Update'
    assert operation.unit == ''
    assert operation.quantity.dimension == SCALAR
    assert operation.quantity.value == evaluate(literal, {}).value
    assert evaluate(operation.expression, {}).dimension == SCALAR


@pytest.mark.parametrize(
    ('text', 'expected'),
    [
        ('post+=2', 6),
        ('post-=2', 2),
        ('post*=2', 8),
        ('post/=2', 2),
        ('post=this+2', 6),
        ('post=post*2', 8),
        ('post=2*3', 6),
        ('post=this+post_size/(5 mm)', 6),
        ('post=6;post+=2;post*=2', 16),
        ('post=6;post+=delta;delta=2n', 8),
        ('post+=2;post=this/2', 3),
    ],
)
def test_existing_scalar_relative_and_sequential_edits(snapshot, text, expected):
    operations = plan_batch_snapshot(text, snapshot, 'mm')
    operation = next(op for op in operations if op.name == 'post')
    assert operation.unit == ''
    assert operation.quantity == Quantity(expected)
    assert not re.search(r'\b(?:this|post)\b', operation.expression)


def test_mixed_batch_keeps_new_numeric_length_default_and_recalculates_dependents(snapshot):
    snapshot['total'] = ParameterSnapshot(
        'post*post_size', 'mm', Quantity(40, LENGTH), {'post', 'post_size'}
    )
    operations = plan_batch_snapshot('post=6;new_size=2;new_count=6n;copy=total', snapshot, 'cm')
    by_name = {op.name: op for op in operations}
    assert by_name['post'].quantity == Quantity(6)
    assert by_name['new_size'].quantity == Quantity(20, LENGTH)
    assert by_name['new_size'].unit == 'cm'
    assert by_name['new_count'].quantity == Quantity(6)
    assert by_name['copy'].quantity == Quantity(60, LENGTH)


def test_bare_increment_infers_scalar_from_forward_reference_to_edited_parameter(snapshot):
    operations = plan_batch_snapshot('copy=post;copy+=2;post=6', snapshot, 'mm')
    by_name = {op.name: op for op in operations}
    assert by_name['copy'].quantity == Quantity(8)
    assert by_name['copy'].expression == '(post)+(2)'


@pytest.mark.parametrize('planner', ['snapshot', 'values'])
@pytest.mark.parametrize('text', ["post='six'", 'post=6 mm', 'caption=6', 'caption=6 n'])
def test_scalar_fix_does_not_allow_numeric_text_or_dimension_changes(snapshot, planner, text):
    snapshot['caption'] = ParameterSnapshot("'Body'", 'Text', TextValue('Body'), set())
    with pytest.raises(ExpressionError, match='Cannot change existing parameter type or dimension'):
        if planner == 'snapshot':
            plan_batch_snapshot(text, snapshot, 'mm')
        else:
            plan_batch(text, {name: item.quantity for name, item in snapshot.items()}, 'mm')
