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
    adsk.core, adsk.fusion = core, fusion
    for name, module in [('adsk', adsk), ('adsk.core', core), ('adsk.fusion', fusion)]:
        monkeypatch.setitem(sys.modules, name, module)
    sys.modules.pop('ParaMod.fusion.adapter', None)
    module = importlib.import_module('ParaMod.fusion.adapter')
    yield module
    sys.modules.pop('ParaMod.fusion.adapter', None)


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
        self.entries[name] = SimpleNamespace(name=name, expression=expression, unit=unit, value=values.get(expression, 0))
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
    design = SimpleNamespace(allParameters=params, userParameters=params, fusionUnitsManager=Units(params))
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
        ('validate', '10 mm', 'mm'), ('add', 'h', '10 mm', 'mm'),
        ('validate', 'h/2', 'mm'), ('add', 'l', 'h/2', 'mm'),
        ('validate', '15 mm', 'mm'), ('add', 'w', '15 mm', 'mm'),
        ('validate', '5', ''), ('add', 'count', '5', ''),
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
    params.entries['external'] = SimpleNamespace(name='external', expression='1 mm', unit='mm', value=0.1)
    with pytest.raises(adapter_module.BridgeError) as error:
        adapter.request('parameters.apply', {'text': text, 'snapshotToken': token})
    assert error.value.code == 'STALE_PREVIEW'
    assert params.log == []


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
    result = adapter.request('parameters.apply', {'text': text, 'snapshotToken': preview['snapshotToken']})
    assert result['created'] == ['h', 'l', 'w', 'count']
    assert params.entries['l'].expression == 'h/2'


def test_batch_rejects_unverified_existing_parameter_before_any_write(adapter_module):
    adapter, params = make_adapter(adapter_module)
    params.entries['existing'] = SimpleNamespace(name='existing', expression='10 mm', unit='mm', value=1.0)
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
    from ParaMod.core.expressions import ExpressionError, plan_batch_snapshot
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
    a = SimpleNamespace(name='a', expression='10 mm', unit='mm', value=float('nan'), valueType=0,
                        dependencyParameters=[], dependentParameters=[])
    params.entries = {'a': a}
    with pytest.raises(adapter_module.BridgeError):
        adapter._dependency_snapshot(adapter._design())
    a.value = 1.0
    wrong_a = SimpleNamespace(name='a', expression='20 mm', unit='mm', value=2.0, valueType=0)
    b = SimpleNamespace(name='b', expression='a/2', unit='mm', value=0.5, valueType=0,
                        dependencyParameters=[wrong_a], dependentParameters=[])
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
    result = adapter.request('parameters.apply', {'text': 'width=20', 'snapshotToken': preview['snapshotToken']})
    assert result['updated'] == ['width']
    assert params.entries['width'].expression == '20 mm'


def test_update_cannot_modify_model_parameter(adapter_module):
    adapter, params = make_adapter(adapter_module)
    adapter_module.adsk.fusion.ParameterValueTypes = SimpleNamespace(NumericParameterValueType=0)
    params.entries['model_width'] = SimpleNamespace(name='model_width', expression='10 mm', unit='mm', value=1.0,
                                                    valueType=0, dependencyParameters=[], dependentParameters=[])
    adapter.app.activeProduct.userParameters = Parameters()
    with pytest.raises(adapter_module.BridgeError):
        adapter.request('parameters.preview', {'text': 'model_width=20'})
    assert params.entries['model_width'].expression == '10 mm'


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
    result = adapter.request('parameters.apply', {'text': 'a=20', 'snapshotToken': preview['snapshotToken']})
    assert result['updated'] == ['a']
    assert (a.expression, a.value, dimension.value, feature.healthState) == ('20 mm', 2.0, 1.0, 2)


def test_update_rejects_a_changed_parameter_after_preview(adapter_module):
    adapter, params = make_adapter(adapter_module)
    adapter_module.adsk.fusion.ParameterValueTypes = SimpleNamespace(NumericParameterValueType=0)
    p = SimpleNamespace(name='a', expression='10 mm', unit='mm', value=1.0, valueType=0,
                        dependencyParameters=[], dependentParameters=[])
    params.entries['a'] = p
    preview = adapter.request('parameters.preview', {'text': 'a=20'})
    p.expression, p.value = '15 mm', 1.5
    with pytest.raises(adapter_module.BridgeError) as error:
        adapter.request('parameters.apply', {'text': 'a=20', 'snapshotToken': preview['snapshotToken']})
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
    result = adapter.request('parameters.apply', {'text': 'a=20', 'snapshotToken': preview['snapshotToken']})
    assert result['updated'] == ['a']
    assert (a.expression, b.value, dim.value) == ('20 mm', 1.0, 1.0)


def test_timeline_health_requires_stable_healthy_items(adapter_module):
    adapter, _ = make_adapter(adapter_module)
    adapter_module.adsk.fusion.FeatureHealthStates = SimpleNamespace(HealthyFeatureHealthState=0)
    sketch = SimpleNamespace(name='Sketch', healthState=0, isValid=True,
                             isGroup=False, isSuppressed=False, isRolledBack=False)
    feature = SimpleNamespace(name='Fillet', healthState=0, isValid=True,
                              isGroup=False, isSuppressed=False, isRolledBack=False)
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
    for timeline in ([], [SimpleNamespace(name='Unknown', healthState=5, isValid=True,
                                           isGroup=False, isSuppressed=False, isRolledBack=False)],
                     [SimpleNamespace(name='Missing', isValid=True)]):
        with pytest.raises(adapter_module.BridgeError):
            adapter._healthy_timeline_snapshot(SimpleNamespace(timeline=Timeline(timeline)))


def test_collapsed_timeline_group_checks_its_children(adapter_module):
    adapter, _ = make_adapter(adapter_module)
    adapter_module.adsk.fusion.FeatureHealthStates = SimpleNamespace(HealthyFeatureHealthState=0)
    child = SimpleNamespace(name='Fillet', healthState=0, isValid=True,
                            isGroup=False, isSuppressed=False, isRolledBack=False)
    group = SimpleNamespace(name='Group', healthState=5, isValid=True, isGroup=True,
                            isSuppressed=False, isRolledBack=False, isCollapsed=True,
                            count=1, item=lambda index: child)
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
    item = SimpleNamespace(name='Feature', healthState=0, isValid=True, isGroup=False,
                           isSuppressed=False, isRolledBack=False)
    setattr(item, flag, True)
    with pytest.raises(adapter_module.BridgeError):
        adapter._healthy_timeline_snapshot(SimpleNamespace(timeline=Timeline([item])))


def test_expanded_group_change_invalidates_timeline_snapshot(adapter_module):
    adapter, _ = make_adapter(adapter_module)
    adapter_module.adsk.fusion.FeatureHealthStates = SimpleNamespace(HealthyFeatureHealthState=0)
    child = SimpleNamespace(name='Fillet', healthState=0, isValid=True, isGroup=False,
                            isSuppressed=False, isRolledBack=False)
    group = SimpleNamespace(name='Group', isValid=True, isCollapsed=False, count=1,
                            item=lambda index: child)
    design = SimpleNamespace(timeline=Timeline([child], [group]))
    baseline = adapter._healthy_timeline_snapshot(design)
    group.name = 'Renamed'
    with pytest.raises(adapter_module.BridgeError):
        adapter._verify_timeline_health(design, baseline)


def test_timeline_marker_change_invalidates_snapshot(adapter_module):
    adapter, _ = make_adapter(adapter_module)
    adapter_module.adsk.fusion.FeatureHealthStates = SimpleNamespace(HealthyFeatureHealthState=0)
    item = SimpleNamespace(name='Feature', healthState=0, isValid=True, isGroup=False,
                           isSuppressed=False, isRolledBack=False)
    design = SimpleNamespace(timeline=Timeline([item]))
    baseline = adapter._healthy_timeline_snapshot(design)
    design.timeline.markerPosition = 0
    with pytest.raises(adapter_module.BridgeError):
        adapter._verify_timeline_health(design, baseline)


@pytest.mark.parametrize('flag', ['isSuppressed', 'isRolledBack'])
def test_expanded_group_child_must_be_computed(adapter_module, flag):
    adapter, _ = make_adapter(adapter_module)
    adapter_module.adsk.fusion.FeatureHealthStates = SimpleNamespace(HealthyFeatureHealthState=0)
    child = SimpleNamespace(name='Fillet', healthState=0, isValid=True, isGroup=False,
                            isSuppressed=False, isRolledBack=False)
    group = SimpleNamespace(name='Group', isValid=True, isCollapsed=False, count=1,
                            item=lambda index: child)
    design = SimpleNamespace(timeline=Timeline([child], [group]))
    baseline = adapter._healthy_timeline_snapshot(design)
    setattr(child, flag, True)
    with pytest.raises(adapter_module.BridgeError):
        adapter._verify_timeline_health(design, baseline)


@pytest.mark.parametrize('change', ['collapse', 'membership', 'removed'])
def test_group_structure_change_invalidates_snapshot(adapter_module, change):
    adapter, _ = make_adapter(adapter_module)
    adapter_module.adsk.fusion.FeatureHealthStates = SimpleNamespace(HealthyFeatureHealthState=0)
    first = SimpleNamespace(name='Extrude', healthState=0, isValid=True, isGroup=False,
                            isSuppressed=False, isRolledBack=False)
    second = SimpleNamespace(name='Fillet', healthState=0, isValid=True, isGroup=False,
                             isSuppressed=False, isRolledBack=False)
    members = [first, second]
    group = SimpleNamespace(name='Group', isValid=True, isCollapsed=False, count=2,
                            item=lambda index: members[index])
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
    params.entries['box_size'] = SimpleNamespace(name='box_size', expression='10 mm', unit='mm', value=1.0)
    manager = adapter.app.activeProduct.fusionUnitsManager
    manager.evaluateExpression = lambda expr, unit: params.log.append(('evaluate', expr, unit)) or 1.0
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
    result = adapter.request('parameters.apply', {'text': text, 'snapshotToken': preview['snapshotToken']})
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
    params.entries['box_size'] = SimpleNamespace(name='box_size', expression='10 mm', unit='mm', value=1.0)
    adapter.app.activeProduct.userParameters = Parameters()
    with pytest.raises(adapter_module.BridgeError, match='Only user parameters'):
        adapter.request('parameters.preview', {'text': 'box.size=25'})


def test_fusion_creation_failure_identifies_parameter(adapter_module):
    adapter, params = make_adapter(adapter_module)
    def reject_name(name, expression, unit, comment):
        raise RuntimeError('param name is not valid')
    params.add = reject_name
    ops = adapter_module.plan_batch('width=25', {}, 'mm')
    with pytest.raises(adapter_module.BridgeError, match="parameter 'width'.*param name is not valid"):
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
    params.entries['width'] = SimpleNamespace(name='width', expression='10 mm', unit='mm', value=1.0,
                                              valueType=0, dependencyParameters=[], dependentParameters=[])
    payload = {'text': 'width+=5'}
    payload['snapshotToken'] = adapter.request('parameters.preview', payload)['snapshotToken']
    params.entries['width'].expression = '20 mm'
    params.entries['width'].value = 2.0
    with pytest.raises(adapter_module.BridgeError, match='design changed'):
        adapter.request('parameters.apply', payload)
    assert params.entries['width'].expression == '20 mm'
