"""Run in Autodesk Fusion: native expression acceptance in a disposable document.

The script imports this checkout under an isolated package name, never restarts
an installed add-in, and closes only documents it created. Reports and F3D files
are written to the OS temporary directory, outside the repository.
"""

import importlib
import importlib.util
import json
import math
import sys
import tempfile
import uuid
from pathlib import Path


def run(_context):
    import adsk.core
    import adsk.fusion

    root = Path(__file__).resolve().parents[1] / 'Paramood'
    namespace = 'paramood_native_parity_' + uuid.uuid4().hex
    spec = importlib.util.spec_from_file_location(
        namespace, root / '__init__.py', submodule_search_locations=[str(root)]
    )
    package = importlib.util.module_from_spec(spec)
    sys.modules[namespace] = package
    spec.loader.exec_module(package)
    adapter_module = importlib.import_module(namespace + '.fusion.adapter')
    catalog = importlib.import_module(namespace + '.core.builtins').CATALOG
    dispatch = importlib.import_module(namespace + '.bridge.protocol').dispatch
    app = adsk.core.Application.get()
    original = app.activeDocument
    document = app.documents.add(adsk.core.DocumentTypes.FusionDesignDocumentType)
    document.name = 'Paramood Native Expression Acceptance'
    report = {'version': app.version, 'units': [], 'functions': [], 'scenarios': []}
    output = Path(tempfile.mkdtemp(prefix='paramood-native-parity-'))
    try:
        design = adsk.fusion.Design.cast(app.activeProduct)
        assert design.userParameters.count == 0
        adapter = adapter_module.FusionAdapter(app)
        adapter.in_direct_apply = True

        def apply(text):
            count = design.userParameters.count
            preview = adapter.request('parameters.preview', {'text': text})
            assert preview['valid'] and design.userParameters.count == count
            result = adapter.request(
                'parameters.apply', {'text': text, 'snapshotToken': preview['snapshotToken']}
            )
            return preview, result

        for i, unit in enumerate(catalog['units']):
            apply('nativeUnit' + str(i) + '=1 ' + unit)
            parameter = design.userParameters.itemByName('nativeUnit' + str(i))
            assert parameter and math.isfinite(parameter.value)
            report['units'].append(unit)
        for function in catalog['functions']:
            preview, _ = apply('nativeFunction_' + function['name'] + '=' + function['example'])
            assert preview['items'][0]['estimated'] == (function['name'] == 'random')
            report['functions'].append(function['name'])
        cases = [
            'areaValue=10 mm*20 mm',
            'volumeValue=2 cm*3 cm*4 cm',
            'cubeRoot=pow(8 mm^3;1/3)',
            'massValue=5 kg',
            'forceValue=2 N',
            'pressureValue=4 Pa',
            'heatValue=-20 C',
            'speedValue=SpeedOfLight',
            'accelerationValue=Gravity',
            'lazyValue=if(1<2;2;1/0)',
            'mixedValue=if(1<2;1 mm;2)',
            'roundedLength=floor(1 mm)',
            'positiveLength=sign(1 mm)',
            "caption='Body'",
            'captionCopy=caption',
            "caption=caption+' X'",
            'aliasValue=2 centimeter',
            'inchValue=1"',
            "footValue=1'",
            'micronValue=2 µ',
            'degreeValue=30 °',
            'randomValue=random();derivedRandom=randomValue*10 mm',
            'randomValue=random()',
            'massValue+=2',
            'areaValue=this*2',
        ]
        for text in cases:
            apply(text)
            report['scenarios'].append(text)
        random_parameter = design.userParameters.itemByName('randomValue')
        assert random_parameter.expression == 'random()'
        preview = adapter.request('parameters.preview', {'text': 'randomValue=random()'})
        random_parameter.expression = 'random()'
        adapter.request(
            'parameters.apply',
            {'text': 'randomValue=random()', 'snapshotToken': preview['snapshotToken']},
        )
        report['random_recompute_keeps_preview_valid'] = True
        stale = adapter.request('parameters.preview', {'text': 'areaValue=this*2'})
        design.userParameters.itemByName('areaValue').expression = '500 mm^2'
        response = dispatch(
            adapter,
            {
                'requestId': 'stale-parity',
                'documentId': adapter.document_id,
                'action': 'parameters.apply',
                'payload': {'text': 'areaValue=this*2', 'snapshotToken': stale['snapshotToken']},
            },
        )
        assert not response['ok'] and response['error']['code'] == 'STALE_PREVIEW'
        report['deterministic_edit_invalidates_preview'] = True
        state = adapter._variants_state(design)
        saved = adapter.request(
            'variants.save',
            {
                'name': 'Native random',
                'parameters': [adapter._variant_entry(random_parameter)],
                'variantsToken': state['variantsToken'],
                'snapshotToken': state['variantSnapshotToken'],
            },
        )
        variant_id = saved['activeVariantId']
        random_parameter.expression = 'random()'
        assert adapter._variants_state(design)['activeVariantId'] == variant_id
        archive = output / 'parity.f3d'
        assert design.exportManager.execute(
            design.exportManager.createFusionArchiveExportOptions(str(archive))
        )
        expected = {p.name: (p.expression, p.unit) for p in design.userParameters}
        document.close(False)
        document = app.importManager.importToNewDocument(
            app.importManager.createFusionArchiveImportOptions(str(archive))
        )
        design = adsk.fusion.Design.cast(app.activeProduct)
        assert {p.name: (p.expression, p.unit) for p in design.userParameters} == expected
        reopened = adapter_module.FusionAdapter(app)
        assert reopened._variants_state(design)['activeVariantId'] == variant_id
        report['archive_parameters'] = len(expected)
        report['random_variant_survives_recompute_and_reopen'] = True
        report['passed'] = True
        (output / 'report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
        print(
            json.dumps(
                {
                    'report': str(output / 'report.json'),
                    'units': len(report['units']),
                    'functions': len(report['functions']),
                    'scenarios': len(report['scenarios']),
                    'passed': True,
                }
            )
        )
    finally:
        if document and document.isValid:
            document.close(False)
        if original and original.isValid:
            original.activate()
