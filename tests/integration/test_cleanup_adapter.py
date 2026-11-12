"""Cleanup safety checks; real Fusion transaction acceptance is recorded separately."""

import importlib
import sys
import types
from types import SimpleNamespace as NS

import pytest

from Paramood.bridge.protocol import BridgeError, dispatch


class Collection(list):
    def itemByName(self, name):
        return next((p for p in self if p.name == name), None)


@pytest.fixture
def cleanup(monkeypatch):
    core, fusion = types.ModuleType('adsk.core'), types.ModuleType('adsk.fusion')
    fusion.Design = NS(cast=lambda p: p)
    adsk = types.ModuleType('adsk')
    adsk.core, adsk.fusion = core, fusion
    for name, value in [('adsk', adsk), ('adsk.core', core), ('adsk.fusion', fusion)]:
        monkeypatch.setitem(sys.modules, name, value)
    sys.modules.pop('Paramood.fusion.adapter', None)
    module = importlib.import_module('Paramood.fusion.adapter')
    parameters = Collection()
    users = Collection()
    deleted = []

    def add(name, expression='5 mm', dependencies=(), user=True, favorite=False):
        class Parameter:
            isValid = True
            unit = 'mm'
            comment = ''
            value = 0.5
            isFavorite = favorite

            @property
            def dependencyParameters(self):
                return list(dependencies)

            @property
            def dependentParameters(self):
                return [p for p in parameters if self in p.dependencyParameters]

            @property
            def isDeletable(self):
                return not self.dependentParameters

            def deleteMe(self):
                assert self.isDeletable
                deleted.append(self.name)
                parameters.remove(self)
                users.remove(self)
                self.isValid = False
                return True

        p = Parameter()
        p.name, p.expression, p.entityToken = name, expression, name
        parameters.append(p)
        if user:
            users.append(p)
        return p

    base = add('base')
    leaf = add('leaf', 'base/2', [base])
    spare = add('spare')
    used = add('used')
    add('d1', 'used', [used], user=False)
    favorite = add('favorite', favorite=True)
    design = NS(
        allParameters=parameters,
        userParameters=users,
        fusionUnitsManager=NS(defaultLengthUnits='mm', formatValue=lambda value, unit: '5 mm'),
        findEntityByToken=lambda token: [p for p in parameters if p.entityToken == token],
    )
    app = NS(activeDocument=NS(name='TEMP'), activeProduct=design)
    adapter = module.FusionAdapter(app)
    table = {'columns': [], 'variants': []}
    monkeypatch.setattr(adapter, '_read_variant_table', lambda d: (table, str(table)))
    monkeypatch.setattr(adapter, '_read_variants', lambda d: (table['variants'], str(table)))
    monkeypatch.setattr(
        adapter, '_resolve_variant_parameter', lambda d, entry: users.itemByName(entry['name'])
    )
    monkeypatch.setattr(
        adapter,
        '_plan',
        lambda text: (design, [NS(name=part.split('=')[0]) for part in text.split(';')]),
    )
    yield NS(**locals())
    sys.modules.pop('Paramood.fusion.adapter', None)


def preview(cleanup):
    return cleanup.adapter.request('cleanup.analyze', {})


def delete(cleanup, state, names):
    cleanup.adapter.in_command = True
    return cleanup.adapter.request(
        'cleanup.delete', {'snapshot': state['snapshot'], 'names': names}
    )


def test_analyze_is_read_only_and_protects_model_and_favorites(cleanup):
    result = preview(cleanup)
    assert {p['name'] for p in result['items']} == {'base', 'leaf', 'spare'}
    assert next(p for p in result['items'] if p['name'] == 'leaf')['dependencies'] == ['base']
    assert cleanup.deleted == []


def test_delete_orders_chain_and_preserves_unselected_dependency(cleanup):
    result = delete(cleanup, preview(cleanup), ['leaf', 'base'])
    assert result['deleted'] == ['leaf', 'base']
    assert cleanup.deleted == ['leaf', 'base']
    assert cleanup.spare.isValid


def test_retaining_leaf_prevents_deleting_its_dependency(cleanup):
    result = delete(cleanup, preview(cleanup), ['base', 'spare'])
    assert result == {'deleted': ['spare'], 'retained': ['base']}
    assert cleanup.base.isValid and cleanup.leaf.isValid


@pytest.mark.parametrize('change', ['expression', 'favorite', 'comment', 'variant', 'identity'])
def test_stale_previews_never_write(cleanup, change):
    state = preview(cleanup)
    if change == 'expression':
        cleanup.leaf.expression = 'base/3'
    elif change == 'favorite':
        cleanup.spare.isFavorite = True
    elif change == 'comment':
        cleanup.base.comment = 'keep'
    elif change == 'variant':
        cleanup.table['columns'].append({'kind': 'parameter', 'name': 'spare'})
    else:
        cleanup.spare.entityToken = 'replacement'
    with pytest.raises(BridgeError, match='(changed|identity)'):
        delete(cleanup, state, ['spare'])
    assert not cleanup.deleted


def test_preview_required_and_transaction_required(cleanup):
    with pytest.raises(BridgeError) as error:
        cleanup.adapter.request('cleanup.delete', {'names': ['spare']})
    assert error.value.code == 'BAD_CONTEXT'
    cleanup.adapter.in_command = True
    with pytest.raises(BridgeError) as error:
        cleanup.adapter.request('cleanup.delete', {'names': ['spare']})
    assert error.value.code == 'STALE_PREVIEW'


def test_preflight_does_not_write(cleanup):
    state = preview(cleanup)
    result = cleanup.adapter.validate_mutation(
        'cleanup.delete', {'names': ['leaf', 'base'], 'snapshot': state['snapshot']}
    )
    assert result['target']['order'] == ['leaf', 'base']
    assert not cleanup.deleted


def test_saved_variant_formulas_protect_dependencies(cleanup):
    cleanup.table['variants'].append(
        {'parameters': [{'name': 'used', 'expression': 'leaf + spare', 'unit': 'mm'}]}
    )
    assert preview(cleanup)['items'] == []


def test_incomplete_graph_fails_closed(cleanup, monkeypatch):
    monkeypatch.setattr(type(cleanup.base), 'dependentParameters', property(lambda p: []))
    with pytest.raises(BridgeError) as error:
        preview(cleanup)
    assert error.value.code == 'CLEANUP_UNAVAILABLE'
    assert not cleanup.deleted


def test_native_refusal_and_misleading_true_are_not_success(cleanup, monkeypatch):
    state = preview(cleanup)
    monkeypatch.setattr(cleanup.spare, 'deleteMe', lambda: True)
    with pytest.raises(BridgeError) as error:
        delete(cleanup, state, ['spare'])
    assert error.value.code == 'DELETE_FAILED'
    assert cleanup.spare.isValid


def test_stale_document_bridge_rejected(cleanup):
    state = preview(cleanup)
    result = dispatch(
        cleanup.adapter,
        {
            'requestId': 'x',
            'documentId': 'old',
            'action': 'cleanup.delete',
            'payload': {'snapshot': state['snapshot'], 'names': ['spare']},
        },
    )
    assert result['error']['code'] == 'STALE_DOCUMENT'
    assert not cleanup.deleted


def test_unverifiable_saved_formula_blocks_cleanup(cleanup, monkeypatch):
    cleanup.table['variants'].append(
        {'parameters': [{'name': 'used', 'expression': 'missing + spare', 'unit': 'mm'}]}
    )

    def reject(text):
        raise ValueError('Unknown saved expression')

    monkeypatch.setattr(cleanup.adapter, '_plan', reject)
    with pytest.raises(BridgeError, match='Unknown saved expression'):
        preview(cleanup)
    assert not cleanup.deleted


def test_unknown_native_blocker_is_protected(cleanup, monkeypatch):
    monkeypatch.setattr(type(cleanup.spare), 'isDeletable', property(lambda p: False))
    assert 'spare' not in {p['name'] for p in preview(cleanup)['items']}
    assert not cleanup.deleted


@pytest.mark.parametrize('names', [['used'], ['favorite'], ['missing'], ['spare', 'spare'], []])
def test_unpreviewed_or_invalid_selection_never_writes(cleanup, names):
    with pytest.raises(BridgeError):
        delete(cleanup, preview(cleanup), names)
    assert not cleanup.deleted
