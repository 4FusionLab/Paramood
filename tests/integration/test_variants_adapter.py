import copy
import importlib
import json
import sys
import types
from types import SimpleNamespace

import pytest

from Paramood.bridge.protocol import dispatch


class Attributes:
    def __init__(self):
        self.values = {}
        self.fail = False

    @property
    def value(self):
        return self.values.get('variants.v2')

    @value.setter
    def value(self, value):
        self.values['variants.v2'] = value

    def itemByName(self, group, name):
        value = self.values.get(name)
        return SimpleNamespace(value=value) if value is not None else None

    def add(self, group, name, value):
        if self.fail:
            return None
        self.values[name] = value
        return SimpleNamespace(value=value)


class Parameters(list):
    def itemByName(self, name):
        return next((p for p in self if p.name == name), None)


@pytest.fixture
def model(monkeypatch):
    adsk = types.ModuleType('adsk')
    core, fusion = types.ModuleType('adsk.core'), types.ModuleType('adsk.fusion')
    core.ValueInput = SimpleNamespace(createByString=lambda value: value)
    fusion.Design = SimpleNamespace(cast=lambda product: product)
    fusion.ModelParameter = SimpleNamespace(cast=lambda parameter: None)
    fusion.ParameterValueTypes = SimpleNamespace(
        NumericParameterValueType=0, TextParameterValueType=1
    )
    adsk.core, adsk.fusion = core, fusion
    for name, module in [('adsk', adsk), ('adsk.core', core), ('adsk.fusion', fusion)]:
        monkeypatch.setitem(sys.modules, name, module)
    sys.modules.pop('Paramood.fusion.adapter', None)
    sys.modules.pop('Paramood.fusion.variants', None)
    sys.modules.pop('Paramood.fusion.variant_table', None)
    module = importlib.import_module('Paramood.fusion.adapter')
    params = Parameters(
        [
            SimpleNamespace(
                name=name,
                entityToken='token-' + name,
                expression='10 mm',
                unit='mm',
                value=1.0,
                valueType=0,
                dependencyParameters=[],
                dependentParameters=[],
            )
            for name in ('width', 'height')
        ]
    )
    calls = []

    def modify(parameters, expressions):
        calls.append(list(expressions))
        if any(expression == 'reject' for expression in expressions):
            return False
        for parameter, expression in zip(parameters, expressions):
            parameter.expression = expression
            parameter.value = float(expression.split()[0]) / 10
        return True

    design = SimpleNamespace(
        attributes=Attributes(),
        allParameters=params,
        userParameters=params,
        fusionUnitsManager=SimpleNamespace(
            defaultLengthUnits='mm',
            formatUnits=lambda name: '',
            isValidExpression=lambda expression, unit: expression != 'invalid',
        ),
        findEntityByToken=lambda token: [p for p in params if p.entityToken == token],
        modifyParameters=modify,
    )
    app = SimpleNamespace(activeDocument=SimpleNamespace(name='Temporary'), activeProduct=design)
    adapter = module.FusionAdapter(app)
    adapter.in_command = True
    adapter._design()
    yield adapter, design, params, calls
    sys.modules.pop('Paramood.fusion.adapter', None)
    sys.modules.pop('Paramood.fusion.variants', None)
    sys.modules.pop('Paramood.fusion.variant_table', None)


def send(adapter, action, **payload):
    state = adapter._variants_state(adapter._design())
    body = {
        'variantsToken': state.get('variantsToken'),
        'snapshotToken': state.get('variantSnapshotToken'),
        **payload,
    }
    return adapter.request(action, body)


def table_save(adapter, params, expressions=('20 mm', '30 mm')):
    columns = [
        dict(
            kind='parameter',
            **{k: adapter._variant_entry(p)[k] for k in ('name', 'entityToken', 'unit')},
        )
        for p in params
    ]
    rows = [
        dict(
            name='Compact',
            parameters=[
                dict(adapter._variant_entry(p), expression=e) for p, e in zip(params, expressions)
            ],
        )
    ]
    send(adapter, 'variants.table.save', columns=columns, variants=rows)
    return json.loads(adapter._design().attributes.value)


def test_table_save_plans_all_cells_without_changing_or_activating_model(model):
    adapter, design, params, calls = model
    table = table_save(adapter, params)
    assert table['version'] == 2
    assert [p['value'] for p in table['variants'][0]['parameters']] == [2, 3]
    assert [p.expression for p in params] == ['10 mm', '10 mm']
    assert not calls
    assert adapter._variants_state(design)['activeVariantId'] is None
    send(adapter, 'variants.apply', id=table['variants'][0]['id'])
    assert [p.value for p in params] == [2, 3]


def test_save_applies_only_active_row_after_validating_every_row(model):
    adapter, design, params, calls = model
    table = table_save(adapter, params)
    row = table['variants'][0]
    send(adapter, 'variants.apply', id=row['id'])
    row['parameters'][0]['expression'] = '50 mm'
    other = dict(copy.deepcopy(row), id=None, name='Other')
    other['parameters'][0]['expression'] = '90 mm'
    send(adapter, 'variants.table.save', columns=table['columns'], variants=[other, row])
    assert params[0].value == 5
    assert adapter._variants_state(design)['activeVariantId'] == row['id']
    assert len(calls) == 2
    raw = design.attributes.value
    other['parameters'][0]['expression'] = 'unknown_variable'
    row['parameters'][0]['expression'] = '60 mm'
    with pytest.raises(Exception):
        send(adapter, 'variants.table.save', columns=table['columns'], variants=[other, row])
    assert params[0].value == 5 and design.attributes.value == raw
    assert len(calls) == 2


def test_active_row_save_storage_failure_restores_model_and_metadata(model):
    adapter, design, params, calls = model
    table = table_save(adapter, params)
    row = table['variants'][0]
    send(adapter, 'variants.apply', id=row['id'])
    raw = design.attributes.value
    row['parameters'][0]['expression'] = '50 mm'
    design.attributes.fail = True
    with pytest.raises(Exception, match='save variants'):
        send(adapter, 'variants.table.save', columns=table['columns'], variants=[row])
    assert params[0].value == 2 and design.attributes.value == raw


def test_reordering_active_variant_cells_does_not_recompute_cad(model):
    adapter, design, params, calls = model
    table = table_save(adapter, params)
    row = table['variants'][0]
    send(adapter, 'variants.apply', id=row['id'])
    row['parameters'].reverse()
    send(adapter, 'variants.table.save', columns=list(reversed(table['columns'])), variants=[row])
    assert len(calls) == 1
    assert [c['name'] for c in json.loads(design.attributes.value)['columns']] == [
        'height',
        'width',
    ]


def test_table_formulas_use_each_rows_proposed_values(model):
    adapter, design, params, calls = model
    table = table_save(adapter, params, ('20 mm', 'width / 2'))
    assert table['variants'][0]['parameters'][1]['value'] == 1
    assert not calls


def test_table_global_set_and_row_column_order_survive_edits(model):
    adapter, design, params, calls = model
    table = table_save(adapter, params)
    first = table['variants'][0]
    second = dict(copy.deepcopy(first), id=None, name='Garden')
    columns = list(reversed(table['columns']))
    for row in (first, second):
        row['parameters'].reverse()
    send(adapter, 'variants.table.save', columns=columns, variants=[second, first])
    stored = json.loads(design.attributes.value)
    assert [r['name'] for r in stored['variants']] == ['Garden', 'Compact']
    assert [c['name'] for c in stored['columns']] == ['height', 'width']
    assert not calls


def test_table_rejects_missing_cells_duplicate_names_and_foreign_ids_atomically(model):
    adapter, design, params, calls = model
    table = table_save(adapter, params)
    raw = design.attributes.value
    for problem in ('cell', 'name', 'id'):
        rows = copy.deepcopy(table['variants'])
        if problem == 'cell':
            rows[0]['parameters'].pop()
        elif problem == 'name':
            rows.append(dict(copy.deepcopy(rows[0]), id=None, name=rows[0]['name'].upper()))
        else:
            rows[0]['id'] = 'foreign'
        with pytest.raises(Exception):
            send(adapter, 'variants.table.save', columns=table['columns'], variants=rows)
        assert design.attributes.value == raw
    assert not calls


def test_table_capture_updates_configured_only_and_preserves_column_identity(model):
    adapter, design, params, calls = model
    table = table_save(adapter, params[:1], ('20 mm',))
    identity = table['variants'][0]['id']
    send(adapter, 'variants.apply', id=identity)
    context = adapter._variant_edit_context(design)
    params[0].expression, params[0].value = '40 mm', 4
    params[1].expression, params[1].value = '50 mm', 5
    adapter._capture_variant_edits(design, context, ['width', 'height'])
    stored = json.loads(design.attributes.value)
    assert len(stored['columns']) == 1
    assert [p['name'] for p in stored['variants'][0]['parameters']] == ['width']
    assert stored['variants'][0]['parameters'][0]['value'] == 4
    assert params[1].value == 5


def test_outside_set_edit_never_writes_variant_metadata(model):
    adapter, design, params, calls = model
    table = table_save(adapter, params[:1], ('20 mm',))
    send(adapter, 'variants.apply', id=table['variants'][0]['id'])
    raw = design.attributes.value
    context = adapter._variant_edit_context(design)
    design.attributes.fail = True
    params[1].expression, params[1].value = '60 mm', 6
    adapter._capture_variant_edits(design, context, ['height'])
    assert params[1].value == 6 and design.attributes.value == raw


def test_cell_cannot_inject_assignments_to_other_model_parameters(model):
    adapter, design, params, calls = model
    with pytest.raises(Exception):
        table_save(adapter, params[:1], ('20 mm; height=80 mm',))
    assert not calls and design.attributes.value is None


def test_bare_cell_number_uses_parameter_unit_instead_of_design_default(model):
    adapter, design, params, calls = model
    design.fusionUnitsManager.defaultLengthUnits = 'cm'
    table = table_save(adapter, params[:1], ('20',))
    assert table['variants'][0]['parameters'][0]['value'] == 2


def test_timeline_selection_is_read_only_and_rejects_foreign_and_nonfeature_entities(model):
    adapter, design, params, calls = model
    parent, child, log = features_model(model)
    foreign = Feature('Foreign', log)
    selected = [SimpleNamespace(entity=e) for e in (parent, parent, foreign, params[0])]
    adapter.app.userInterface = SimpleNamespace(
        activeCommand='SelectCommand',
        activeSelections=SimpleNamespace(count=len(selected), item=lambda index: selected[index]),
    )
    adapter.in_command = adapter.in_direct_apply = False
    state = adapter.request('variants.selection.get', {})
    assert state['documentId'] == adapter.document_id
    assert [f['name'] for f in state['features']] == ['Parent']
    assert design.attributes.value is None and not log and not calls
    adapter.app.userInterface.activeCommand = 'Extrude'
    with pytest.raises(Exception, match='Finish'):
        adapter.request('variants.selection.get', {})


class Feature:
    def __init__(self, name, log, enabled=True):
        self.name, self.entityToken = name, 'feature-' + name
        self.isValid = self.isParametric = True
        self._suppressed, self.log = not enabled, log
        self.reject_suppress = False

    @property
    def isSuppressed(self):
        return self._suppressed

    @isSuppressed.setter
    def isSuppressed(self, value):
        if value and self.reject_suppress:
            raise RuntimeError('suppression refused')
        self.log.append((self.name, value))
        self._suppressed = value


def features_model(model):
    adapter, design, params, calls = model
    log = []
    parent, child = Feature('Parent', log), Feature('Child', log)
    sys.modules['adsk.fusion'].Feature = SimpleNamespace(
        cast=lambda entity: entity if isinstance(entity, Feature) else None
    )
    items = [SimpleNamespace(isGroup=False, entity=f) for f in (parent, child)]
    design.timeline = SimpleNamespace(count=2, item=lambda i: items[i])
    find = design.findEntityByToken
    design.findEntityByToken = lambda token: (
        [f for f in (parent, child) if f.entityToken == token and f.isValid] or find(token)
    )
    return parent, child, log


def test_feature_only_table_and_suppression_follow_timeline_not_table_order(model):
    adapter, design, params, calls = model
    parent, child, log = features_model(model)
    columns = [
        dict(kind='feature', name=f.name, entityToken=f.entityToken) for f in (child, parent)
    ]
    cells = [dict(adapter._feature_entry(f), enabled=False) for f in (child, parent)]
    send(
        adapter,
        'variants.table.save',
        columns=columns,
        variants=[dict(name='Off', parameters=[], features=cells)],
    )
    assert not log and not calls
    identity = adapter._variants_state(design)['variants'][0]['id']
    send(adapter, 'variants.apply', id=identity)
    assert log == [('Child', True), ('Parent', True)]
    assert adapter._variants_state(design)['activeVariantId'] == identity
    parent.isSuppressed = False
    assert adapter._variants_state(design)['activeVariantId'] is None


def test_external_feature_edit_invalidates_table_request_and_removed_identity_never_rebinds(model):
    adapter, design, params, calls = model
    parent, child, log = features_model(model)
    state = adapter._variants_state(design)
    parent.isSuppressed = True
    with pytest.raises(Exception, match='changed'):
        adapter.request(
            'variants.table.save',
            dict(
                columns=[],
                variants=[],
                variantsToken=state['variantsToken'],
                snapshotToken=state['variantSnapshotToken'],
            ),
        )
    parent.isValid = False
    assert adapter._resolve_variant_feature(design, dict(entityToken=parent.entityToken)) is None


def test_partial_feature_failure_restores_parameters_and_suppression(model):
    adapter, design, params, calls = model
    parent, child, log = features_model(model)
    child.reject_suppress = True
    table = table_save(adapter, params[:1], ('20 mm',))
    columns = table['columns'] + [
        dict(kind='feature', name=child.name, entityToken=child.entityToken)
    ]
    row = table['variants'][0]
    row['features'] = [dict(adapter._feature_entry(child), enabled=False)]
    send(adapter, 'variants.table.save', columns=columns, variants=[row])
    with pytest.raises(Exception, match='suppression refused'):
        send(adapter, 'variants.apply', id=row['id'])
    assert params[0].expression == '10 mm'
    assert not child.isSuppressed and not parent.isSuppressed


def test_collapsed_timeline_groups_keep_feature_order(model):
    adapter, design, params, calls = model
    parent, child, log = features_model(model)
    children = [SimpleNamespace(isGroup=False, entity=f) for f in (parent, child)]
    group = SimpleNamespace(isGroup=True, count=2, item=lambda i: children[i])
    design.timeline = SimpleNamespace(count=1, item=lambda i: group)
    adapter._set_feature_states([(child, False), (parent, False)])
    assert log == [('Child', True), ('Parent', True)]


def test_major_version_two_ignores_and_preserves_old_attribute(model):
    adapter, design, params, calls = model
    design.attributes.values['variants.v1'] = 'legacy data must stay untouched'
    assert adapter._variants_state(design)['variants'] == []
    table_save(adapter, params)
    assert design.attributes.values['variants.v1'] == 'legacy data must stay untouched'
    assert json.loads(design.attributes.values['variants.v2'])['version'] == 2


def test_table_switch_free_external_edits_and_reopen(model):
    adapter, design, params, calls = model
    table = table_save(adapter, params)
    identity = table['variants'][0]['id']
    send(adapter, 'variants.apply', id=identity)
    assert adapter._variants_state(design)['activeVariantId'] == identity
    send(adapter, 'variants.free')
    assert [p.value for p in params] == [2, 3]
    assert adapter._variants_state(design)['activeVariantId'] is None
    adapter._variant_sessions.clear()
    assert adapter._variants_state(design)['activeVariantId'] == identity
    params[0].value = 9
    assert adapter._variants_state(design)['activeVariantId'] is None


def test_same_name_replacement_never_binds_and_deleted_variant_keeps_parameters(model):
    adapter, design, params, calls = model
    table = table_save(adapter, params[:1], ('20 mm',))
    identity = table['variants'][0]['id']
    original = params[0]
    params[0] = copy.copy(original)
    params[0].entityToken = 'replacement'
    assert adapter._variants_state(design)['variants'][0]['parameters'][0]['missing']
    with pytest.raises(Exception, match='unavailable'):
        send(adapter, 'variants.apply', id=identity)
    send(adapter, 'variants.delete', id=identity)
    assert len(params) == 2
    assert not calls


def test_corrupt_v2_storage_is_preserved_and_foreign_document_rejected(model):
    adapter, design, params, calls = model
    design.attributes.value = 'broken'
    assert adapter._variants_state(design)['variantsError']
    with pytest.raises(Exception, match='preserved'):
        send(adapter, 'variants.table.save', columns=[], variants=[])
    result = dispatch(
        adapter,
        dict(requestId='wrong-doc', action='variants.table.save', documentId='other', payload={}),
    )
    assert result['error']['code'] == 'STALE_DOCUMENT'
    assert design.attributes.value == 'broken' and not calls


def test_table_storage_failure_does_not_change_model_and_active_capture_restores_direct_edits(
    model, monkeypatch
):
    adapter, design, params, calls = model
    design.attributes.fail = True
    with pytest.raises(Exception, match='save variants'):
        table_save(adapter, params)
    assert not calls and [p.value for p in params] == [1, 1]
    design.attributes.fail = False
    table = table_save(adapter, params[:1], ('20 mm',))
    send(adapter, 'variants.apply', id=table['variants'][0]['id'])
    raw = design.attributes.value
    adapter.in_command, adapter.in_direct_apply = False, True
    design.attributes.fail = True
    op = SimpleNamespace(name='width', status='Update')

    def execute(design, ops):
        params[0].expression, params[0].value = '40 mm', 4
        return {'created': [], 'updated': ['width']}

    monkeypatch.setattr(adapter, '_execute_direct_batch', execute)
    with pytest.raises(Exception, match='save variants'):
        adapter._execute_tracked_parameters(design, [op])
    assert params[0].expression == '20 mm' and params[0].value == 2
    assert design.attributes.value == raw
    assert adapter._variants_state(design)['activeVariantId'] == table['variants'][0]['id']


def save(adapter, params):
    table = table_save(adapter, params[:1], (params[0].expression,))
    identity = table['variants'][0]['id']
    send(adapter, 'variants.apply', id=identity)
    return identity


def test_parameter_preview_rejected_after_variant_selection_changes(model):
    adapter, design, params, calls = model
    save(adapter, params)
    old = adapter._snapshot_token(design, 'width=20')
    send(adapter, 'variants.free')
    assert old != adapter._snapshot_token(design, 'width=20')
    response = dispatch(
        adapter,
        {
            'requestId': 'stale',
            'action': 'parameters.apply',
            'documentId': adapter.document_id,
            'payload': {'text': 'width=20', 'snapshotToken': old},
        },
    )
    assert response['error']['code'] == 'STALE_PREVIEW'


def test_model_units_require_fresh_snapshot_and_preserve_variant(model, monkeypatch):
    adapter, design, params, calls = model
    identity = save(adapter, params)
    enum = SimpleNamespace(
        MillimeterDistanceUnits=0,
        CentimeterDistanceUnits=1,
        MeterDistanceUnits=2,
        InchDistanceUnits=3,
        FootDistanceUnits=4,
    )
    monkeypatch.setattr(sys.modules['adsk.fusion'], 'DistanceUnits', enum, raising=False)

    class ModelUnits:
        defaultLengthUnits = 'mm'

        def isValidExpression(self, expression, unit):
            return True

        @property
        def distanceDisplayUnits(self):
            return self._units

        @distanceDisplayUnits.setter
        def distanceDisplayUnits(self, value):
            self._units = value
            self.defaultLengthUnits = {0: 'mm', 1: 'cm', 2: 'm', 3: 'in', 4: 'ft'}[value]

    design.fusionUnitsManager = ModelUnits()
    snapshot = adapter._snapshot_token(design, 'units')
    assert adapter.request('document.units', {'unit': 'in', 'snapshotToken': snapshot}) == {
        'defaultLengthUnit': 'in'
    }
    assert params[0].expression == '10 mm' and params[0].value == 1
    assert adapter._variants_state(design)['activeVariantId'] == identity
    with pytest.raises(Exception, match='changed'):
        adapter.request('document.units', {'unit': 'cm', 'snapshotToken': snapshot})
    with pytest.raises(Exception, match='supported'):
        adapter.request(
            'document.units',
            {'unit': 'not-units', 'snapshotToken': adapter._snapshot_token(design, 'units')},
        )


def test_variant_identity_survives_compatible_model_unit_changes(model):
    adapter, design, params, calls = model
    identity = save(adapter, params)
    design.fusionUnitsManager.isValidExpression = lambda expression, unit: (
        expression == '1 mm' and unit in {'mm', 'cm', 'in'}
    )
    params[0].unit = 'in'
    assert adapter._variants_state(design)['activeVariantId'] == identity
    assert not adapter._variants_state(design)['variants'][0]['parameters'][0]['missing']
    params[0].unit = 'deg'
    assert adapter._variants_state(design)['variants'][0]['parameters'][0]['missing']


def test_random_variant_matches_its_expression_after_recompute(model):
    adapter, design, params, _ = model
    params[0].expression = 'random()*10 mm'
    entry = adapter._variant_entry(params[0])
    variant = {'id': 'sample', 'name': 'Random', 'parameters': [entry]}
    params[0].value = 123.0
    assert adapter._variant_matches(design, variant)
    params[0].expression = 'random()*20 mm'
    assert not adapter._variant_matches(design, variant)


def preview_cell(adapter, params, text, **extra):
    state = adapter._variants_state(adapter._design())
    return adapter.request(
        'variants.cell.preview',
        {
            'target': params[0].name,
            'parameters': [adapter._variant_entry(p) for p in params],
            'text': text,
            'variantsToken': state['variantsToken'],
            'snapshotToken': state['variantSnapshotToken'],
            **extra,
        },
    )


def test_cell_preview_relative_this_and_new_link_use_variant_row_without_writes(model):
    adapter, design, params, calls = model
    cells = [adapter._variant_entry(p) for p in params]
    cells[0]['expression'] = '30 mm'
    for text, expected in [('width=this*2', 60), ('width+=2', 32)]:
        result = preview_cell(adapter, params, text, parameters=cells)
        _, ops = adapter._plan('width=' + result['expression'])
        assert ops[0].quantity.value == expected
    result = preview_cell(
        adapter, params, 'beam=10 mm;width=beam', parameters=cells, sourceName='width'
    )
    assert result['newParameters'][0]['name'] == 'beam'
    assert result['newParameters'][0]['value'] == 30
    assert result['expression'] == 'beam'
    equation = preview_cell(adapter, params, '', parameters=cells, inlineEquation='span*2=50')
    assert equation['newParameters'][0]['name'] == 'span'
    assert equation['newParameters'][0]['value'] == 25
    assert not calls and design.attributes.value is None and len(params) == 2


def test_pending_new_parameters_are_deferred_and_never_enrolled(model, monkeypatch):
    adapter, design, params, calls = model
    table = table_save(adapter, params[:1], ('20 mm',))
    row = table['variants'][0]
    row['parameters'][0]['expression'] = 'beam'
    pending = [{'name': 'beam', 'expression': '25 mm', 'unit': 'mm'}]
    adapter.in_command, adapter.in_direct_apply = False, True
    with pytest.raises(Exception, match='Finish'):
        send(
            adapter,
            'variants.table.save',
            columns=table['columns'],
            variants=[row],
            newParameters=pending,
        )
    assert len(params) == 2 and not calls
    adapter.in_command, adapter.in_direct_apply = True, False
    created = []

    def create(design, operations):
        created.extend(operations)

    monkeypatch.setattr(adapter, '_execute_new_batch', create)
    send(
        adapter,
        'variants.table.save',
        columns=table['columns'],
        variants=[row],
        newParameters=pending,
    )
    stored = json.loads(design.attributes.value)
    assert [op.name for op in created] == ['beam']
    assert [c['name'] for c in stored['columns']] == ['width']
    assert stored['variants'][0]['parameters'][0]['value'] == 2.5
    assert not calls


def test_table_stores_derived_native_units_in_fusion_database_units(model):
    adapter, design, params, calls = model
    params[0].unit, params[0].expression, params[0].value = 'mm^2', '10 mm^2', 0.1
    table = table_save(adapter, params[:1], ('20 mm^2',))
    assert table['variants'][0]['parameters'][0]['value'] == 0.2
