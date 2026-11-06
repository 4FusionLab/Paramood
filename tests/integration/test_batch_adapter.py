import importlib
import sys
import types
from types import SimpleNamespace

import pytest


@pytest.fixture
def adapter_module(monkeypatch):
    adsk = types.ModuleType('adsk')
    core = types.ModuleType('adsk.core')
    fusion = types.ModuleType('adsk.fusion')
    core.ValueInput = SimpleNamespace(createByString=lambda s: s)
    fusion.Design = SimpleNamespace(cast=lambda p: p)
    fusion.ModelParameter = SimpleNamespace(cast=lambda p: None)
    adsk.core, adsk.fusion = core, fusion
    for name, module in [('adsk', adsk), ('adsk.core', core), ('adsk.fusion', fusion)]:
        monkeypatch.setitem(sys.modules, name, module)
    sys.modules.pop('Paramood.fusion.adapter', None)
    module = importlib.import_module('Paramood.fusion.adapter')
    yield module
    sys.modules.pop('Paramood.fusion.adapter', None)


class Parameters:
    def __init__(self):
        self.entries = {}
        self.log = []

    def __iter__(self):
        return iter(self.entries.values())

    def itemByName(self, name):
        return self.entries.get(name)

    def add(self, name, expression, unit, comment):
        self.log.append(('add', name, expression, unit))
        values = {'10 mm': 1.0, 'h/2': 0.5, '15 mm': 1.5, '5': 5.0}
        self.entries[name] = SimpleNamespace(
            name=name, expression=expression, unit=unit, value=values.get(expression, 0)
        )
        return self.entries[name]


class Units:
    defaultLengthUnits = 'mm'

    def __init__(self, params):
        self.params = params

    def isValidExpression(self, expression, unit):
        self.params.log.append(('validate', expression, unit))
        return expression != 'min(1,2)'

    def formatUnits(self, unit):
        raise RuntimeError('not a unit')


class Timeline(list):
    def __init__(self, items, groups=()):
        super().__init__(items)
        self.markerPosition = len(items)
        self.timelineGroups = list(groups)


def make_adapter(module):
    params = Parameters()
    design = SimpleNamespace(
        allParameters=params, userParameters=params, fusionUnitsManager=Units(params)
    )
    app = SimpleNamespace(activeDocument=object(), activeProduct=design)
    adapter = module.FusionAdapter(app)
    adapter.in_command = True
    return adapter, params


def test_batch_created_in_dependency_order_and_validated_immediately(adapter_module):
    adapter, params = make_adapter(adapter_module)
    text = 'l=h/2; w=15;h=10;count=5n'
    design = adapter._design()
    ops = adapter_module.plan_batch(text, {}, 'mm')
    result = adapter._execute_new_batch(design, ops)
    assert result['created'] == ['h', 'l', 'w', 'count']
    assert params.log == [
        ('validate', '10 mm', 'mm'),
        ('add', 'h', '10 mm', 'mm'),
        ('validate', 'h/2', 'mm'),
        ('add', 'l', 'h/2', 'mm'),
        ('validate', '15 mm', 'mm'),
        ('add', 'w', '15 mm', 'mm'),
        ('validate', '5', ''),
        ('add', 'count', '5', ''),
    ]


def test_later_fusion_rejection_propagates_as_error_for_command_abort(adapter_module):
    adapter, params = make_adapter(adapter_module)
    text = 'a=15;b=min(1,2)'
    design = adapter._design()
    ops = adapter_module.plan_batch(text, {}, 'mm')
    with pytest.raises(adapter_module.BridgeError) as error:
        adapter._execute_new_batch(design, ops)
    assert error.value.code == 'INVALID_EXPRESSION'
    assert list(params.entries) == ['a']


def test_changed_model_after_preview_rejected_before_first_write(adapter_module):
    adapter, params = make_adapter(adapter_module)
    text = 'a=15'
    token = adapter.request('parameters.preview', {'text': text})['snapshotToken']
    params.entries['external'] = SimpleNamespace(
        name='external', expression='1 mm', unit='mm', value=0.1
    )
    with pytest.raises(adapter_module.BridgeError) as error:
        adapter.request('parameters.apply', {'text': text, 'snapshotToken': token})
    assert error.value.code == 'STALE_PREVIEW'
    assert params.log == []


def test_direct_apply_creates_one_parameter_without_command(adapter_module):
    adapter, params = make_adapter(adapter_module)
    adapter.in_command = False
    adapter.in_direct_apply = True
    preview = adapter.request('parameters.preview', {'text': 'width=15'})
    result = adapter.request(
        'parameters.apply', {'text': 'width=15', 'snapshotToken': preview['snapshotToken']}
    )
    assert result == {'created': ['width'], 'updated': []}
    assert params.entries['width'].expression == '15 mm'


def test_direct_apply_rejects_stale_preview_before_write(adapter_module):
    adapter, params = make_adapter(adapter_module)
    adapter.in_command = False
    adapter.in_direct_apply = True
    preview = adapter.request('parameters.preview', {'text': 'width=15'})
    params.entries['other'] = SimpleNamespace(
        name='other', expression='10 mm', unit='mm', value=1.0
    )
    with pytest.raises(adapter_module.BridgeError) as error:
        adapter.request(
            'parameters.apply', {'text': 'width=15', 'snapshotToken': preview['snapshotToken']}
        )
    assert error.value.code == 'STALE_PREVIEW'
    assert not params.log


def test_sketch_edit_detection_fails_safe(adapter_module):
    adapter, _ = make_adapter(adapter_module)
    sketch = object()
    adapter_module.adsk.fusion.Sketch = SimpleNamespace(
        cast=lambda target: target if target is sketch else None
    )
    adapter.app.activeEditObject = sketch
    assert adapter.is_sketch_edit()
    adapter.app.activeEditObject = object()
    assert not adapter.is_sketch_edit()
    del adapter.app.activeEditObject
    assert adapter.is_sketch_edit()


def test_direct_apply_creates_batch_in_dependency_order(adapter_module):
    adapter, params = make_adapter(adapter_module)
    adapter.in_command = False
    adapter.in_direct_apply = True
    text = 'width=height/2;height=10'
    preview = adapter.request('parameters.preview', {'text': text})
    # The fake API evaluates this dependent expression to 5 mm.
    original_add = params.add

    def add(name, expression, unit, comment):
        parameter = original_add(name, expression, unit, comment)
        if expression == 'height/2':
            parameter.value = 0.5
        return parameter

    params.add = add
    result = adapter.request(
        'parameters.apply', {'text': text, 'snapshotToken': preview['snapshotToken']}
    )
    assert result['created'] == ['height', 'width']
    assert params.entries['width'].expression == 'height/2'


def test_direct_batch_reports_confirmed_changes_after_later_failure(adapter_module):
    adapter, params = make_adapter(adapter_module)
    adapter.in_command = False
    adapter.in_direct_apply = True
    text = 'width=15;height=min(1,2)'
    preview = adapter.request('parameters.preview', {'text': text})
    with pytest.raises(adapter_module.BridgeError) as error:
        adapter.request(
            'parameters.apply', {'text': text, 'snapshotToken': preview['snapshotToken']}
        )
    assert error.value.code == 'DIRECT_PARTIAL'
    assert 'width' in str(error.value) and 'height may also have changed' in str(error.value)
    assert 'width' in params.entries and 'height' not in params.entries


def test_direct_mixed_batch_updates_then_creates(adapter_module):
    adapter, params = make_adapter(adapter_module)

    class Editable:
        name, unit = 'width', 'mm'
        value = 1.0
        _expression = '10 mm'

        @property
        def expression(self):
            return self._expression

        @expression.setter
        def expression(self, value):
            self._expression = value
            self.value = 1.5

    params.entries['width'] = Editable()
    ops = [
        SimpleNamespace(
            name='width',
            status='Update',
            expression='15 mm',
            unit='mm',
            quantity=adapter_module.Quantity(15, adapter_module.LENGTH),
        ),
        SimpleNamespace(
            name='height',
            status='New',
            expression='10 mm',
            unit='mm',
            quantity=adapter_module.Quantity(10, adapter_module.LENGTH),
        ),
    ]
    assert adapter._execute_direct_batch(adapter._design(), ops) == {
        'created': ['height'],
        'updated': ['width'],
    }
    assert params.entries['width'].expression == '15 mm'
    assert params.entries['height'].expression == '10 mm'


def test_direct_apply_failure_does_not_claim_rollback(adapter_module):
    adapter, params = make_adapter(adapter_module)
    adapter.in_command = False
    adapter.in_direct_apply = True
    preview = adapter.request('parameters.preview', {'text': 'width=15'})
    original_add = params.add

    def wrong_value(*args):
        result = original_add(*args)
        result.value = 99
        return result

    params.add = wrong_value
    with pytest.raises(adapter_module.BridgeError) as error:
        adapter.request(
            'parameters.apply', {'text': 'width=15', 'snapshotToken': preview['snapshotToken']}
        )
    assert error.value.code == 'DIRECT_APPLY_FAILED'
    assert 'Refresh' in str(error.value)
    assert 'width' in params.entries


@pytest.mark.parametrize('succeeds', [True, False])
def test_direct_update_batch_uses_atomic_fusion_method(adapter_module, succeeds):
    adapter, params = make_adapter(adapter_module)
    design = adapter._design()
    for name in ('width', 'height'):
        params.entries[name] = SimpleNamespace(name=name, expression='10 mm', unit='mm', value=1.0)

    def modify(parameters, values):
        params.log.append(('modify', list(values)))
        if succeeds:
            for parameter, value in zip(parameters, values):
                parameter.expression = value
                parameter.value = {'15 mm': 1.5, '10 mm': 1.0}[value]
        return succeeds

    design.modifyParameters = modify
    ops = [
        SimpleNamespace(
            name='width',
            status='Update',
            expression='15 mm',
            quantity=adapter_module.Quantity(15, adapter_module.LENGTH),
        ),
        SimpleNamespace(
            name='height',
            status='Update',
            expression='10 mm',
            quantity=adapter_module.Quantity(10, adapter_module.LENGTH),
        ),
    ]
    if succeeds:
        assert adapter._execute_direct_batch(design, ops) == {
            'created': [],
            'updated': ['width', 'height'],
        }
        assert params.entries['width'].expression == '15 mm'
    else:
        with pytest.raises(adapter_module.BridgeError) as error:
            adapter._execute_direct_batch(design, ops)
        assert error.value.code == 'UPDATE_FAILED'
        assert params.entries['width'].expression == '10 mm'
    assert [item[0] for item in params.log] == ['validate', 'validate', 'modify']


def test_fusion_result_different_from_preview_aborts(adapter_module):
    adapter, params = make_adapter(adapter_module)
    text = 'a=15'
    token = adapter.request('parameters.preview', {'text': text})['snapshotToken']
    old_add = params.add

    def wrong_add(*args):
        created = old_add(*args)
        created.value = 99
        return created

    params.add = wrong_add
    with pytest.raises(adapter_module.BridgeError) as error:
        adapter.request('parameters.apply', {'text': text, 'snapshotToken': token})
    assert error.value.code == 'RESULT_MISMATCH'


def test_batch_preview_and_apply_create_dependencies_in_order(adapter_module):
    adapter, params = make_adapter(adapter_module)
    text = 'l=h/2;h=10;w=15;count=5n'
    preview = adapter.request('parameters.preview', {'text': text})
    assert preview['valid']
    assert [item['name'] for item in preview['items']] == ['h', 'l', 'w', 'count']
    result = adapter.request(
        'parameters.apply', {'text': text, 'snapshotToken': preview['snapshotToken']}
    )
    assert result['created'] == ['h', 'l', 'w', 'count']
    assert params.entries['l'].expression == 'h/2'


def test_batch_rejects_unverified_existing_parameter_before_any_write(adapter_module):
    adapter, params = make_adapter(adapter_module)
    params.entries['existing'] = SimpleNamespace(
        name='existing', expression='10 mm', unit='mm', value=1.0
    )
    with pytest.raises(adapter_module.BridgeError) as error:
        adapter.request('parameters.preview', {'text': 'a=15;existing=10'})
    assert error.value.code == 'INCOMPLETE_SNAPSHOT'
    assert not params.log


def test_draft_identity_survives_document_switch_but_request_identity_changes(adapter_module):
    adapter, _ = make_adapter(adapter_module)
    first = adapter.app.activeDocument
    adapter._design()
    original_request = adapter.document_id
    original_draft = adapter._draft_id
    adapter.app.activeDocument = object()
    adapter.invalidate()
    adapter._design()
    assert adapter._draft_id != original_draft
    adapter.app.activeDocument = first
    adapter.invalidate()
    adapter._design()
    assert adapter._draft_id == original_draft
    assert adapter.document_id != original_request


def test_dependency_snapshot_preserves_units_and_both_dependency_directions(adapter_module):
    adapter, params = make_adapter(adapter_module)
    adapter_module.adsk.fusion.ParameterValueTypes = SimpleNamespace(NumericParameterValueType=0)
    a = SimpleNamespace(name='a', expression='10 mm', unit='mm', value=1.0, valueType=0)
    b = SimpleNamespace(name='b', expression='a/2', unit='mm', value=0.5, valueType=0)
    a.dependencyParameters, a.dependentParameters = [], [b]
    b.dependencyParameters, b.dependentParameters = [a], []
    params.entries = {'a': a, 'b': b}
    snapshot = adapter._dependency_snapshot(adapter._design())
    assert snapshot['a'].quantity.value == 10
    assert snapshot['b'].quantity.value == 5
    assert snapshot['b'].dependencies == {'a'}
    assert snapshot['a'].dependencies == set()


def test_dependency_snapshot_rejects_missing_or_inconsistent_links(adapter_module):
    adapter, params = make_adapter(adapter_module)
    adapter_module.adsk.fusion.ParameterValueTypes = SimpleNamespace(NumericParameterValueType=0)
    a = SimpleNamespace(name='a', expression='10 mm', unit='mm', value=1.0, valueType=0)
    b = SimpleNamespace(name='b', expression='a/2', unit='mm', value=0.5, valueType=0)
    a.dependencyParameters, a.dependentParameters = [], []
    b.dependencyParameters, b.dependentParameters = [a], []
    params.entries = {'a': a, 'b': b}
    with pytest.raises(adapter_module.BridgeError):
        adapter._dependency_snapshot(adapter._design())
    a.dependentParameters = [b]
    params.entries = {'b': b}
    with pytest.raises(adapter_module.BridgeError):
        adapter._dependency_snapshot(adapter._design())


def test_dependency_snapshot_rejects_text_or_unsupported_units(adapter_module):
    adapter, params = make_adapter(adapter_module)
    adapter_module.adsk.fusion.ParameterValueTypes = SimpleNamespace(NumericParameterValueType=0)
    p = SimpleNamespace(name='a', expression="'text'", unit='', valueType=1)
    params.entries = {'a': p}
    with pytest.raises(adapter_module.BridgeError):
        adapter._dependency_snapshot(adapter._design())
    p.valueType, p.unit, p.value = 0, 'kg', 1.0
    with pytest.raises(adapter_module.BridgeError):
        adapter._dependency_snapshot(adapter._design())


def test_dependency_snapshot_feeds_update_planner_and_catches_cycle(adapter_module):
    from Paramood.core.expressions import ExpressionError, plan_batch_snapshot

    adapter, params = make_adapter(adapter_module)
    adapter_module.adsk.fusion.ParameterValueTypes = SimpleNamespace(NumericParameterValueType=0)
    a = SimpleNamespace(name='a', expression='10 mm', unit='mm', value=1.0, valueType=0)
    b = SimpleNamespace(name='b', expression='a/2', unit='mm', value=0.5, valueType=0)
    a.dependencyParameters, a.dependentParameters = [], [b]
    b.dependencyParameters, b.dependentParameters = [a], []
    params.entries = {'a': a, 'b': b}
    snapshot = adapter._dependency_snapshot(adapter._design())
    plan = plan_batch_snapshot('a=20; c=b/2', snapshot, 'mm')
    assert [(item.name, item.quantity.value) for item in plan] == [('a', 20), ('c', 5)]
    with pytest.raises(ExpressionError, match='Cyclic'):
        plan_batch_snapshot('a=b', snapshot, 'mm')


def test_dependency_snapshot_rejects_nonfinite_values_and_aliases(adapter_module):
    adapter, params = make_adapter(adapter_module)
    adapter_module.adsk.fusion.ParameterValueTypes = SimpleNamespace(NumericParameterValueType=0)
    a = SimpleNamespace(
        name='a',
        expression='10 mm',
        unit='mm',
        value=float('nan'),
        valueType=0,
        dependencyParameters=[],
        dependentParameters=[],
    )
    params.entries = {'a': a}
    with pytest.raises(adapter_module.BridgeError):
        adapter._dependency_snapshot(adapter._design())
    a.value = 1.0
    wrong_a = SimpleNamespace(name='a', expression='20 mm', unit='mm', value=2.0, valueType=0)
    b = SimpleNamespace(
        name='b',
        expression='a/2',
        unit='mm',
        value=0.5,
        valueType=0,
        dependencyParameters=[wrong_a],
        dependentParameters=[],
    )
    a.dependentParameters = [b]
    params.entries = {'a': a, 'b': b}
    with pytest.raises(adapter_module.BridgeError):
        adapter._dependency_snapshot(adapter._design())


def test_existing_user_parameter_preview_and_update(adapter_module):
    adapter, params = make_adapter(adapter_module)
    adapter_module.adsk.fusion.ParameterValueTypes = SimpleNamespace(NumericParameterValueType=0)

    class UserParameter:
        name, unit, valueType = 'width', 'mm', 0
        dependencyParameters, dependentParameters = [], []

        def __init__(self):
            self._expression, self.value = '10 mm', 1.0

        @property
        def expression(self):
            return self._expression

        @expression.setter
        def expression(self, expression):
            self._expression, self.value = expression, 2.0

    params.entries['width'] = UserParameter()
    preview = adapter.request('parameters.preview', {'text': 'width=20'})
    assert preview['items'][0]['status'] == 'Update'
    assert preview['items'][0]['value'] == 20
    result = adapter.request(
        'parameters.apply', {'text': 'width=20', 'snapshotToken': preview['snapshotToken']}
    )
    assert result['updated'] == ['width']
    assert params.entries['width'].expression == '20 mm'


def test_update_model_parameter_through_preview_and_apply(adapter_module):
    adapter, params = make_adapter(adapter_module)
    adapter_module.adsk.fusion.ParameterValueTypes = SimpleNamespace(NumericParameterValueType=0)

    class ModelParameter:
        name, unit, valueType = 'model_width', 'mm', 0
        dependencyParameters, dependentParameters = [], []

        def __init__(self):
            self._expression, self.value = '10 mm', 1.0

        @property
        def expression(self):
            return self._expression

        @expression.setter
        def expression(self, expression):
            self._expression, self.value = expression, 2.0

    param = ModelParameter()
    adapter_module.adsk.fusion.ModelParameter = SimpleNamespace(
        cast=lambda p: p if isinstance(p, ModelParameter) else None
    )
    params.entries['model_width'] = param
    adapter.app.activeProduct.userParameters = Parameters()
    preview = adapter.request('parameters.preview', {'text': 'model_width=20'})
    result = adapter.request(
        'parameters.apply', {'text': 'model_width=20', 'snapshotToken': preview['snapshotToken']}
    )
    assert result['updated'] == ['model_width']
    assert param.expression == '20 mm'


def test_update_parameter_used_by_geometry_even_if_feature_reports_error(adapter_module):
    adapter, params = make_adapter(adapter_module)
    adapter_module.adsk.fusion.ParameterValueTypes = SimpleNamespace(NumericParameterValueType=0)
    dimension = SimpleNamespace(name='d0', expression='a/2', unit='mm', value=0.5, valueType=0)
    feature = SimpleNamespace(healthState=0)

    class UserParameter:
        name, unit, valueType = 'a', 'mm', 0
        dependencyParameters = []

        def __init__(self):
            self._expression, self.value = '10 mm', 1.0
            self.dependentParameters = [dimension]

        @property
        def expression(self):
            return self._expression

        @expression.setter
        def expression(self, value):
            self._expression, self.value = value, 2.0
            dimension.value = 1.0
            feature.healthState = 2

    a = UserParameter()
    dimension.dependencyParameters, dimension.dependentParameters = [a], []
    params.entries = {'a': a, 'd0': dimension}
    users = Parameters()
    users.entries = {'a': a}
    adapter.app.activeProduct.userParameters = users
    adapter.app.activeProduct.timeline = Timeline([feature])
    preview = adapter.request('parameters.preview', {'text': 'a=20'})
    result = adapter.request(
        'parameters.apply', {'text': 'a=20', 'snapshotToken': preview['snapshotToken']}
    )
    assert result['updated'] == ['a']
    assert (a.expression, a.value, dimension.value, feature.healthState) == ('20 mm', 2.0, 1.0, 2)


def test_update_rejects_a_changed_parameter_after_preview(adapter_module):
    adapter, params = make_adapter(adapter_module)
    adapter_module.adsk.fusion.ParameterValueTypes = SimpleNamespace(NumericParameterValueType=0)
    p = SimpleNamespace(
        name='a',
        expression='10 mm',
        unit='mm',
        value=1.0,
        valueType=0,
        dependencyParameters=[],
        dependentParameters=[],
    )
    params.entries['a'] = p
    preview = adapter.request('parameters.preview', {'text': 'a=20'})
    p.expression, p.value = '15 mm', 1.5
    with pytest.raises(adapter_module.BridgeError) as error:
        adapter.request(
            'parameters.apply', {'text': 'a=20', 'snapshotToken': preview['snapshotToken']}
        )
    assert error.value.code == 'STALE_PREVIEW'
    assert p.expression == '15 mm'
    assert not params.log


def test_update_supports_indirect_geometry_dependency(adapter_module):
    adapter, params = make_adapter(adapter_module)
    adapter_module.adsk.fusion.ParameterValueTypes = SimpleNamespace(NumericParameterValueType=0)
    b = SimpleNamespace(name='b', expression='a/2', unit='mm', value=0.5, valueType=0)
    dim = SimpleNamespace(name='d0', expression='b', unit='mm', value=0.5, valueType=0)

    class UserParameter:
        name, unit, valueType = 'a', 'mm', 0

        def __init__(self):
            self._expression, self.value = '10 mm', 1.0

        @property
        def expression(self):
            return self._expression

        @expression.setter
        def expression(self, value):
            self._expression, self.value = value, 2.0
            b.value = dim.value = 1.0

    a = UserParameter()
    a.dependencyParameters, a.dependentParameters = [], [b]
    b.dependencyParameters, b.dependentParameters = [a], [dim]
    dim.dependencyParameters, dim.dependentParameters = [b], []
    params.entries = {'a': a, 'b': b, 'd0': dim}
    users = Parameters()
    users.entries = {'a': a, 'b': b}
    adapter.app.activeProduct.userParameters = users
    preview = adapter.request('parameters.preview', {'text': 'a=20'})
    assert preview['valid']
    assert preview['items'][0]['value'] == 20
    result = adapter.request(
        'parameters.apply', {'text': 'a=20', 'snapshotToken': preview['snapshotToken']}
    )
    assert result['updated'] == ['a']
    assert (a.expression, b.value, dim.value) == ('20 mm', 1.0, 1.0)


def test_timeline_health_requires_stable_healthy_items(adapter_module):
    adapter, _ = make_adapter(adapter_module)
    adapter_module.adsk.fusion.FeatureHealthStates = SimpleNamespace(HealthyFeatureHealthState=0)
    sketch = SimpleNamespace(
        name='Sketch',
        healthState=0,
        isValid=True,
        isGroup=False,
        isSuppressed=False,
        isRolledBack=False,
    )
    feature = SimpleNamespace(
        name='Fillet',
        healthState=0,
        isValid=True,
        isGroup=False,
        isSuppressed=False,
        isRolledBack=False,
    )
    design = SimpleNamespace(timeline=Timeline([sketch, feature]))
    baseline = adapter._healthy_timeline_snapshot(design)
    adapter._verify_timeline_health(design, baseline)
    feature.healthState = 2
    with pytest.raises(adapter_module.BridgeError) as error:
        adapter._verify_timeline_health(design, baseline)
    assert error.value.code == 'UNHEALTHY_MODEL'
    feature.healthState = 0
    design.timeline = Timeline([sketch])
    with pytest.raises(adapter_module.BridgeError):
        adapter._verify_timeline_health(design, baseline)


def test_timeline_health_rejects_unknown_unhealthy_or_unavailable_states(adapter_module):
    adapter, _ = make_adapter(adapter_module)
    adapter_module.adsk.fusion.FeatureHealthStates = SimpleNamespace(HealthyFeatureHealthState=0)
    for timeline in (
        [],
        [
            SimpleNamespace(
                name='Unknown',
                healthState=5,
                isValid=True,
                isGroup=False,
                isSuppressed=False,
                isRolledBack=False,
            )
        ],
        [SimpleNamespace(name='Missing', isValid=True)],
    ):
        with pytest.raises(adapter_module.BridgeError):
            adapter._healthy_timeline_snapshot(SimpleNamespace(timeline=Timeline(timeline)))


def test_collapsed_timeline_group_checks_its_children(adapter_module):
    adapter, _ = make_adapter(adapter_module)
    adapter_module.adsk.fusion.FeatureHealthStates = SimpleNamespace(HealthyFeatureHealthState=0)
    child = SimpleNamespace(
        name='Fillet',
        healthState=0,
        isValid=True,
        isGroup=False,
        isSuppressed=False,
        isRolledBack=False,
    )
    group = SimpleNamespace(
        name='Group',
        healthState=5,
        isValid=True,
        isGroup=True,
        isSuppressed=False,
        isRolledBack=False,
        isCollapsed=True,
        count=1,
        item=lambda index: child,
    )
    design = SimpleNamespace(timeline=Timeline([group], [group]))
    baseline = adapter._healthy_timeline_snapshot(design)
    adapter._verify_timeline_health(design, baseline)
    child.healthState = 2
    with pytest.raises(adapter_module.BridgeError):
        adapter._verify_timeline_health(design, baseline)


@pytest.mark.parametrize('flag', ['isSuppressed', 'isRolledBack'])
def test_timeline_health_rejects_uncomputed_items(adapter_module, flag):
    adapter, _ = make_adapter(adapter_module)
    adapter_module.adsk.fusion.FeatureHealthStates = SimpleNamespace(HealthyFeatureHealthState=0)
    item = SimpleNamespace(
        name='Feature',
        healthState=0,
        isValid=True,
        isGroup=False,
        isSuppressed=False,
        isRolledBack=False,
    )
    setattr(item, flag, True)
    with pytest.raises(adapter_module.BridgeError):
        adapter._healthy_timeline_snapshot(SimpleNamespace(timeline=Timeline([item])))


def test_expanded_group_change_invalidates_timeline_snapshot(adapter_module):
    adapter, _ = make_adapter(adapter_module)
    adapter_module.adsk.fusion.FeatureHealthStates = SimpleNamespace(HealthyFeatureHealthState=0)
    child = SimpleNamespace(
        name='Fillet',
        healthState=0,
        isValid=True,
        isGroup=False,
        isSuppressed=False,
        isRolledBack=False,
    )
    group = SimpleNamespace(
        name='Group', isValid=True, isCollapsed=False, count=1, item=lambda index: child
    )
    design = SimpleNamespace(timeline=Timeline([child], [group]))
    baseline = adapter._healthy_timeline_snapshot(design)
    group.name = 'Renamed'
    with pytest.raises(adapter_module.BridgeError):
        adapter._verify_timeline_health(design, baseline)


def test_timeline_marker_change_invalidates_snapshot(adapter_module):
    adapter, _ = make_adapter(adapter_module)
    adapter_module.adsk.fusion.FeatureHealthStates = SimpleNamespace(HealthyFeatureHealthState=0)
    item = SimpleNamespace(
        name='Feature',
        healthState=0,
        isValid=True,
        isGroup=False,
        isSuppressed=False,
        isRolledBack=False,
    )
    design = SimpleNamespace(timeline=Timeline([item]))
    baseline = adapter._healthy_timeline_snapshot(design)
    design.timeline.markerPosition = 0
    with pytest.raises(adapter_module.BridgeError):
        adapter._verify_timeline_health(design, baseline)


@pytest.mark.parametrize('flag', ['isSuppressed', 'isRolledBack'])
def test_expanded_group_child_must_be_computed(adapter_module, flag):
    adapter, _ = make_adapter(adapter_module)
    adapter_module.adsk.fusion.FeatureHealthStates = SimpleNamespace(HealthyFeatureHealthState=0)
    child = SimpleNamespace(
        name='Fillet',
        healthState=0,
        isValid=True,
        isGroup=False,
        isSuppressed=False,
        isRolledBack=False,
    )
    group = SimpleNamespace(
        name='Group', isValid=True, isCollapsed=False, count=1, item=lambda index: child
    )
    design = SimpleNamespace(timeline=Timeline([child], [group]))
    baseline = adapter._healthy_timeline_snapshot(design)
    setattr(child, flag, True)
    with pytest.raises(adapter_module.BridgeError):
        adapter._verify_timeline_health(design, baseline)


@pytest.mark.parametrize('change', ['collapse', 'membership', 'removed'])
def test_group_structure_change_invalidates_snapshot(adapter_module, change):
    adapter, _ = make_adapter(adapter_module)
    adapter_module.adsk.fusion.FeatureHealthStates = SimpleNamespace(HealthyFeatureHealthState=0)
    first = SimpleNamespace(
        name='Extrude',
        healthState=0,
        isValid=True,
        isGroup=False,
        isSuppressed=False,
        isRolledBack=False,
    )
    second = SimpleNamespace(
        name='Fillet',
        healthState=0,
        isValid=True,
        isGroup=False,
        isSuppressed=False,
        isRolledBack=False,
    )
    members = [first, second]
    group = SimpleNamespace(
        name='Group', isValid=True, isCollapsed=False, count=2, item=lambda index: members[index]
    )
    design = SimpleNamespace(timeline=Timeline([first, second], [group]))
    baseline = adapter._healthy_timeline_snapshot(design)
    if change == 'collapse':
        group.isCollapsed = True
    elif change == 'membership':
        members.reverse()
    else:
        design.timeline.timelineGroups.clear()
    with pytest.raises(adapter_module.BridgeError):
        adapter._verify_timeline_health(design, baseline)


def test_calculator_sends_flat_parameter_expression_to_fusion(adapter_module):
    adapter, params = make_adapter(adapter_module)
    params.entries['box_size'] = SimpleNamespace(
        name='box_size', expression='10 mm', unit='mm', value=1.0
    )
    manager = adapter.app.activeProduct.fusionUnitsManager
    manager.evaluateExpression = lambda expr, unit: (
        params.log.append(('evaluate', expr, unit)) or 1.0
    )
    manager.formatValue = lambda value, unit: '10 mm'
    manager.convert = lambda value, source, target: value * 10
    result = adapter.request('calculator.evaluate', {'expression': 'box.size'})
    assert result['value'] == 10
    assert params.log == [('validate', 'box_size', 'mm'), ('evaluate', 'box_size', 'mm')]


def test_dotted_assignment_preview_and_apply_store_flat_name(adapter_module):
    adapter, params = make_adapter(adapter_module)
    text = 'box.inner.size=15'
    preview = adapter.request('parameters.preview', {'text': text})
    assert preview['items'][0]['name'] == 'box_inner_size'
    result = adapter.request(
        'parameters.apply', {'text': text, 'snapshotToken': preview['snapshotToken']}
    )
    assert result['created'] == ['box_inner_size']
    assert params.entries['box_inner_size'].expression == '15 mm'


def test_preview_rejects_unit_name_before_any_model_write(adapter_module):
    adapter, params = make_adapter(adapter_module)
    manager = adapter.app.activeProduct.fusionUnitsManager

    def format_units(name):
        if name == 'l':
            return 'l'
        raise RuntimeError('not a unit')

    manager.formatUnits = format_units
    with pytest.raises(adapter_module.BridgeError, match="'l'.*unit"):
        adapter.request('parameters.preview', {'text': 'box.inner.size=25;l=box.inner.size*2'})
    assert not params.log


def test_dotted_model_parameter_is_not_mistaken_for_new_parameter(adapter_module):
    adapter, params = make_adapter(adapter_module)
    params.entries['box_size'] = SimpleNamespace(
        name='box_size', expression='10 mm', unit='mm', value=1.0
    )
    adapter.app.activeProduct.userParameters = Parameters()
    with pytest.raises(adapter_module.BridgeError, match='cannot be updated'):
        adapter.request('parameters.preview', {'text': 'box.size=25'})


def test_fusion_creation_failure_identifies_parameter(adapter_module):
    adapter, params = make_adapter(adapter_module)

    def reject_name(name, expression, unit, comment):
        raise RuntimeError('param name is not valid')

    params.add = reject_name
    ops = adapter_module.plan_batch('width=25', {}, 'mm')
    with pytest.raises(
        adapter_module.BridgeError, match="parameter 'width'.*param name is not valid"
    ):
        adapter._execute_new_batch(adapter._design(), ops)


def test_relative_update_applies_old_formula_after_rechecking_snapshot(adapter_module):
    adapter, params = make_adapter(adapter_module)
    adapter_module.adsk.fusion.ParameterValueTypes = SimpleNamespace(NumericParameterValueType=0)

    class UserParameter:
        name, unit, valueType = 'box_size', 'mm', 0
        dependencyParameters, dependentParameters = [], []

        def __init__(self):
            self._expression, self.value = '10 mm', 1.0

        @property
        def expression(self):
            return self._expression

        @expression.setter
        def expression(self, expression):
            self._expression, self.value = expression, 1.5

    params.entries['box_size'] = UserParameter()
    payload = {'text': 'box.size+=5'}
    preview = adapter.request('parameters.preview', payload)
    assert preview['items'][0]['expression'] == '(10 mm)+(5 mm)'
    assert preview['items'][0]['value'] == 15
    payload['snapshotToken'] = preview['snapshotToken']
    result = adapter.request('parameters.apply', payload)
    assert result['updated'] == ['box_size']
    assert params.entries['box_size'].expression == '(10 mm)+(5 mm)'


def test_relative_update_rejects_snapshot_changed_since_preview(adapter_module):
    adapter, params = make_adapter(adapter_module)
    adapter_module.adsk.fusion.ParameterValueTypes = SimpleNamespace(NumericParameterValueType=0)
    params.entries['width'] = SimpleNamespace(
        name='width',
        expression='10 mm',
        unit='mm',
        value=1.0,
        valueType=0,
        dependencyParameters=[],
        dependentParameters=[],
    )
    payload = {'text': 'width+=5'}
    payload['snapshotToken'] = adapter.request('parameters.preview', payload)['snapshotToken']
    params.entries['width'].expression = '20 mm'
    params.entries['width'].value = 2.0
    with pytest.raises(adapter_module.BridgeError, match='design changed'):
        adapter.request('parameters.apply', payload)
    assert params.entries['width'].expression == '20 mm'


def test_state_classifies_parameters_and_marks_model_dependents(adapter_module):
    adapter, params = make_adapter(adapter_module)
    user = SimpleNamespace(
        name='width', expression='10 mm', unit='mm', value=1, comment='', dependentParameters=[]
    )
    model = SimpleNamespace(
        name='d12',
        expression='width',
        unit='mm',
        value=1,
        comment='',
        dependentParameters=[],
        createdBy=SimpleNamespace(objectType='adsk::fusion::Sketch'),
    )
    user.dependentParameters = [model]
    params.entries = {'width': user, 'd12': model}
    design = adapter._design()
    design.userParameters = SimpleNamespace(
        itemByName=lambda name: user if name == 'width' else None
    )
    design.fusionUnitsManager.formatValue = lambda value, unit: '10 mm'
    adapter._document = SimpleNamespace(name='Design')
    adapter._design = lambda: design
    state = adapter.state()
    assert [(p['kind'], p['linked']) for p in state['parameters']] == [
        ('user', True),
        ('model', True),
    ]


def test_state_distinguishes_sketch_and_feature_dependents(adapter_module):
    adapter, params = make_adapter(adapter_module)
    sketch = SimpleNamespace(
        name='d1',
        expression='width',
        unit='mm',
        value=1,
        comment='',
        dependentParameters=[],
        createdBy=SimpleNamespace(objectType='adsk::fusion::Sketch'),
    )
    feature = SimpleNamespace(
        name='d2',
        expression='width',
        unit='mm',
        value=1,
        comment='',
        dependentParameters=[],
        createdBy=SimpleNamespace(objectType='adsk::fusion::ExtrudeFeature'),
    )
    user = SimpleNamespace(
        name='width',
        expression='10 mm',
        unit='mm',
        value=1,
        comment='',
        dependentParameters=[sketch, feature],
    )
    params.entries = {'width': user, 'd1': sketch, 'd2': feature}
    design = adapter._design()
    design.userParameters = SimpleNamespace(
        itemByName=lambda name: user if name == 'width' else None
    )
    design.fusionUnitsManager.formatValue = lambda value, unit: '10 mm'
    adapter._document = SimpleNamespace(name='Design')
    adapter._design = lambda: design
    state = adapter.state()
    assert state['parameters'][0]['bindings'] == ['feature', 'sketch']
    assert state['parameters'][1]['bindings'] == ['sketch']
    assert state['parameters'][2]['bindings'] == ['feature']


def test_isolated_unresolved_model_expression_does_not_block_unrelated_update(adapter_module):
    adapter, params = make_adapter(adapter_module)
    adapter_module.adsk.fusion.ParameterValueTypes = SimpleNamespace(NumericParameterValueType=0)

    class ModelParameter:
        name, expression, unit, value, valueType = 'd25', 'missing_name', 'mm', 3.8, 0
        dependencyParameters, dependentParameters = [], []

    adapter_module.adsk.fusion.ModelParameter = SimpleNamespace(
        cast=lambda p: p if isinstance(p, ModelParameter) else None
    )
    user = SimpleNamespace(
        name='width',
        expression='10 mm',
        unit='mm',
        value=1.0,
        valueType=0,
        dependencyParameters=[],
        dependentParameters=[],
    )
    params.entries = {'width': user, 'd25': ModelParameter()}
    adapter.app.activeProduct.userParameters = SimpleNamespace(
        itemByName=lambda name: user if name == 'width' else None
    )
    assert adapter.request('parameters.preview', {'text': 'width=20'})['valid']
    with pytest.raises(Exception):
        adapter.request('parameters.preview', {'text': 'width=missing_name'})
    with pytest.raises(Exception):
        adapter.request('parameters.preview', {'text': 'width=d25'})


def test_delete_parameter_checks_identity_and_reports_fusion_refusal(adapter_module):
    adapter, params = make_adapter(adapter_module)

    class Parameter:
        name = 'width'

        def __init__(self):
            self.result = False
            self.calls = 0

        def deleteMe(self):
            self.calls += 1
            return self.result

    parameter = Parameter()
    params.entries['width'] = parameter
    adapter.app.activeProduct.findEntityByToken = lambda token: (
        [parameter] if token == 'current' else []
    )
    with pytest.raises(adapter_module.BridgeError, match='changed'):
        adapter.request('parameters.delete', {'name': 'width', 'entityToken': 'old'})
    assert parameter.calls == 0
    with pytest.raises(adapter_module.BridgeError, match='Fusion'):
        adapter.request('parameters.delete', {'name': 'width', 'entityToken': 'current'})
    assert parameter.calls == 1
    parameter.result = True
    assert adapter.request('parameters.delete', {'name': 'width', 'entityToken': 'current'}) == {
        'deleted': 'width'
    }


def test_delete_reports_fusion_exception(adapter_module):
    adapter, params = make_adapter(adapter_module)

    class Parameter:
        name = 'width'

        def deleteMe(self):
            raise RuntimeError('Referenced parameter')

    parameter = Parameter()
    params.entries['width'] = parameter
    adapter.app.activeProduct.findEntityByToken = lambda token: [parameter]
    with pytest.raises(adapter_module.BridgeError, match='Referenced parameter'):
        adapter.request('parameters.delete', {'name': 'width', 'entityToken': 'token'})


def test_rename_user_parameter_checks_identity_and_conflicts(adapter_module):
    adapter, params = make_adapter(adapter_module)
    parameter = SimpleNamespace(name='width', expression='10 mm', unit='mm')
    params.entries['width'] = parameter
    adapter._design().findEntityByToken = lambda token: [parameter] if token == 'valid' else []
    with pytest.raises(adapter_module.BridgeError):
        adapter.request(
            'parameters.rename',
            {
                'name': 'width',
                'newName': 'length',
                'entityToken': 'stale',
                'expression': '10 mm',
                'unit': 'mm',
            },
        )
    assert parameter.name == 'width'
    assert adapter.request(
        'parameters.rename',
        {
            'name': 'width',
            'newName': 'length',
            'entityToken': 'valid',
            'expression': '10 mm',
            'unit': 'mm',
        },
    ) == {'renamed': 'length'}
    assert parameter.name == 'length'


def test_state_reports_driven_sketch_dimension(adapter_module):
    adapter, params = make_adapter(adapter_module)
    owner = SimpleNamespace(objectType='adsk::fusion::SketchLinearDimension', isDriving=False)
    param = SimpleNamespace(
        name='d24',
        expression='25 mm',
        unit='mm',
        value=2.5,
        comment='',
        createdBy=owner,
        dependentParameters=[],
        entityToken='token',
    )
    params.entries['d24'] = param
    adapter._design().userParameters = Parameters()
    adapter._design().fusionUnitsManager.formatValue = lambda value, unit: '25 mm'
    adapter.app.activeDocument = SimpleNamespace(name='test')
    result = adapter.state()
    assert result['parameters'][0]['driven'] is True


def test_driven_dimension_cannot_be_edited_through_adapter(adapter_module):
    adapter, params = make_adapter(adapter_module)
    parameter = SimpleNamespace(
        name='d24',
        createdBy=SimpleNamespace(
            objectType='adsk::fusion::SketchLinearDimension', isDriving=False
        ),
    )
    params.entries['d24'] = parameter
    adapter._design().userParameters = Parameters()
    adapter_module.adsk.fusion.ModelParameter.cast = lambda p: p
    assert adapter._editable_parameter(adapter._design(), 'd24') is None


def test_sketch_owner_resolves_driven_dimension_by_parameter_identity(adapter_module):
    adapter, params = make_adapter(adapter_module)
    parameter = SimpleNamespace(name='d24')
    other = SimpleNamespace(name='d25')
    parameter.createdBy = SimpleNamespace(
        objectType='adsk::fusion::Sketch',
        sketchDimensions=[
            SimpleNamespace(parameter=other, isDriving=True),
            SimpleNamespace(parameter=parameter, isDriving=False),
        ],
    )
    params.entries['d24'] = parameter
    adapter._design().userParameters = Parameters()
    adapter_module.adsk.fusion.ModelParameter.cast = lambda p: p
    assert adapter_module._is_driven(parameter)
    assert adapter._editable_parameter(adapter._design(), 'd24') is None


def test_rename_named_model_parameter(adapter_module):
    adapter, params = make_adapter(adapter_module)
    parameter = SimpleNamespace(name='champher', expression='5 mm', unit='mm')
    params.entries['champher'] = parameter
    adapter._design().userParameters = Parameters()
    adapter._design().findEntityByToken = lambda token: [parameter]
    adapter_module.adsk.fusion.ModelParameter.cast = lambda p: p
    result = adapter.request(
        'parameters.rename',
        {
            'name': 'champher',
            'newName': 'chamfer',
            'entityToken': 'valid',
            'expression': '5 mm',
            'unit': 'mm',
        },
    )
    assert result == {'renamed': 'chamfer'}
    assert parameter.name == 'chamfer'


def test_atomic_batch_is_refused_in_direct_apply_context(adapter_module):
    adapter, params = make_adapter(adapter_module)
    adapter.in_command = False
    adapter.in_direct_apply = True
    params.entries['width'] = SimpleNamespace(
        name='width', expression='10 mm', unit='mm', value=1.0
    )
    text = 'x=25 mm;width=x'
    token = adapter._snapshot_token(adapter._design(), text)
    with pytest.raises(adapter_module.BridgeError) as error:
        adapter.request(
            'parameters.apply', {'text': text, 'snapshotToken': token, 'requireTransaction': True}
        )
    assert error.value.code == 'TRANSACTION_REQUIRED'
    assert list(params.entries) == ['width']


def test_preview_rejects_changed_source_value_before_planning(adapter_module, monkeypatch):
    adapter, params = make_adapter(adapter_module)
    params.entries['width'] = SimpleNamespace(name='width', unit='mm', value=1.2345678901234567)
    monkeypatch.setattr(
        adapter, '_plan', lambda text: pytest.fail('stale value must not be planned')
    )
    with pytest.raises(adapter_module.BridgeError) as error:
        adapter.request(
            'parameters.preview',
            {'text': 'x=1 cm;width=x', 'sourceName': 'width', 'sourceValueExpression': '1.0 cm'},
        )
    assert error.value.code == 'CONFLICT'


def test_value_expression_uses_unrounded_internal_values(adapter_module):
    assert (
        adapter_module._value_expression(SimpleNamespace(unit='mm', value=1.2345678901234567))
        == '12.345678901234567 mm'
    )
    assert (
        adapter_module._value_expression(SimpleNamespace(unit='deg', value=1.0471975511965976))
        == '60.0 deg'
    )
    assert adapter_module._value_expression(SimpleNamespace(unit='rad', value=0.125)) == '0.125 rad'
    assert adapter_module._value_expression(SimpleNamespace(unit='', value=2.0)) == '2.0n'


def test_equation_preview_plans_solved_new_parameter_and_target(adapter_module, monkeypatch):
    adapter, params = make_adapter(adapter_module)
    params.entries['d24'] = SimpleNamespace(name='d24', expression='50 mm', unit='mm', value=5.0)
    monkeypatch.setattr(adapter, '_quantities', lambda design: {})
    monkeypatch.setattr(
        adapter,
        '_plan',
        lambda text: (
            adapter._design(),
            [
                SimpleNamespace(
                    name='width',
                    status='New',
                    expression='-250.0 mm',
                    quantity=adapter_module.Quantity(-250, adapter_module.LENGTH),
                    unit='mm',
                ),
                SimpleNamespace(
                    name='d24',
                    status='Update',
                    expression='-width/5',
                    quantity=adapter_module.Quantity(50, adapter_module.LENGTH),
                    unit='mm',
                ),
            ],
        ),
    )
    result = adapter.request(
        'parameters.preview', {'inlineEquation': {'target': 'd24', 'expression': '-width/5=50'}}
    )
    assert result['resolvedText'] == 'width=-250.0 mm;d24=-width/5'
    assert result['newName'] == 'width'
    assert result['snapshotToken']
