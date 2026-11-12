import importlib
import sys
import types
from types import SimpleNamespace as NS

import pytest

from Paramood.bridge.protocol import dispatch


class Collection(list):
    def itemByName(self, name):
        return next((p for p in self if p.name == name), None)


@pytest.fixture
def model(monkeypatch):
    core, fusion = types.ModuleType('adsk.core'), types.ModuleType('adsk.fusion')
    fusion.Design = NS(cast=lambda p: p)
    fusion.SketchDimension = NS(cast=lambda p: p if getattr(p, 'dimension', False) else None)
    fusion.Sketch = NS(cast=lambda p: p if getattr(p, 'sketch', False) else None)
    adsk = types.ModuleType('adsk')
    adsk.core, adsk.fusion = core, fusion
    for name, value in [('adsk', adsk), ('adsk.core', core), ('adsk.fusion', fusion)]:
        monkeypatch.setitem(sys.modules, name, value)
    sys.modules.pop('Paramood.fusion.adapter', None)
    module = importlib.import_module('Paramood.fusion.adapter')
    references = importlib.import_module('Paramood.fusion.references')
    monkeypatch.setattr(references, 'adsk', adsk)
    width = NS(
        name='width',
        expression='10 mm',
        entityToken='width',
        dependencyParameters=[],
        dependentParameters=[],
    )
    half = NS(
        name='half',
        expression='width/2',
        entityToken='half',
        dependencyParameters=[width],
        dependentParameters=[],
    )
    feature = NS(name='Extrude1', entityToken='extrude', isValid=True, timelineObject=NS(index=1))
    sketch = NS(
        name='Sketch1', entityToken='sketch', isValid=True, timelineObject=NS(index=0), sketch=True
    )

    def parameter(name, expression, owner, dependencies):
        return NS(
            name=name,
            expression=expression,
            entityToken=name,
            dependencyParameters=dependencies,
            dependentParameters=[],
            createdBy=owner,
            component=NS(name='Root'),
        )

    d1 = parameter('d1', 'half', feature, [width, half])
    d2 = parameter('d2', 'width', feature, [width])
    d3 = parameter('d3', 'width', NS(dimension=True, parentSketch=sketch), [width])
    width.dependentParameters = [half, d1, d2, d3]
    half.dependentParameters = [d1]
    unused = NS(
        name='unused',
        expression='5 mm',
        entityToken='unused',
        dependencyParameters=[],
        dependentParameters=[],
    )
    all_parameters = Collection([width, half, d1, d2, d3, unused])
    entities = {p.entityToken: p for p in [*all_parameters, feature, sketch]}
    design = NS(
        allParameters=all_parameters,
        userParameters=Collection([width, half, unused]),
        findEntityByToken=lambda token: [entities[token]] if token in entities else [],
    )
    selected = []

    class Selections:
        @property
        def count(self):
            return len(selected)

        def item(self, i):
            return NS(entity=selected[i])

        def clear(self):
            selected.clear()
            return True

        def add(self, entity):
            selected.append(entity)
            return True

    ui = NS(activeCommand='SelectCommand', activeSelections=Selections())
    app = NS(
        activeProduct=design,
        activeDocument=NS(name='TEMP'),
        userInterface=ui,
        activeEditObject=None,
    )
    adapter = module.FusionAdapter(app)
    yield NS(
        adapter=adapter,
        design=design,
        selected=selected,
        ui=ui,
        width=width,
        feature=feature,
        half=half,
    )
    sys.modules.pop('Paramood.fusion.adapter', None)


def payload(name='width'):
    return {'name': name, 'entityToken': name}


def test_owners_are_deduplicated_and_dimensions_map_to_sketch(model):
    result = model.adapter.request('parameters.references', payload())
    feature = next(f for f in result['features'] if f['name'] == 'Extrude1')
    assert [(u['name'], u['relation']) for u in feature['uses']] == [
        ('d1', 'Indirect'),
        ('d2', 'Direct'),
    ]
    assert feature['uses'][0]['path'] == ['width', 'half', 'd1']
    assert len(result['features']) == 2
    assert result['parameters'][0]['name'] == 'half'
    assert not result['warnings']


def test_select_rechecks_membership_and_document(model):
    request = {
        'requestId': 'find',
        'documentId': model.adapter.document_id,
        'action': 'parameters.references.select',
        'payload': {**payload(), 'targetToken': 'extrude'},
    }
    assert dispatch(model.adapter, request)['ok']
    assert model.selected == [model.feature]
    model.selected.clear()
    request['payload']['targetToken'] = 'unused'
    assert dispatch(model.adapter, request)['error']['code'] == 'CONFLICT'
    assert not model.selected
    request['documentId'] = 'old-document'
    assert dispatch(model.adapter, request)['error']['code'] == 'STALE_DOCUMENT'


def test_active_command_is_preserved(model):
    model.ui.activeCommand = 'Extrude'
    result = dispatch(
        model.adapter,
        {
            'requestId': 'x',
            'documentId': model.adapter.document_id,
            'action': 'parameters.references.select',
            'payload': {**payload(), 'targetToken': 'extrude'},
        },
    )
    assert result['error']['code'] == 'BAD_CONTEXT'
    assert model.ui.activeCommand == 'Extrude'
    assert not model.selected


def test_unused_respects_saved_formulas_and_unknown_graph(model):
    unused = model.adapter._unused_parameter_names(model.design, {})
    assert unused == {'unused'}
    saved = {'variants': [{'parameters': [{'name': 'half', 'expression': 'unused/2'}]}]}
    assert model.adapter._unused_parameter_names(model.design, saved) == set()
    assert (
        model.adapter._unused_parameter_names(model.design, {'variantsError': 'unreadable'})
        == set()
    )
    model.width.dependentParameters = []
    assert model.adapter._unused_parameter_names(model.design, {}) == set()
    with pytest.raises(Exception, match='Cannot verify references'):
        model.adapter.request('parameters.references', payload())


def test_stale_parameter_and_unresolved_owner(model):
    with pytest.raises(Exception, match='parameter changed'):
        model.adapter.request('parameters.references', {**payload(), 'entityToken': 'half'})
    model.feature.timelineObject = None
    result = model.adapter.request('parameters.references', payload())
    assert len(result['warnings']) == 2
    assert len(result['features']) == 1


def test_select_expands_group_without_moving_timeline(model):
    group = NS(isCollapsed=True, isValid=True)
    model.feature.timelineObject.parentGroup = group
    model.adapter.request('parameters.references.select', {**payload(), 'targetToken': 'extrude'})
    assert not group.isCollapsed
    assert model.selected == [model.feature]


def test_refused_selection_restores_previous_selection_and_group(model):
    group = NS(isCollapsed=True, isValid=True)
    model.feature.timelineObject.parentGroup = group
    old = NS(isValid=True)
    model.selected.append(old)
    selections = model.ui.activeSelections
    original_add = selections.add
    selections.add = lambda entity: False if entity == model.feature else original_add(entity)
    with pytest.raises(Exception, match='Could not select'):
        model.adapter.request(
            'parameters.references.select', {**payload(), 'targetToken': 'extrude'}
        )
    assert group.isCollapsed
    assert model.selected == [old]
