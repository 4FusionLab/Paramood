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
        self.value = None
        self.fail = False

    def itemByName(self, group, name):
        return SimpleNamespace(value=self.value) if self.value is not None else None

    def add(self, group, name, value):
        if self.fail:
            return None
        self.value = value
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
    adsk.core, adsk.fusion = core, fusion
    for name, module in [('adsk', adsk), ('adsk.core', core), ('adsk.fusion', fusion)]:
        monkeypatch.setitem(sys.modules, name, module)
    sys.modules.pop('Paramood.fusion.adapter', None)
    sys.modules.pop('Paramood.fusion.variants', None)
    module = importlib.import_module('Paramood.fusion.adapter')
    params = Parameters(
        [
            SimpleNamespace(
                name=name, entityToken='token-' + name, expression='10 mm', unit='mm', value=1.0
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


def send(adapter, action, **payload):
    state = adapter._variants_state(adapter._design())
    body = {
        'variantsToken': state.get('variantsToken'),
        'snapshotToken': state.get('variantSnapshotToken'),
        **payload,
    }
    return adapter.request(action, body)


def save(adapter, params, name='Compact', **kwargs):
    return send(
        adapter,
        'variants.save',
        name=name,
        parameters=[adapter._variant_entry(params[0])],
        **kwargs,
    )['activeVariantId']


def test_save_switch_free_and_reopen_match(model):
    adapter, design, params, calls = model
    identity = save(adapter, params)
    assert json.loads(design.attributes.value)['variants'][0]['id'] == identity
    send(adapter, 'variants.free')
    assert adapter._variants_state(design)['activeVariantId'] is None
    adapter._variant_sessions.clear()
    assert adapter._variants_state(design)['activeVariantId'] == identity
    params[0].value = 2
    assert adapter._variants_state(design)['activeVariantId'] is None
    send(adapter, 'variants.apply', id=identity)
    assert params[0].value == 1
    assert calls[-1] == ['10 mm']
    assert adapter._variants_state(design)['activeVariantId'] == identity


def test_delete_membership_never_deletes_model_parameters(model):
    adapter, design, params, calls = model
    identity = send(
        adapter,
        'variants.save',
        name='Both',
        parameters=[adapter._variant_entry(p) for p in params],
    )['activeVariantId']
    send(
        adapter,
        'variants.save',
        id=identity,
        name='Height only',
        parameters=[adapter._variant_entry(params[1])],
    )
    assert len(params) == 2
    assert len(adapter._read_variants(design)[0][0]['parameters']) == 1
    send(adapter, 'variants.delete', id=identity)
    assert len(params) == 2
    assert adapter._read_variants(design)[0] == []


def test_active_edits_capture_new_parameter_and_existing_values(model):
    adapter, design, params, calls = model
    identity = save(adapter, params)
    context = adapter._variant_edit_context(design)
    params[1].expression, params[1].value = '30 mm', 3
    adapter._capture_variant_edits(design, context, ['height'])
    stored = adapter._read_variants(design)[0][0]
    assert stored['id'] == identity
    assert [p['name'] for p in stored['parameters']] == ['width', 'height']
    assert stored['parameters'][1]['value'] == 3
    send(adapter, 'variants.free')
    assert adapter._variant_edit_context(design)[1] is None


def test_stale_snapshot_and_stale_storage_fail_before_writes(model):
    adapter, design, params, calls = model
    state = adapter._variants_state(design)
    save(adapter, params)
    with pytest.raises(Exception, match='changed'):
        adapter.request(
            'variants.free',
            {
                'variantsToken': state['variantsToken'],
                'snapshotToken': state['variantSnapshotToken'],
            },
        )
    state = adapter._variants_state(design)
    params[1].expression = '20 mm'
    count = len(calls)
    with pytest.raises(Exception, match='changed'):
        adapter.request(
            'variants.free',
            {
                'variantsToken': state['variantsToken'],
                'snapshotToken': state['variantSnapshotToken'],
            },
        )
    assert len(calls) == count


def test_deleted_parameter_never_binds_new_parameter_with_same_name(model):
    adapter, design, params, calls = model
    identity = save(adapter, params)
    params[0] = SimpleNamespace(
        name='width', entityToken='replacement', expression='10 mm', unit='mm', value=1
    )
    state = adapter._variants_state(design)
    assert state['activeVariantId'] is None
    assert state['variants'][0]['parameters'][0]['missing']
    with pytest.raises(Exception, match='unavailable'):
        send(adapter, 'variants.apply', id=identity)
    assert len(calls) == 1


def test_renamed_parameter_resolves_via_token(model):
    adapter, design, params, calls = model
    identity = save(adapter, params)
    params[0].name = 'new_width'
    state = adapter._variants_state(design)
    assert state['activeVariantId'] == identity
    assert state['variants'][0]['parameters'][0]['name'] == 'new_width'
    send(adapter, 'variants.apply', id=identity)


def test_invalid_expression_and_batch_failure_preserve_saved_variant(model):
    adapter, design, params, calls = model
    identity = save(adapter, params)
    raw = design.attributes.value
    for expression in ('invalid', 'reject'):
        entry = {**adapter._variant_entry(params[0]), 'expression': expression}
        with pytest.raises(Exception):
            send(adapter, 'variants.save', id=identity, name='Changed', parameters=[entry])
        assert design.attributes.value == raw
        assert params[0].expression == '10 mm'


def test_direct_storage_failure_restores_parameter_expressions(model):
    adapter, design, params, calls = model
    adapter.in_command, adapter.in_direct_apply = False, True
    design.attributes.fail = True
    entry = {**adapter._variant_entry(params[0]), 'expression': '20 mm'}
    with pytest.raises(Exception, match='save variants'):
        send(adapter, 'variants.save', name='Failure', parameters=[entry])
    assert params[0].expression == '10 mm'
    assert design.attributes.value is None
    assert calls == [['20 mm'], ['10 mm']]


def test_corrupt_or_future_storage_preserved(model):
    adapter, design, params, calls = model
    for raw in ('broken', '{"version":2,"variants":[]}'):
        design.attributes.value = raw
        state = adapter._variants_state(design)
        assert state['variantsError']
        with pytest.raises(Exception, match='preserved'):
            send(
                adapter, 'variants.save', name='No', parameters=[adapter._variant_entry(params[0])]
            )
        assert design.attributes.value == raw
    assert not calls


def test_bridge_rejects_foreign_document(model):
    adapter, design, params, calls = model
    result = dispatch(
        adapter, {'requestId': 'x', 'action': 'variants.save', 'documentId': 'other', 'payload': {}}
    )
    assert result['error']['code'] == 'STALE_DOCUMENT'
    assert not calls


def test_two_models_and_identical_variants_have_deterministic_selection(model):
    adapter, design, params, calls = model
    first = save(adapter, params)
    second = save(adapter, params, name='Same values')
    assert adapter._variants_state(design)['activeVariantId'] == second
    adapter._variant_sessions.clear()
    assert adapter._variants_state(design)['activeVariantId'] == first
    adapter.app.activeDocument = SimpleNamespace(name='Other')
    adapter.app.activeProduct = copy.copy(design)
    adapter.app.activeProduct.attributes = Attributes()
    assert adapter._variants_state(adapter._design())['activeVariantId'] is None


def test_auto_save_failure_restores_direct_parameter_updates(model, monkeypatch):
    adapter, design, params, calls = model
    identity = save(adapter, params)
    raw = design.attributes.value
    adapter.in_command, adapter.in_direct_apply = False, True
    design.attributes.fail = True
    op = SimpleNamespace(name='width', status='Update')

    def execute(design, ops):
        assert ops == [op]
        params[0].expression, params[0].value = '20 mm', 2
        return {'created': [], 'updated': ['width']}

    monkeypatch.setattr(adapter, '_execute_direct_batch', execute)
    with pytest.raises(Exception, match='save variants'):
        adapter._execute_tracked_parameters(design, [op])
    assert params[0].expression == '10 mm'
    assert params[0].value == 1
    assert design.attributes.value == raw
    assert adapter._variants_state(design)['activeVariantId'] == identity


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
