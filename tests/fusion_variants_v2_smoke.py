"""Manual Fusion smoke test: creates and discards only its own temporary document.

Run through Fusion's permitted main-thread script context. This exercises the source adapter,
not the installed Paramood palette. No Configuration API, save, export, or user model writes.
"""

import importlib
import importlib.util
import json
import math
import sys
import uuid
from pathlib import Path

import adsk.core
import adsk.fusion


def run(_context):
    app = adsk.core.Application.get()
    assert app.userInterface.activeCommand == 'SelectCommand', 'Finish the active command first.'
    original = app.activeDocument
    package = Path(__file__).resolve().parents[1] / 'Paramood'
    alias = 'paramood_v2_smoke_' + uuid.uuid4().hex
    spec = importlib.util.spec_from_file_location(
        alias, package / '__init__.py', submodule_search_locations=[str(package)]
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[alias] = module
    spec.loader.exec_module(module)
    adapter_type = importlib.import_module(alias + '.fusion.adapter').FusionAdapter
    document = app.documents.add(adsk.core.DocumentTypes.FusionDesignDocumentType)
    design = adsk.fusion.Design.cast(app.activeProduct)
    assert design
    design.designType = adsk.fusion.DesignTypes.ParametricDesignType
    design.attributes.add('4FusionLab.Paramood', 'variants.v1', 'legacy-untouched')
    height = design.userParameters.add(
        'test_height', adsk.core.ValueInput.createByString('20 mm'), 'mm', ''
    )
    width = design.userParameters.add(
        'test_width', adsk.core.ValueInput.createByString('10 mm'), 'mm', ''
    )
    outside = design.userParameters.add(
        'global_clearance', adsk.core.ValueInput.createByString('1 mm'), 'mm', ''
    )
    root = design.rootComponent
    sketch = root.sketches.add(root.xYConstructionPlane)
    sketch.sketchCurves.sketchCircles.addByCenterRadius(adsk.core.Point3D.create(0, 0, 0), 1)
    feature = root.features.extrudeFeatures.addSimple(
        sketch.profiles.item(0),
        adsk.core.ValueInput.createByString('test_height'),
        adsk.fusion.FeatureOperations.NewBodyFeatureOperation,
    )
    feature.name = 'Variant controlled extrusion'
    adapter = adapter_type(app)
    adapter.in_direct_apply = True
    adapter._design()
    selection_events = []

    class SelectionProbe(adsk.core.ActiveSelectionEventHandler):
        def notify(self, args):
            selection_events.append(adapter._variant_timeline_selection())

    probe = SelectionProbe()
    ui = app.userInterface
    ui.activeSelectionChanged.add(probe)
    ui.activeSelections.clear()
    assert ui.activeSelections.add(feature)
    adsk.doEvents()
    selection = adapter.request('variants.selection.get', {})
    assert [item['name'] for item in selection['features']] == [feature.name]
    assert any(event['features'] for event in selection_events)
    ui.activeSelections.clear()
    ui.activeSelectionChanged.remove(probe)

    def send(action, payload):
        assert app.activeDocument == document, 'Temporary document is no longer active.'
        state = adapter._variants_state(design)
        assert not state.get('variantsError'), state
        return adapter.request(
            action,
            {
                'variantsToken': state['variantsToken'],
                'snapshotToken': state['variantSnapshotToken'],
                **payload,
            },
        )

    assert adapter._variants_state(design)['variants'] == []
    columns = [
        {'kind': 'parameter', 'name': p.name, 'entityToken': p.entityToken, 'unit': p.unit}
        for p in (width, height)
    ] + [{'kind': 'feature', 'name': feature.name, 'entityToken': feature.entityToken}]
    rows = []
    for name, values, enabled in (
        ('Off', ('40 mm', '30 mm'), False),
        ('On', ('25 mm', '35 mm'), True),
    ):
        rows.append(
            {
                'name': name,
                'parameters': [
                    dict(adapter._variant_entry(p), expression=value)
                    for p, value in zip((width, height), values)
                ],
                'features': [dict(adapter._feature_entry(feature), enabled=enabled)],
            }
        )
    send('variants.table.save', {'columns': columns, 'variants': rows})
    assert height.expression == '20 mm' and width.expression == '10 mm'
    assert not feature.isSuppressed and root.bRepBodies.count == 1
    assert adapter._variants_state(design)['activeVariantId'] is None
    saved = adapter._variants_state(design)['variants']
    send('variants.apply', {'id': saved[0]['id']})
    assert feature.isSuppressed and root.bRepBodies.count == 0
    send('variants.apply', {'id': saved[1]['id']})
    assert not feature.isSuppressed and root.bRepBodies.count == 1
    assert math.isclose(root.bRepBodies.item(0).boundingBox.maxPoint.z, 3.5, abs_tol=1e-6)
    edited = adapter._variants_state(design)['variants']
    edited[1]['parameters'][1]['expression'] = '45 mm'
    edited[0]['parameters'][1]['expression'] = '99 mm'
    send('variants.table.save', {'columns': columns, 'variants': edited})
    assert math.isclose(height.value, 4.5)
    assert math.isclose(root.bRepBodies.item(0).boundingBox.maxPoint.z, 4.5, abs_tol=1e-6)
    assert adapter._variants_state(design)['activeVariantId'] == saved[1]['id']
    state = adapter.state()
    assert {p['name'] for p in state['parameters'] if p.get('configured')} == {
        'test_width',
        'test_height',
    }
    context = adapter._variant_edit_context(design)
    outside.expression = '2 mm'
    adapter._capture_variant_edits(design, context, ['global_clearance'])
    stored = json.loads(design.attributes.itemByName('4FusionLab.Paramood', 'variants.v2').value)
    assert len(stored['columns']) == 3
    assert all(len(row['parameters']) == 2 for row in stored['variants'])
    assert (
        design.attributes.itemByName('4FusionLab.Paramood', 'variants.v1').value
        == 'legacy-untouched'
    )
    send('variants.free', {})
    assert not feature.isSuppressed and math.isclose(height.value, 4.5)
    assert document.close(False)
    if original:
        assert original.activate()
    for key in list(sys.modules):
        if key == alias or key.startswith(alias + '.'):
            del sys.modules[key]
    print(
        json.dumps(
            {
                'result': 'PASS',
                'fusion': app.version,
                'checks': [
                    'v2 storage only',
                    'native feature selection and activeSelectionChanged event',
                    'save without model changes',
                    'suppress and unsuppress extrusion',
                    '35 and 45 mm CAD heights',
                    'active-row Save applies only active row',
                    'configured markers',
                    'outside-set edit stays global',
                    'Free preserves geometry',
                    'temporary document discarded',
                    'original document restored',
                ],
            }
        )
    )
