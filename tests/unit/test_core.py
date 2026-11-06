import math
import pytest
from Paramood.core.expressions import ExpressionError, Quantity, plan_batch, evaluate
from Paramood.core.dependencies import cleanup_plan


def test_batch_resolves_forward_references_and_preserves_formula():
    plan = plan_batch('l=h/2; w=15; h=10; count=5n', {}, 'mm')
    by_name = {p.name: p for p in plan}
    assert list(by_name).index('h') < list(by_name).index('l')
    assert by_name['l'].expression == 'h/2'
    assert by_name['l'].quantity.value == 5
    assert by_name['l'].quantity.dimension == (1, 0)
    assert by_name['count'].expression == '5'
    assert by_name['count'].quantity.dimension == (0, 0)


def test_units_and_functions():
    assert evaluate('sin(45deg)', {}).value == pytest.approx(math.sqrt(0.5))
    assert (
        evaluate('sqrt(w*w+h*h)', {'w': Quantity(3, (1, 0)), 'h': Quantity(4, (1, 0))}).value == 5
    )
    assert plan_batch('wall=2.4cm', {}, 'mm')[0].quantity.value == 24


@pytest.mark.parametrize(
    'text', ['a=b;b=a', 'a=unknown', 'a=1mm+2deg', 'a=3**2', 'a=1;a=2', 'a=1/0']
)
def test_invalid_batches_are_rejected(text):
    with pytest.raises(ExpressionError):
        plan_batch(text, {}, 'mm')


def test_existing_dimension_is_protected():
    with pytest.raises(ExpressionError):
        plan_batch('w=2deg', {'w': Quantity(15, (1, 0))}, 'mm')


def test_cleanup_protects_roots_favorites_and_retained_dependencies():
    graph = {'used': {'base'}, 'base': set(), 'a': {'b'}, 'b': set(), 'fav': {'b'}, 'free': set()}
    assert cleanup_plan(graph, {'used'}, {'fav'}) == ['free', 'a'] or cleanup_plan(
        graph, {'used'}, {'fav'}
    ) == ['a', 'free']
    assert cleanup_plan(graph, {'used'}, set(), selected={'b'}) == []
    assert cleanup_plan({'a': {'b'}, 'b': set()}, set(), set(), selected={'a', 'b'}) == ['a', 'b']


def test_cleanup_fails_closed_on_unknown_references():
    with pytest.raises(ValueError):
        cleanup_plan({'a': {'missing'}}, set(), set())


def test_batch_failure_compensates_applied_changes():
    from Paramood.core.parameters import apply_batch, BatchApplyError

    class Store:
        def __init__(self):
            self.items = {'w': '10 mm'}

        def get_expression(self, name):
            return self.items[name]

        def update(self, name, expression):
            self.items[name] = expression

        def create(self, name, expression, unit):
            if name == 'bad':
                raise RuntimeError('failure')
            self.items[name] = expression

        def delete(self, name):
            del self.items[name]

    store = Store()
    plan = plan_batch('w=20; a=2; bad=1', {'w': Quantity(10, (1, 0))}, 'mm')
    with pytest.raises(BatchApplyError) as error:
        apply_batch(store, plan)
    assert error.value.rollback_errors == []
    assert store.items == {'w': '10 mm'}


def test_final_graph_catches_hidden_cycle_and_stale_intermediate():
    from Paramood.core.expressions import validate_final_graph

    cycle = plan_batch('a=b', {'a': Quantity(1, (1, 0)), 'b': Quantity(2, (1, 0))}, 'mm')
    with pytest.raises(ExpressionError, match='Cyclic'):
        validate_final_graph(cycle, {'a': set(), 'b': {'a'}})
    stale = plan_batch('a=2; c=b', {'a': Quantity(1, (1, 0)), 'b': Quantity(2, (1, 0))}, 'mm')
    with pytest.raises(ExpressionError, match='stale'):
        validate_final_graph(stale, {'a': set(), 'b': {'a'}})


def test_nonfinite_result_and_division_are_rejected():
    for expression in ('1e308*1e308', '2/0', '1e999'):
        with pytest.raises(ExpressionError):
            evaluate(expression, {})


def test_internal_unit_helper_cannot_be_called_by_user():
    with pytest.raises(ExpressionError):
        plan_batch('x=__unit__(1mm,"deg")', {}, 'mm')


def test_partial_batch_failure_reports_compensation_failure():
    from Paramood.core.parameters import apply_batch, BatchApplyError

    class Store:
        def __init__(self):
            self.items = {}

        def get_expression(self, name):
            return self.items[name]

        def update(self, name, expression):
            self.items[name] = expression

        def create(self, name, expression, unit):
            if name == 'second':
                raise RuntimeError('create failed')
            self.items[name] = expression

        def delete(self, name):
            raise RuntimeError('delete failed')

    store = Store()
    with pytest.raises(BatchApplyError) as error:
        apply_batch(store, plan_batch('first=1;second=2', {}, 'mm'))
    assert error.value.failed_name == 'second'
    assert error.value.rollback_errors == ['first: delete failed']
    assert 'first' in store.items


def test_batch_graph_rejects_unknown_dependencies():
    from Paramood.core.expressions import validate_final_graph

    operations = plan_batch('new=1', {}, 'mm')
    with pytest.raises(ExpressionError, match='Incomplete'):
        validate_final_graph(operations, {'existing': {'unobserved'}})


def test_batch_graph_accepts_changed_dependency_order_without_cycle():
    from Paramood.core.expressions import validate_final_graph

    existing = {'a': Quantity(1, (1, 0)), 'b': Quantity(2, (1, 0))}
    operations = plan_batch('a=b; b=3', existing, 'mm')
    assert [operation.name for operation in operations] == ['b', 'a']
    validate_final_graph(operations, {'a': set(), 'b': {'a'}})


def test_batch_graph_blocks_stale_reference_through_unchanged_parameter():
    from Paramood.core.expressions import validate_final_graph

    existing = {'a': Quantity(1, (1, 0)), 'middle': Quantity(2, (1, 0))}
    operations = plan_batch('a=3; result=middle', existing, 'mm')
    with pytest.raises(ExpressionError, match='stale'):
        validate_final_graph(operations, {'a': set(), 'middle': {'a'}})


def test_snapshot_plan_recalculates_existing_chain_and_orders_new_operations():
    from Paramood.core.expressions import ParameterSnapshot, plan_batch_snapshot

    snapshot = {
        'a': ParameterSnapshot('10 mm', 'mm', Quantity(10, (1, 0)), set()),
        'b': ParameterSnapshot('a*2', 'mm', Quantity(20, (1, 0)), {'a'}),
    }
    plan = plan_batch_snapshot('a=20; c=b/2', snapshot, 'mm')
    assert [item.name for item in plan] == ['a', 'c']
    assert plan[1].quantity.value == 20
    assert plan[1].expression == 'b/2'


def test_snapshot_plan_rejects_hidden_cycle():
    from Paramood.core.expressions import ParameterSnapshot, plan_batch_snapshot

    snapshot = {
        'a': ParameterSnapshot('10 mm', 'mm', Quantity(10, (1, 0)), set()),
        'b': ParameterSnapshot('a*2', 'mm', Quantity(20, (1, 0)), {'a'}),
    }
    with pytest.raises(ExpressionError, match='Cyclic'):
        plan_batch_snapshot('a=b', snapshot, 'mm')


def test_snapshot_plan_rejects_mismatched_graph_or_values():
    from Paramood.core.expressions import ParameterSnapshot, plan_batch_snapshot

    snapshot = {
        'a': ParameterSnapshot('10 mm', 'mm', Quantity(10, (1, 0)), set()),
        'b': ParameterSnapshot('a*2', 'mm', Quantity(20, (1, 0)), set()),
    }
    with pytest.raises(ExpressionError, match='dependencies'):
        plan_batch_snapshot('a=20; c=b', snapshot, 'mm')
    snapshot['b'] = ParameterSnapshot('a*2', 'mm', Quantity(22, (1, 0)), {'a'})
    with pytest.raises(ExpressionError, match='snapshot'):
        plan_batch_snapshot('a=20; c=b', snapshot, 'mm')


def test_snapshot_plan_uses_recalculated_value_before_division():
    from Paramood.core.expressions import ParameterSnapshot, plan_batch_snapshot

    snapshot = {
        'a': ParameterSnapshot('0', '', Quantity(0), set()),
        'b': ParameterSnapshot('a', '', Quantity(0), {'a'}),
    }
    operations = plan_batch_snapshot('a=2n; result=1/b', snapshot, 'mm')
    assert operations[-1].quantity.value == 0.5


def test_snapshot_plan_rejects_unsupported_existing_expression():
    from Paramood.core.expressions import ParameterSnapshot, plan_batch_snapshot

    snapshot = {'a': ParameterSnapshot('2^3', '', Quantity(8), set())}
    with pytest.raises(ExpressionError):
        plan_batch_snapshot('x=2', snapshot, 'mm')


def test_snapshot_plan_numeric_existing_expression_uses_its_unit():
    from Paramood.core.expressions import ParameterSnapshot, plan_batch_snapshot

    snapshot = {'a': ParameterSnapshot('1', 'in', Quantity(25.4, (1, 0)), set())}
    operations = plan_batch_snapshot('b=a/2', snapshot, 'mm')
    assert operations[0].quantity.value == pytest.approx(12.7)


def test_dotted_parameters_are_resolved_in_batch_and_saved_flat():
    operations = plan_batch('result=box.inner.size/2;box_inner_size=10', {}, 'mm')
    assert [op.name for op in operations] == ['box_inner_size', 'result']
    assert operations[1].expression == 'box_inner_size/2'
    assert operations[1].quantity.value == 5
    assert (
        evaluate('box.inner.size + 0.5mm', {'box_inner_size': Quantity(10, (1, 0))}).value == 10.5
    )


def test_dotted_unknowns_and_cycles_are_rejected():
    with pytest.raises(ExpressionError):
        evaluate('box.missing', {'box_size': Quantity(1)})
    with pytest.raises(ExpressionError, match='Cyclic'):
        plan_batch('box_a=box.b;box_b=box.a', {}, 'mm')


def test_snapshot_batch_uses_flat_dotted_dependencies():
    from Paramood.core.expressions import ParameterSnapshot, plan_batch_snapshot

    snapshot = {'box_size': ParameterSnapshot('10 mm', 'mm', Quantity(10, (1, 0)), set())}
    result = plan_batch_snapshot('width=box.size/2', snapshot, 'mm')
    assert result[0].expression == 'box_size/2'
    assert result[0].quantity.value == 5


def test_dotted_segments_can_start_with_digits():
    assert evaluate('box.3d.width', {'box_3d_width': Quantity(7)}).value == 7


def test_dotted_assignment_names_are_created_as_flat_names_and_referenced():
    from Paramood.core.expressions import plan_batch_snapshot

    for planner in (
        lambda text: plan_batch(text, {}, 'mm'),
        lambda text: plan_batch_snapshot(text, {}, 'mm'),
    ):
        result = planner('box.inner.size=5; l=box.inner.size*2')
        assert [item.name for item in result] == ['box_inner_size', 'l']
        assert result[1].expression == 'box_inner_size*2'
        assert result[1].quantity.value == 10
        with pytest.raises(ExpressionError, match='Duplicate'):
            planner('box.inner.size=5;box_inner_size=6')


def test_dotted_assignment_updates_existing_snapshot_parameter():
    from Paramood.core.expressions import ParameterSnapshot, plan_batch_snapshot

    snapshot = {'box_inner_size': ParameterSnapshot('10 mm', 'mm', Quantity(10, (1, 0)), set())}
    operation = plan_batch_snapshot('box.inner.size=15', snapshot, 'mm')[0]
    assert operation.name == 'box_inner_size'
    assert operation.status == 'Update'
    assert operation.quantity.value == 15


def test_invalid_dotted_assignment_is_rejected():
    for name in ('box..size', '.box.size', 'box.size.', 'box._size'):
        with pytest.raises(ExpressionError):
            plan_batch(name + '=5', {}, 'mm')


@pytest.mark.parametrize(
    ('text', 'expected'),
    [
        ('box.size=box.size+5 mm', 15),
        ('box.size=this+5 mm', 15),
        ('box.size+=5', 15),
        ('box.size-=5 mm', 5),
        ('box.size*=2', 20),
        ('box.size/=2', 5),
    ],
)
def test_relative_updates_embed_old_expression_without_self_reference(text, expected):
    from Paramood.core.expressions import ParameterSnapshot, plan_batch_snapshot

    snapshot = {'box_size': ParameterSnapshot('10 mm', 'mm', Quantity(10, (1, 0)), set())}
    operation = plan_batch_snapshot(text, snapshot, 'mm')[0]
    assert operation.name == 'box_size'
    assert operation.status == 'Update'
    assert operation.quantity.value == expected
    assert 'box_size' not in operation.expression and 'this' not in operation.expression
    assert evaluate(operation.expression, {}).value == expected


@pytest.mark.parametrize('text', ['new+=2', 'new-=2', 'new*=2', 'new/=2', 'new=this+2'])
def test_relative_update_rejects_missing_parameter(text):
    from Paramood.core.expressions import plan_batch_snapshot

    with pytest.raises(ExpressionError):
        plan_batch_snapshot(text, {}, 'mm')
    with pytest.raises(ExpressionError):
        plan_batch(text, {}, 'mm')


def test_relative_update_rejects_division_by_zero():
    from Paramood.core.expressions import ParameterSnapshot, plan_batch_snapshot

    snapshot = {'width': ParameterSnapshot('10 mm', 'mm', Quantity(10, (1, 0)), set())}
    with pytest.raises(ExpressionError, match='Division by zero'):
        plan_batch_snapshot('width/=0', snapshot, 'mm')


def test_relative_addition_uses_the_existing_parameters_display_unit():
    from Paramood.core.expressions import ParameterSnapshot, plan_batch_snapshot

    snapshot = {'width': ParameterSnapshot('1 cm', 'cm', Quantity(10, (1, 0)), set())}
    result = plan_batch_snapshot('width+=2', snapshot, 'mm')[0]
    assert result.quantity.value == 30
    assert evaluate(result.expression, {}).value == 30


def test_relative_angle_update_preserves_dimension():
    from Paramood.core.expressions import ANGLE, ParameterSnapshot, plan_batch_snapshot

    original = math.pi / 6
    snapshot = {'angle': ParameterSnapshot('30 deg', 'deg', Quantity(original, ANGLE), set())}
    result = plan_batch_snapshot('angle+=15', snapshot, 'mm')[0]
    assert result.quantity.value == pytest.approx(math.pi / 4)
    assert evaluate(result.expression, {}).dimension == ANGLE


def test_relative_update_rejects_incompatible_units():
    from Paramood.core.expressions import ParameterSnapshot, plan_batch_snapshot

    snapshot = {'width': ParameterSnapshot('10 mm', 'mm', Quantity(10, (1, 0)), set())}
    with pytest.raises(ExpressionError, match='Incompatible dimensions'):
        plan_batch_snapshot('width+=5 deg', snapshot, 'mm')


def test_relative_update_preserves_previous_formula_dependencies():
    from Paramood.core.expressions import ParameterSnapshot, plan_batch_snapshot

    snapshot = {
        'base': ParameterSnapshot('5 mm', 'mm', Quantity(5, (1, 0)), set()),
        'width': ParameterSnapshot('base*2', 'mm', Quantity(10, (1, 0)), {'base'}),
    }
    result = plan_batch_snapshot('width*=2', snapshot, 'mm')[0]
    assert 'base' in result.expression
    assert 'width' not in result.expression
    assert evaluate(result.expression, {'base': Quantity(5, (1, 0))}).value == 20
    assert evaluate(result.expression, {'base': Quantity(6, (1, 0))}).value == 24


@pytest.mark.parametrize('text', ['width=this+5 mm', 'width=width+5 mm', 'width+=5 mm'])
def test_this_and_compound_updates_embed_old_formula(text):
    from Paramood.core.expressions import ParameterSnapshot, plan_batch_snapshot

    snapshot = {
        'base': ParameterSnapshot('5 mm', 'mm', Quantity(5, (1, 0)), set()),
        'width': ParameterSnapshot('base*2', 'mm', Quantity(10, (1, 0)), {'base'}),
    }
    result = plan_batch_snapshot(text, snapshot, 'mm')[0]
    assert 'base' in result.expression
    assert 'width' not in result.expression and 'this' not in result.expression
    assert evaluate(result.expression, {'base': Quantity(5, (1, 0))}).value == 15
    assert evaluate(result.expression, {'base': Quantity(6, (1, 0))}).value == 17


def test_relative_update_recomputes_dependencies_changed_in_same_batch():
    from Paramood.core.expressions import ParameterSnapshot, plan_batch_snapshot

    snapshot = {
        'base': ParameterSnapshot('5 mm', 'mm', Quantity(5, (1, 0)), set()),
        'width': ParameterSnapshot('base*2', 'mm', Quantity(10, (1, 0)), {'base'}),
    }
    operations = plan_batch_snapshot('width*=2;base=6', snapshot, 'mm')
    assert [operation.name for operation in operations] == ['base', 'width']
    assert operations[1].quantity.value == 24
    assert 'base' in operations[1].expression
    with pytest.raises(ExpressionError, match='Cyclic'):
        plan_batch_snapshot('width*=2;base=width', snapshot, 'mm')


def test_relative_update_of_parameter_declared_earlier_in_batch():
    from Paramood.core.expressions import plan_batch_snapshot

    text = 'box.inner.size=25;box.inner.size*=2'
    for operations in (plan_batch(text, {}, 'mm'), plan_batch_snapshot(text, {}, 'mm')):
        assert len(operations) == 1
        assert operations[0].name == 'box_inner_size'
        assert operations[0].status == 'New'
        assert operations[0].quantity.value == 50
        assert evaluate(operations[0].expression, {}).value == 50


@pytest.mark.parametrize(
    ('text', 'expected'),
    [
        ('width=25;width+=5', 30),
        ('width=25;width-=5', 20),
        ('width=25;width*=2', 50),
        ('width=25;width/=5', 5),
        ('width=25;width=width*2', 50),
        ('width=25;width=this*2', 50),
        ('width=25;width*=2;width+=5', 55),
    ],
)
def test_multiple_batch_operations_preserve_the_previous_expression(text, expected):
    from Paramood.core.expressions import plan_batch_snapshot

    for operations in (plan_batch(text, {}, 'mm'), plan_batch_snapshot(text, {}, 'mm')):
        assert len(operations) == 1
        assert operations[0].quantity.value == expected
        assert evaluate(operations[0].expression, {}).value == expected


def test_batch_relative_update_preserves_dependencies_and_rejects_cycle():
    from Paramood.core.expressions import plan_batch_snapshot

    operations = plan_batch('base=5;width=base*2;width*=2', {}, 'mm')
    assert operations[-1].quantity.value == 20
    assert 'base' in operations[-1].expression
    with pytest.raises(ExpressionError, match='Cyclic'):
        plan_batch_snapshot('base=width;width=base*2;width*=2', {}, 'mm')


def test_repeated_relative_updates_apply_to_existing_snapshot():
    from Paramood.core.expressions import ParameterSnapshot, plan_batch_snapshot

    snapshot = {'width': ParameterSnapshot('10 mm', 'mm', Quantity(10, (1, 0)), set())}
    operation = plan_batch_snapshot('width*=2;width+=5', snapshot, 'mm')[0]
    assert operation.status == 'Update'
    assert operation.quantity.value == 25
    assert evaluate(operation.expression, {}).value == 25


def test_relative_update_supports_forward_dependency_for_bare_increment():
    operations = plan_batch('width=depth;width+=5;depth=2', {}, 'mm')
    assert {item.name: item.quantity.value for item in operations} == {'depth': 2, 'width': 7}


def test_relative_update_on_new_scalar_and_angle_preserves_dimensions():
    for text, expected, dimension in (
        ('count=5n;count+=2', 7, (0, 0)),
        ('angle=30deg;angle+=15', math.pi / 4, (0, 1)),
    ):
        operation = plan_batch(text, {}, 'mm')[0]
        assert operation.quantity.value == pytest.approx(expected)
        assert operation.quantity.dimension == dimension


def test_repeated_relative_update_keeps_existing_display_unit():
    from Paramood.core.expressions import ParameterSnapshot, plan_batch_snapshot

    snapshot = {'width': ParameterSnapshot('1 cm', 'cm', Quantity(10, (1, 0)), set())}
    result = plan_batch_snapshot('width*=2;width+=1', snapshot, 'mm')[0]
    assert result.quantity.value == 30


def test_exponential_self_expansion_is_bounded():
    text = 'width=1;' + ';'.join('width+=width' for _ in range(20))
    with pytest.raises(ExpressionError, match='Expanded expression is too long'):
        plan_batch(text, {}, 'mm')


def test_new_parameter_preserves_the_explicit_literal_unit():
    from Paramood.core.expressions import ParameterSnapshot, plan_batch_snapshot

    snapshot = {'angle': ParameterSnapshot('60 deg', 'deg', Quantity(math.pi / 3, (0, 1)), set())}
    operations = plan_batch_snapshot('new_angle=1.0 rad;angle=new_angle', snapshot, 'mm')
    created = next(op for op in operations if op.name == 'new_angle')
    assert created.unit == 'rad'
