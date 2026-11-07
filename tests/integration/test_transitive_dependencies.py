"""Fusion dependency lists can include ancestors absent from the expression."""

import math
from types import SimpleNamespace

import pytest

from Paramood.core.expressions import ExpressionError, plan_batch_snapshot

import test_batch_adapter as batch_tests


@pytest.fixture
def adapter_module(monkeypatch):
    yield from batch_tests.adapter_module.__wrapped__(monkeypatch)


def cedar_snapshot(adapter_module, reverse_transitive=True):
    adapter, params = batch_tests.make_adapter(adapter_module)
    adapter_module.adsk.fusion.ParameterValueTypes = SimpleNamespace(
        NumericParameterValueType=0, TextParameterValueType=1
    )
    specs = {
        'tray_base': ('12 mm', 'mm', 1.2),
        'post_height': ('120 mm', 'mm', 12),
        'roof_overhang': ('8 mm', 'mm', 0.8),
        'tray_wall': ('3 mm', 'mm', 0.3),
        'post_size': ('12 mm', 'mm', 1.2),
        'roof_pitch': ('43.531199428707665 deg', 'deg', math.radians(43.531199428707665)),
    }
    eave = 12 + 120 - (8 + 3 + 12) * math.tan(specs['roof_pitch'][2])
    specs['roof_eave'] = (
        'tray_base + post_height - (roof_overhang+tray_wall+post_size)*tan(roof_pitch)',
        'mm',
        eave / 10,
    )
    specs['d212'] = ('abs(-roof_eave)', 'mm', abs(eave) / 10)
    entries = {
        name: SimpleNamespace(
            name=name,
            expression=expr,
            unit=unit,
            value=value,
            valueType=0,
            dependencyParameters=[],
            dependentParameters=[],
        )
        for name, (expr, unit, value) in specs.items()
    }
    entries['caption'] = SimpleNamespace(
        name='caption',
        expression="'Cedar & Sage'",
        unit='Text',
        textValue='Cedar & Sage',
        valueType=1,
        dependencyParameters=[],
        dependentParameters=[],
    )
    leaves = [entries[name] for name in specs if name not in ('roof_eave', 'd212')]
    entries['roof_eave'].dependencyParameters = leaves
    entries['d212'].dependencyParameters = [entries['roof_eave'], *leaves]
    entries['roof_eave'].dependentParameters = [entries['d212']]
    for leaf in leaves:
        leaf.dependentParameters = [entries['roof_eave']]
        if reverse_transitive:
            leaf.dependentParameters.append(entries['d212'])
    params.entries = entries
    return adapter, entries


@pytest.mark.parametrize('reverse_transitive', [True, False])
def test_caption_edit_accepts_proven_numeric_ancestors(adapter_module, reverse_transitive):
    adapter, _ = cedar_snapshot(adapter_module, reverse_transitive)
    _, operations = adapter._plan('caption="Cedar & Sage feeder"')
    assert [(op.name, op.quantity.value) for op in operations] == [
        ('caption', 'Cedar & Sage feeder')
    ]


@pytest.mark.parametrize('mode', ['missing_direct', 'unproven_edge', 'cycle', 'unknown', 'reverse'])
def test_uncertain_api_graph_is_rejected_before_planning(adapter_module, mode):
    adapter, entries = cedar_snapshot(adapter_module)
    eave, dimension, caption = (entries[key] for key in ('roof_eave', 'd212', 'caption'))
    if mode == 'missing_direct':
        dimension.dependencyParameters.remove(eave)
        eave.dependentParameters.remove(dimension)
    elif mode == 'unproven_edge':
        dimension.dependencyParameters.append(caption)
        caption.dependentParameters.append(dimension)
    elif mode == 'cycle':
        eave.dependencyParameters.append(dimension)
        dimension.dependentParameters.append(eave)
    elif mode == 'unknown':
        dimension.dependencyParameters.append(SimpleNamespace(name='missing'))
    else:
        entries['post_size'].dependentParameters.clear()
    # Missing and unexplained edges can be bidirectionally consistent, so they
    # must still be rejected by the independent expression-graph verification.
    with pytest.raises((adapter_module.BridgeError, ExpressionError)):
        snapshot = adapter._dependency_snapshot(adapter._design())
        plan_batch_snapshot('caption="Cedar & Sage feeder"', snapshot, 'mm')


def test_transitive_api_lists_do_not_hide_new_cycles_or_stale_values(adapter_module):
    adapter, entries = cedar_snapshot(adapter_module)
    snapshot = adapter._dependency_snapshot(adapter._design())
    with pytest.raises(ExpressionError, match='Cyclic'):
        plan_batch_snapshot('post_height=d212', snapshot, 'mm')
    entries['d212'].value += 1
    snapshot = adapter._dependency_snapshot(adapter._design())
    with pytest.raises(ExpressionError, match='Inconsistent snapshot value: d212'):
        plan_batch_snapshot('caption="Cedar & Sage feeder"', snapshot, 'mm')


@pytest.mark.parametrize('reverse_transitive', [True, False])
def test_transitive_lists_keep_direct_expressions_for_recalculation(
    adapter_module, reverse_transitive
):
    adapter, entries = cedar_snapshot(adapter_module, reverse_transitive)
    # Minimal reproducer: a -> b -> c, with c also listing a in the API.
    a, b, c = (entries[key] for key in ('tray_base', 'roof_eave', 'd212'))
    a.name, b.name, c.name = 'a', 'b', 'c'
    a.expression, b.expression, c.expression = '10 mm', 'a*2', 'abs(-b)'
    a.value, b.value, c.value = 1, 2, 2
    a.dependencyParameters, b.dependencyParameters, c.dependencyParameters = [], [a], [a, b]
    a.dependentParameters = [b, c] if reverse_transitive else [b]
    b.dependentParameters, c.dependentParameters = [c], []
    adapter._design().allParameters.entries = {'a': a, 'b': b, 'c': c}
    snapshot = adapter._dependency_snapshot(adapter._design())
    operations = plan_batch_snapshot('a=30;result=c/2', snapshot, 'mm')
    assert [(op.name, op.quantity.value) for op in operations] == [('a', 30), ('result', 30)]
    assert operations[-1].expression == 'c/2'
