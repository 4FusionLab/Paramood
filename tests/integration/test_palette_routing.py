import importlib
import json
import sys
import types
from types import SimpleNamespace

import pytest


@pytest.fixture
def entry(monkeypatch):
    adsk = types.ModuleType('adsk')
    core, fusion = types.ModuleType('adsk.core'), types.ModuleType('adsk.fusion')
    for name in (
        'HTMLEventHandler',
        'ActiveSelectionEventHandler',
        'CommandEventHandler',
        'CommandCreatedEventHandler',
        'DocumentEventHandler',
        'WorkspaceEventHandler',
        'UserInterfaceGeneralEventHandler',
        'ApplicationCommandEventHandler',
        'CustomEventHandler',
    ):
        setattr(core, name, type(name, (), {}))
    adsk.core, adsk.fusion = core, fusion
    for name, value in [('adsk', adsk), ('adsk.core', core), ('adsk.fusion', fusion)]:
        monkeypatch.setitem(sys.modules, name, value)
    sys.modules.pop('Paramood.Paramood', None)
    sys.modules.pop('Paramood.fusion.adapter', None)
    sys.modules.pop('Paramood.fusion.variants', None)
    sys.modules.pop('Paramood.fusion.variant_table', None)
    module = importlib.import_module('Paramood.Paramood')
    yield module
    sys.modules.pop('Paramood.Paramood', None)
    sys.modules.pop('Paramood.fusion.adapter', None)


def test_reply_reaches_only_origin_and_notifications_go_to_all(entry):
    sent = []

    def palette(name):
        return SimpleNamespace(
            isValid=True,
            sendInfoToHTML=lambda action, data: sent.append((name, action, json.loads(data))),
        )

    entry._palettes = {'parameters': palette('parameters'), 'calculator': palette('calculator')}
    entry._send('calculator', 'response', {'requestId': 'x'})
    entry._broadcast('state.changed', {})
    assert sent == [
        ('calculator', 'response', {'requestId': 'x'}),
        ('parameters', 'state.changed', {}),
        ('calculator', 'state.changed', {}),
    ]


@pytest.mark.parametrize('command', ['SketchDimension', 'Extrude', 'SelectCommand'])
@pytest.mark.parametrize('selection_available', [True, False])
@pytest.mark.parametrize(
    'action',
    [
        'parameters.rename',
        'parameters.favorite',
        'parameters.delete',
        'parameters.renameGroup',
        'variants.table.save',
        'variants.apply',
        'variants.delete',
        'variants.free',
        'document.units',
    ],
)
def test_mutations_validate_then_start_independent_command(
    entry, monkeypatch, command, selection_available, action
):
    events, sent = [], []
    adapter = SimpleNamespace(
        document_id='doc',
        in_direct_apply=False,
        validate_mutation=lambda action, payload: events.append('validate') or {},
    )
    ui = SimpleNamespace(activeCommand=command)

    def terminate():
        events.append('terminate')
        ui.activeCommand = 'SelectCommand'
        return True

    ui.terminateActiveCommand = terminate
    ui.commandDefinitions = SimpleNamespace(
        itemById=lambda name: SimpleNamespace(execute=lambda: events.append('start') or True)
    )

    def selection(app, ui):
        if not selection_available:
            raise entry.SelectionUnavailable()
        return SimpleNamespace(restore=lambda: events.append('restore'))

    monkeypatch.setattr(entry, 'SelectionSnapshot', selection)
    entry._adapter, entry._ui = adapter, ui
    monkeypatch.setattr(entry, '_send', lambda *args: sent.append(args))
    message = {'requestId': 'r', 'documentId': 'doc', 'action': action, 'payload': {}}
    args = SimpleNamespace(action='request', data=json.dumps(message), returnData='')
    entry.HtmlHandler('parameters').notify(args)
    assert args.returnData == 'OK'
    assert events == ['validate'] + (['terminate'] if command != 'SelectCommand' else []) + [
        'start'
    ]
    assert not sent  # Starting a command is not a success response.
    assert entry._pending == message
    assert not adapter.in_direct_apply
    if command != 'SelectCommand':
        assert entry._pending_selection is None


def test_apply_reports_pending_request_separately(entry, monkeypatch):
    sent = []
    monkeypatch.setattr(entry, '_ui', SimpleNamespace(activeCommand='SelectCommand'))
    monkeypatch.setattr(entry, '_adapter', SimpleNamespace(document_id='doc'))
    monkeypatch.setattr(entry, '_pending', {'requestId': 'previous'})
    monkeypatch.setattr(entry, '_send', lambda mode, action, data: sent.append(data))
    args = SimpleNamespace(
        action='request',
        data=json.dumps({'requestId': 'r', 'action': 'parameters.apply'}),
        returnData='',
    )
    entry.HtmlHandler('parameters').notify(args)
    assert 'previous parameter operation' in sent[0]['error']['message']
    assert entry._pending == {'requestId': 'previous'}


def test_idle_favorite_restores_selection_after_transaction_destroy(entry, monkeypatch):
    events = []
    selection = SimpleNamespace(restore=lambda: events.append('restore'))
    monkeypatch.setattr(entry, 'SelectionSnapshot', lambda *args: selection)
    entry._app = SimpleNamespace(fireCustomEvent=lambda name: events.append(name))
    entry._adapter = SimpleNamespace(document_id='doc', validate_mutation=lambda *args: {})
    entry._ui = SimpleNamespace(
        activeCommand='SelectCommand',
        commandDefinitions=SimpleNamespace(
            itemById=lambda name: SimpleNamespace(execute=lambda: True)
        ),
    )
    monkeypatch.setattr(entry, '_send', lambda *args: None)
    monkeypatch.setattr(entry, '_broadcast', lambda *args: None)
    message = {'requestId': 'r', 'documentId': 'doc', 'action': 'parameters.favorite'}
    entry.HtmlHandler('parameters').notify(
        SimpleNamespace(action='request', data=json.dumps(message), returnData='')
    )
    entry._result = {'ok': True}
    entry.ApplyDestroy().notify(None)
    entry.RestoreSelection().notify(None)
    assert events == [entry._SELECTION_EVENT, 'restore']


def test_idle_apply_starts_transactional_command(entry, monkeypatch):
    started = []
    definition = SimpleNamespace(execute=lambda: started.append(True) or True)
    monkeypatch.setattr(
        entry,
        '_ui',
        SimpleNamespace(
            activeCommand='SelectCommand',
            commandDefinitions=SimpleNamespace(itemById=lambda _id: definition),
        ),
    )
    monkeypatch.setattr(entry, '_adapter', SimpleNamespace(is_sketch_edit=lambda: False))
    monkeypatch.setattr(entry, '_pending', None)
    monkeypatch.setattr(entry, '_pending_palette', None)
    args = SimpleNamespace(
        action='request',
        data=json.dumps({'requestId': 'r', 'action': 'parameters.apply'}),
        returnData='',
    )
    entry.HtmlHandler('parameters').notify(args)
    assert started == [True]
    assert entry._pending['requestId'] == 'r'
    assert entry._pending_palette == 'parameters'


def test_idle_apply_captures_selection_before_command_and_restores_after_destroy(
    entry, monkeypatch
):
    selected = [SimpleNamespace(isValid=True)]
    original = selected[0]
    queued = []

    class Selections:
        @property
        def count(self):
            return len(selected)

        def item(self, index):
            return SimpleNamespace(entity=selected[index])

        def add(self, entity):
            selected.append(entity)
            return True

    def execute():
        selected.clear()
        return True

    monkeypatch.setattr(
        entry,
        '_app',
        SimpleNamespace(activeDocument=object(), log=pytest.fail, fireCustomEvent=queued.append),
    )
    monkeypatch.setattr(
        entry,
        '_ui',
        SimpleNamespace(
            activeCommand='SelectCommand',
            activeSelections=Selections(),
            commandDefinitions=SimpleNamespace(
                itemById=lambda _id: SimpleNamespace(execute=execute)
            ),
            terminateActiveCommand=lambda: True,
        ),
    )
    monkeypatch.setattr(
        entry, '_adapter', SimpleNamespace(document_id='doc', is_sketch_edit=lambda: False)
    )
    monkeypatch.setattr(entry, '_pending', None)
    monkeypatch.setattr(entry, '_result', {'requestId': 'r', 'ok': True})
    monkeypatch.setattr(entry, '_send', lambda *args: None)
    monkeypatch.setattr(entry, '_broadcast', lambda *args: None)
    entry.HtmlHandler('parameters').notify(
        SimpleNamespace(
            action='request',
            data=json.dumps({'requestId': 'r', 'action': 'parameters.apply'}),
            returnData='',
        )
    )
    entry.ApplyDestroy().notify(None)
    assert queued
    entry.RestoreSelection().notify(None)
    assert selected == [original]


@pytest.mark.parametrize('started', [True, False])
@pytest.mark.parametrize('selection_available', [True, False])
@pytest.mark.parametrize('command', ['CircleCenterRadius', 'UnknownPreviewCommand'])
def test_active_command_apply_uses_independent_transaction(
    entry, monkeypatch, started, selection_available, command
):
    commands = []

    def execute():
        assert commands == ['terminated']
        commands.append(True)
        return started

    def terminate():
        commands.append('terminated')
        entry._ui.activeCommand = 'SelectCommand'
        return True

    monkeypatch.setattr(entry, '_app', SimpleNamespace(activeDocument=object(), log=pytest.fail))
    monkeypatch.setattr(
        entry,
        '_ui',
        SimpleNamespace(
            activeCommand=command,
            activeSelections=SimpleNamespace(
                count=1,
                item=lambda index: SimpleNamespace(
                    entity=SimpleNamespace(isValid=True) if selection_available else None
                ),
            ),
            commandDefinitions=SimpleNamespace(
                itemById=lambda _id: SimpleNamespace(execute=execute)
            ),
            terminateActiveCommand=terminate,
        ),
    )
    monkeypatch.setattr(entry, '_adapter', SimpleNamespace(document_id='doc'))
    monkeypatch.setattr(entry, '_pending', None)

    def preview_only(adapter, message):
        assert message['action'] == 'parameters.preview'
        return {'ok': True, 'data': {'snapshotToken': 'before', 'items': []}}

    monkeypatch.setattr(entry, 'dispatch', preview_only)
    responses = []
    monkeypatch.setattr(entry, '_send', lambda mode, action, data: responses.append(data))
    args = SimpleNamespace(
        action='request',
        data=json.dumps(
            {
                'requestId': 'blocked',
                'action': 'parameters.apply',
                'payload': {'text': 'newValue=1 mm', 'snapshotToken': 'before'},
            }
        ),
        returnData='',
    )
    entry.HtmlHandler('parameters').notify(args)
    assert args.returnData == 'OK'
    assert commands == ['terminated', True]
    if started:
        assert responses == []
        assert entry._pending['requestId'] == 'blocked'
        assert entry._pending_selection is None
    else:
        assert responses[0]['error']['code'] == 'COMMAND_FAILED'
        assert entry._pending is None


@pytest.mark.parametrize('changed', [False, True])
def test_command_reset_revalidates_plan_before_using_new_snapshot(entry, monkeypatch, changed):
    entry._adapter = SimpleNamespace(document_id='doc', in_command=False)
    entry._pending = {
        'requestId': 'r',
        'action': 'parameters.apply',
        'payload': {'text': 'a=1 mm', 'snapshotToken': 'before'},
    }
    entry._pending_preview = {'items': [{'name': 'a', 'expression': '1 mm', 'value': 1}]}
    applied = []

    def dispatch(adapter, message):
        if message['action'] == 'parameters.preview':
            return {
                'ok': True,
                'data': {
                    'snapshotToken': 'after',
                    'items': [{'name': 'a', 'expression': '1 mm', 'value': 2 if changed else 1}],
                },
            }
        applied.append(message)
        return {'requestId': 'r', 'ok': True}

    monkeypatch.setattr(entry, 'dispatch', dispatch)
    args = SimpleNamespace(executeFailed=False, executeFailedMessage='')
    entry.ApplyExecute().notify(args)
    if changed:
        assert applied == []
        assert args.executeFailed
        assert entry._result['error']['code'] == 'STALE_PREVIEW'
    else:
        assert applied[0]['payload']['snapshotToken'] == 'after'
        assert entry._result['ok']


def test_same_request_id_routes_to_origin(entry, monkeypatch):
    sent = []

    def palette(name):
        return SimpleNamespace(
            isValid=True,
            sendInfoToHTML=lambda action, data: sent.append((name, action, json.loads(data))),
        )

    entry._palettes = {'parameters': palette('parameters'), 'calculator': palette('calculator')}
    entry._adapter = SimpleNamespace(document_id='doc')
    monkeypatch.setattr(
        entry,
        'dispatch',
        lambda adapter, msg: {'requestId': msg['requestId'], 'ok': True, 'data': msg['action']},
    )
    for mode in ('calculator', 'parameters'):
        args = SimpleNamespace(
            action='request',
            data=json.dumps({'requestId': 'same', 'action': 'state.get'}),
            returnData='',
        )
        entry.HtmlHandler(mode).notify(args)
    assert [(name, data['requestId']) for name, action, data in sent if action == 'response'] == [
        ('calculator', 'same'),
        ('parameters', 'same'),
    ]


def test_prefill_delayed_once_until_ack_and_cleared_on_document_change(entry, monkeypatch):
    sent = []

    def palette(name):
        return SimpleNamespace(
            isValid=True,
            sendInfoToHTML=lambda action, data: sent.append((name, action, json.loads(data))),
        )

    entry._palettes = {'parameters': palette('parameters'), 'calculator': palette('calculator')}
    entry._adapter = SimpleNamespace(document_id='doc', invalidate=lambda: None)
    entry._ready_modes.clear()
    monkeypatch.setattr(entry, '_show_palette', lambda mode: None)
    monkeypatch.setattr(
        entry,
        'dispatch',
        lambda adapter, msg: {'requestId': msg['requestId'], 'ok': True, 'data': {}},
    )

    def request(mode, message):
        entry.HtmlHandler(mode).notify(
            SimpleNamespace(action='request', data=json.dumps(message), returnData='')
        )

    request(
        'calculator',
        {
            'requestId': 'open',
            'action': 'parameters.open',
            'documentId': 'doc',
            'payload': {'text': 'a=1'},
        },
    )
    assert not [item for item in sent if item[1] == 'parameters.prefill']
    request('parameters', {'requestId': 'state', 'action': 'state.get'})
    prefill = [item[2] for item in sent if item[1] == 'parameters.prefill'][0]
    assert prefill['text'] == 'a=1' and prefill['documentId'] == 'doc'
    request(
        'parameters',
        {
            'requestId': 'ack',
            'action': 'parameters.prefill.ack',
            'documentId': 'doc',
            'payload': {'prefillId': prefill['prefillId']},
        },
    )
    sent.clear()
    request('parameters', {'requestId': 'state2', 'action': 'state.get'})
    assert not [item for item in sent if item[1] == 'parameters.prefill']
    entry._ready_modes.clear()
    request(
        'calculator',
        {
            'requestId': 'open2',
            'action': 'parameters.open',
            'documentId': 'doc',
            'payload': {'text': 'b=2'},
        },
    )
    entry.DocumentChanged().notify(None)
    entry._adapter.document_id = 'next-doc'
    sent.clear()
    request('parameters', {'requestId': 'state3', 'action': 'state.get'})
    assert not [item for item in sent if item[1] == 'parameters.prefill']


def test_cleanup_is_resized_after_becoming_visible(entry, monkeypatch):
    events = []

    class Palette:
        isValid = True
        width = 359
        height = 449

        def __init__(self):
            self.incomingFromHTML = object()
            self.closed = object()
            self._visible = False

        @property
        def isVisible(self):
            return self._visible

        @isVisible.setter
        def isVisible(self, value):
            self._visible = value
            events.append(('visible', value))

        def setSize(self, width, height):
            events.append(('resize', width, height, self._visible))

        def setPosition(self, left, top):
            events.append(('position', left, top))

    palette = Palette()

    class Palettes:
        def itemById(self, identifier):
            return None

        def add(self, *args):
            events.append(('add', args[7], args[8]))
            return palette

    entry._ui = SimpleNamespace(palettes=Palettes())
    entry._palettes = {'parameters': SimpleNamespace(isValid=True, left=2196, top=385)}
    monkeypatch.setattr(entry.os.path, 'isfile', lambda path: True)
    monkeypatch.setattr(entry, '_listen', lambda event, handler: None)
    entry._show_palette('cleanup')
    assert ('resize', 360, 450, True) in events
    assert ('position', 1824, 285) in events


def test_failed_apply_marks_fusion_transaction_for_abort(entry, monkeypatch):
    entry._pending = {'requestId': 'batch', 'documentId': 'doc'}
    entry._adapter = SimpleNamespace(in_command=False)
    monkeypatch.setattr(
        entry,
        'dispatch',
        lambda adapter, msg: {
            'requestId': msg['requestId'],
            'ok': False,
            'error': {'code': 'INVALID_EXPRESSION', 'message': 'Invalid second expression'},
        },
    )
    args = SimpleNamespace(executeFailed=False, executeFailedMessage='')
    entry.ApplyExecute().notify(args)
    assert args.executeFailed is True
    assert args.executeFailedMessage == 'Invalid second expression'
    assert entry._adapter.in_command is False


def test_palette_titles_identify_each_tool(entry):
    assert entry._TITLES == {'parameters': 'Paramood', 'cleanup': 'Paramood-Cleanup'}


@pytest.mark.parametrize('mode,expected', [('parameters', False), ('cleanup', True)])
def test_close_button_only_on_cleanup(entry, monkeypatch, mode, expected):
    calls = []

    class Palette:
        isValid = True
        width, height = 359, 449
        left, top = 0, 0
        isDockedInCanvas = False
        incomingFromHTML, closed = object(), object()

        def snapTo(self, target, option):
            return True

        def setSize(self, width, height):
            return True

    class Palettes:
        def itemById(self, identifier):
            return Palette() if identifier == 'ActivityFeedPalette' else None

        def add(self, *args):
            calls.append(args)
            return Palette()

    entry._ui = SimpleNamespace(palettes=Palettes())
    entry._palettes = {}
    monkeypatch.setattr(entry.os.path, 'isfile', lambda path: True)
    monkeypatch.setattr(entry, '_listen', lambda event, handler: None)
    entry.adsk.core.PaletteDockingStates = SimpleNamespace(PaletteDockStateRight=4)
    entry._show_palette(mode)
    assert calls[0][4] is expected
    if mode == 'parameters':
        assert entry._palettes[mode].dockingState == 4
        assert entry._palettes[mode].isDockedInCanvas is True


def test_external_command_end_refreshes_palette_without_invalidating_document(entry, monkeypatch):
    events = []
    monkeypatch.setattr(entry, '_broadcast', lambda action, data: events.append((action, data)))
    entry.ExternalCommandEnded().notify(SimpleNamespace(commandId='ChangeParametersCommand'))
    assert events == [('state.changed', {})]
    events.clear()
    entry.ExternalCommandEnded().notify(SimpleNamespace(commandId='SelectCommand'))
    entry.ExternalCommandEnded().notify(SimpleNamespace(commandId='ParamoodApply'))
    assert events == []


def test_document_activation_shows_deferred_palette_only_when_design_exists(entry, monkeypatch):
    shown = []
    entry._palettes = {}
    entry._desired_visibility = {'parameters': True, 'cleanup': False}
    entry._adapter = SimpleNamespace(invalidate=lambda: None, _design=lambda: object())
    monkeypatch.setattr(entry, '_show_palette', lambda mode: shown.append(mode))
    monkeypatch.setattr(entry, '_broadcast', lambda action, data: None)
    entry.DocumentActivated().notify(None)
    assert shown == ['parameters']
    shown.clear()
    entry._adapter._design = lambda: None
    entry.DocumentActivated().notify(None)
    assert shown == []


def test_cleanup_entry_opens_preview_palette(entry, monkeypatch):
    sent = []
    shown = []
    entry._adapter = SimpleNamespace(document_id='doc')
    monkeypatch.setattr(entry, '_send', lambda mode, action, payload: sent.append(payload))
    monkeypatch.setattr(entry, '_show_palette', lambda mode: shown.append(mode))
    message = {'requestId': 'r', 'action': 'cleanup.open', 'documentId': 'doc', 'payload': {}}
    entry.HtmlHandler('parameters').notify(
        SimpleNamespace(action='request', data=json.dumps(message), returnData='')
    )
    assert shown == ['cleanup']
    assert sent[0]['ok'] is True


def test_group_rename_always_starts_a_command_instead_of_direct_apply(entry, monkeypatch):
    started = []
    adapter = SimpleNamespace(
        document_id='doc', in_direct_apply=False, validate_mutation=lambda *args: {}
    )
    monkeypatch.setattr(entry, '_adapter', adapter)
    monkeypatch.setattr(entry, '_pending', None)
    selection = SimpleNamespace(restore=lambda: None)
    monkeypatch.setattr(entry, 'SelectionSnapshot', lambda app, ui: selection)
    definitions = SimpleNamespace(
        itemById=lambda name: SimpleNamespace(execute=lambda: started.append(name) or True)
    )
    monkeypatch.setattr(
        entry,
        '_ui',
        SimpleNamespace(activeCommand='SelectCommand', commandDefinitions=definitions),
    )
    message = {
        'requestId': 'r',
        'action': 'parameters.renameGroup',
        'documentId': 'doc',
        'payload': {},
    }
    args = SimpleNamespace(action='request', data=json.dumps(message), returnData='')
    entry.HtmlHandler('parameters').notify(args)
    assert args.returnData == 'OK'
    assert started == ['ParamoodApply']
    assert entry._pending == message
    assert entry._pending_selection == selection
    assert not adapter.in_direct_apply


@pytest.fixture
def native_transaction(entry, monkeypatch):
    """Real bridge/adapter with a native preview and an abortable command transaction."""
    import copy

    events, responses, command_args = [], [], []

    class Parameters(list):
        def itemByName(self, name):
            return next((p for p in self if p.name == name), None)

    class Attributes:
        raw = ''
        fail = False

        def itemByName(self, *args):
            return SimpleNamespace(value=self.raw) if self.raw else None

        def add(self, group, name, raw):
            events.append('metadata.write')
            if self.fail:
                return None
            self.raw = raw
            return SimpleNamespace(value=raw)

    parameter = SimpleNamespace(
        name='tray_depth',
        entityToken='persistent-token',
        expression='10 mm',
        unit='mm',
        value=1.0,
        valueType=0,
        isFavorite=False,
        dependencyParameters=[],
        dependentParameters=[],
    )
    params, attributes = Parameters([parameter]), Attributes()
    original = dict(vars(parameter))
    design = SimpleNamespace(
        allParameters=params,
        userParameters=params,
        attributes=attributes,
        findEntityByToken=lambda token: [p for p in params if p.entityToken == token],
        fusionUnitsManager=SimpleNamespace(
            defaultLengthUnits='mm',
            formatUnits=lambda unit: '',
            isValidExpression=lambda expression, unit: True,
        ),
        modifyParameters=lambda parameters, expressions: (
            [setattr(p, 'expression', e) for p, e in zip(parameters, expressions)] or True
        ),
    )
    entry.adsk.core.ValueInput = SimpleNamespace(createByString=lambda value: value)
    entry.adsk.fusion.ParameterValueTypes = SimpleNamespace(
        NumericParameterValueType=0, TextParameterValueType=1
    )
    entry.adsk.fusion.Design = SimpleNamespace(cast=lambda product: product)
    entry.adsk.fusion.ModelParameter = SimpleNamespace(cast=lambda p: None)
    app = SimpleNamespace(activeDocument=object(), activeProduct=design, log=pytest.fail)
    ui = SimpleNamespace(activeCommand='CircleCenterRadius', selection_available=True)
    app.userInterface = ui
    adapter = entry.FusionAdapter(app)
    entry._app, entry._ui, entry._adapter = app, ui, adapter
    document_id = adapter.document_id
    ui.on_terminate = lambda: None

    def terminate():
        events.append('native.terminate')
        if ui.activeCommand == 'CircleCenterRadius':
            vars(parameter).update(original)  # The native preview discards palette writes too.
            ui.on_terminate()
        ui.activeCommand = 'SelectCommand'
        return True

    def execute():
        assert ui.activeCommand == 'SelectCommand'
        events.append('transaction.start')
        before, raw = copy.deepcopy(vars(parameter)), attributes.raw
        ui.activeCommand = 'ParamoodApply'
        args = SimpleNamespace(executeFailed=False, executeFailedMessage='')
        entry.ApplyExecute().notify(args)
        command_args.append(args)
        if args.executeFailed:
            vars(parameter).clear()
            vars(parameter).update(before)
            attributes.raw = raw
            events.append('transaction.abort')
        else:
            events.append('transaction.commit')
        ui.activeCommand = 'SelectCommand'
        entry.ApplyDestroy().notify(None)
        return True

    def selection(*args):
        if not ui.selection_available:
            raise entry.SelectionUnavailable()
        return SimpleNamespace(
            restore=lambda: pytest.fail('Never restore a native preview selection')
        )

    monkeypatch.setattr(entry, 'SelectionSnapshot', selection)
    monkeypatch.setattr(entry, '_send', lambda mode, action, response: responses.append(response))
    monkeypatch.setattr(entry, '_broadcast', lambda *args: None)
    ui.terminateActiveCommand = terminate
    ui.commandDefinitions = SimpleNamespace(itemById=lambda name: SimpleNamespace(execute=execute))

    def request(action, payload, **overrides):
        message = {
            'requestId': 'native-r',
            'documentId': document_id,
            'action': action,
            'payload': payload,
            **overrides,
        }
        args = SimpleNamespace(action='request', data=json.dumps(message), returnData='')
        entry.HtmlHandler('parameters').notify(args)
        assert args.returnData == 'OK'
        return responses[-1]

    return SimpleNamespace(
        request=request,
        parameter=parameter,
        adapter=adapter,
        design=design,
        app=app,
        ui=ui,
        events=events,
        responses=responses,
        command_args=command_args,
        attributes=attributes,
    )


def _native_payload(action):
    identity = {'name': 'tray_depth', 'entityToken': 'persistent-token'}
    if action == 'parameters.rename':
        return {**identity, 'expression': '10 mm', 'unit': 'mm', 'newName': 'tray_height'}
    return {**identity, 'expected': False, 'favorite': True}


@pytest.mark.parametrize('action', ['parameters.rename', 'parameters.favorite'])
@pytest.mark.parametrize('selection_available', [True, False])
def test_native_palette_write_survives_preview_termination(
    native_transaction, action, selection_available
):
    model = native_transaction
    model.ui.selection_available = selection_available
    response = model.request(action, _native_payload(action))
    assert response['ok']
    assert model.events == ['native.terminate', 'transaction.start', 'transaction.commit']
    assert model.ui.activeCommand == 'SelectCommand'
    model.ui.terminateActiveCommand()
    if action == 'parameters.rename':
        assert model.parameter.name == 'tray_height'
    else:
        assert model.parameter.isFavorite
    assert model.parameter.entityToken == 'persistent-token'


@pytest.mark.parametrize('action', ['parameters.rename', 'parameters.favorite'])
@pytest.mark.parametrize('invalid', ['requestId', 'documentId', 'payload', 'identity', 'state'])
def test_invalid_mutation_leaves_native_preview_running(native_transaction, action, invalid):
    model = native_transaction
    payload, overrides = _native_payload(action), {}
    if invalid in ('requestId', 'documentId'):
        overrides[invalid] = ''
    elif invalid == 'payload':
        payload = []
    elif invalid == 'identity':
        payload['entityToken'] = 'missing'
    elif action == 'parameters.favorite':
        payload['expected'] = True
    else:
        payload['expression'] = '20 mm'
    response = model.request(action, payload, **overrides)
    assert not response['ok']
    assert model.ui.activeCommand == 'CircleCenterRadius'
    assert model.events == []
    assert model.parameter.name == 'tray_depth'
    assert not model.parameter.isFavorite


@pytest.mark.parametrize('action', ['parameters.rename', 'parameters.favorite'])
@pytest.mark.parametrize('changed', ['document', 'entity', 'expression', 'variants'])
def test_post_preview_revalidation_rejects_without_partial_write(
    native_transaction, action, changed
):
    from Paramood.core.variants import encode_variants

    model = native_transaction

    def change():
        if changed == 'document':
            model.app.activeDocument = object()
        elif changed == 'entity':
            model.parameter.entityToken = 'new-entity'
        elif changed == 'expression':
            model.parameter.expression = '30 mm'
        else:
            model.attributes.raw = encode_variants([], [])

    model.ui.on_terminate = change
    response = model.request(action, _native_payload(action))
    assert not response['ok']
    assert model.events == ['native.terminate', 'transaction.start', 'transaction.abort']
    assert model.command_args[-1].executeFailed
    assert model.parameter.name == 'tray_depth'
    assert not model.parameter.isFavorite


def test_rename_metadata_failure_aborts_name_and_saved_variants(native_transaction):
    from Paramood.core.variants import encode_variants

    model = native_transaction
    parameter_entry = model.adapter._variant_entry(model.parameter)
    model.attributes.raw = encode_variants(
        [{'id': 'v', 'name': 'Base', 'parameters': [parameter_entry], 'features': []}],
        [
            {
                'kind': 'parameter',
                'name': 'tray_depth',
                'entityToken': 'persistent-token',
                'unit': 'mm',
            }
        ],
    )
    before = model.attributes.raw
    model.attributes.fail = True
    response = model.request('parameters.rename', _native_payload('parameters.rename'))
    assert not response['ok']
    assert response['error']['code'] == 'RENAME_FAILED'
    assert model.parameter.name == 'tray_depth'
    assert model.attributes.raw == before
    assert model.events[-2:] == ['metadata.write', 'transaction.abort']


@pytest.mark.parametrize(
    'action', ['variants.table.save', 'variants.apply', 'variants.delete', 'variants.free']
)
@pytest.mark.parametrize('stale_after_preview', [True, False])
def test_variant_mutations_use_original_snapshot_and_one_transaction(
    native_transaction, action, stale_after_preview
):
    from Paramood.core.variants import encode_variants

    model = native_transaction
    row = {
        'id': 'v',
        'name': 'Base',
        'parameters': [model.adapter._variant_entry(model.parameter)],
        'features': [],
    }
    columns = [
        {'kind': 'parameter', 'name': 'tray_depth', 'entityToken': 'persistent-token', 'unit': 'mm'}
    ]
    model.attributes.raw = encode_variants([row], columns)
    state = model.adapter._variants_state(model.design)
    payload = {
        'variantsToken': state['variantsToken'],
        'snapshotToken': state['variantSnapshotToken'],
        'id': 'v',
        'columns': columns,
        'variants': [row],
    }
    if stale_after_preview:
        model.ui.on_terminate = lambda: setattr(model.parameter, 'expression', '30 mm')
    response = model.request(action, payload)
    assert response['ok'] is not stale_after_preview
    if stale_after_preview:
        assert response['error']['code'] == 'CONFLICT'
        assert 'metadata.write' not in model.events
        assert model.events[-1] == 'transaction.abort'
    else:
        assert model.events[-1] == 'transaction.commit'
        assert model.events.count('transaction.start') == 1
    assert model.ui.activeCommand == 'SelectCommand'


@pytest.mark.parametrize(
    'action', ['variants.table.save', 'variants.apply', 'variants.delete', 'variants.free']
)
def test_invalid_variant_mutation_does_not_cancel_native_command(native_transaction, action):
    model = native_transaction
    sessions = dict(model.adapter._variant_sessions)
    raw = model.attributes.raw
    response = model.request(
        action, {'id': 'missing', 'snapshotToken': 'stale', 'variantsToken': 'stale'}
    )
    assert not response['ok']
    assert model.events == []
    assert model.ui.activeCommand == 'CircleCenterRadius'
    assert model.attributes.raw == raw
    assert model.adapter._variant_sessions == sessions


def test_group_rename_preflight_and_transaction_share_identity_checks(native_transaction):
    model = native_transaction
    payload = {
        'group': 'tray',
        'newGroup': 'box',
        'parameters': [
            {
                'name': 'tray_depth',
                'entityToken': 'persistent-token',
                'expression': '10 mm',
                'unit': 'mm',
            }
        ],
    }
    response = model.request('parameters.renameGroup', payload)
    assert response['ok']
    assert response['data']['renamed'] == {'tray_depth': 'box_depth'}
    assert model.parameter.name == 'box_depth'
    assert model.events == ['native.terminate', 'transaction.start', 'transaction.commit']


def test_delete_rechecks_target_after_preview_before_first_write(native_transaction):
    model = native_transaction
    calls = []
    model.parameter.deleteMe = lambda: calls.append(True) or True
    model.ui.on_terminate = lambda: setattr(model.parameter, 'expression', '30 mm')
    response = model.request(
        'parameters.delete', {'name': 'tray_depth', 'entityToken': 'persistent-token'}
    )
    assert not response['ok']
    assert response['error']['code'] == 'CONFLICT'
    assert calls == []
    assert model.events[-1] == 'transaction.abort'


@pytest.mark.parametrize('terminate', ['false', 'still-active'])
def test_cannot_confirm_native_termination_never_starts_mutation(native_transaction, terminate):
    model = native_transaction
    model.ui.terminateActiveCommand = lambda: terminate != 'false'
    response = model.request('parameters.favorite', _native_payload('parameters.favorite'))
    assert not response['ok']
    assert response['error']['code'] == 'COMMAND_FAILED'
    assert model.events == []
    assert not model.parameter.isFavorite


@pytest.mark.parametrize('scenario', ['valid', 'stale-after-preview', 'invalid-unit'])
def test_document_units_validate_before_cancel_and_recheck_snapshot(
    native_transaction, entry, scenario
):
    model = native_transaction

    class Units:
        defaultLengthUnits = 'mm'
        writes = 0

        @property
        def distanceDisplayUnits(self):
            return self.defaultLengthUnits

        @distanceDisplayUnits.setter
        def distanceDisplayUnits(self, value):
            self.writes += 1
            self.defaultLengthUnits = value

    manager = Units()
    model.design.fusionUnitsManager = manager
    entry.adsk.fusion.DistanceUnits = SimpleNamespace(CentimeterDistanceUnits='cm')
    token = model.adapter._snapshot_token(model.design, 'units')
    if scenario == 'stale-after-preview':
        model.ui.on_terminate = lambda: setattr(model.parameter, 'expression', '30 mm')
    response = model.request(
        'document.units',
        {
            'snapshotToken': token,
            'unit': 'unsupported' if scenario == 'invalid-unit' else 'cm',
        },
    )
    if scenario == 'valid':
        assert response['ok']
        assert manager.writes == 1
        assert model.parameter.value == 1.0
        assert model.events[-1] == 'transaction.commit'
    else:
        assert not response['ok']
        assert manager.writes == 0
        if scenario == 'invalid-unit':
            assert model.events == []
            assert model.ui.activeCommand == 'CircleCenterRadius'
        else:
            assert response['error']['code'] == 'CONFLICT'
            assert model.events[-1] == 'transaction.abort'


def test_command_start_exception_clears_pending_request_and_reports_failure(
    native_transaction, entry
):
    model = native_transaction
    logs = []
    model.app.log = logs.append

    def fail():
        raise RuntimeError('Command start failed')

    model.ui.commandDefinitions.itemById = lambda name: SimpleNamespace(execute=fail)
    response = model.request('parameters.favorite', _native_payload('parameters.favorite'))
    assert response['error']['code'] == 'COMMAND_FAILED'
    assert not model.parameter.isFavorite
    assert entry._pending is None
    assert entry._pending_validation is None
    assert entry._pending_selection is None
    assert logs
