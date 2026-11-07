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
        'CommandEventHandler',
        'CommandCreatedEventHandler',
        'DocumentEventHandler',
        'WorkspaceEventHandler',
        'UserInterfaceGeneralEventHandler',
        'ApplicationCommandEventHandler',
    ):
        setattr(core, name, type(name, (), {}))
    adsk.core, adsk.fusion = core, fusion
    for name, value in [('adsk', adsk), ('adsk.core', core), ('adsk.fusion', fusion)]:
        monkeypatch.setitem(sys.modules, name, value)
    sys.modules.pop('Paramood.Paramood', None)
    sys.modules.pop('Paramood.fusion.adapter', None)
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


@pytest.mark.parametrize(
    ('command', 'sketch'),
    [
        ('SketchDimension', True),
        ('Extrude', False),
        ('Fillet', False),
        ('SelectCommand', True),
    ],
)
@pytest.mark.parametrize('success', [True, False])
def test_apply_in_active_context_dispatches_without_starting_command(
    entry, monkeypatch, command, sketch, success
):
    sent = []
    definitions = SimpleNamespace(
        itemById=lambda _id: pytest.fail('Must not start another command')
    )
    monkeypatch.setattr(
        entry, '_ui', SimpleNamespace(activeCommand=command, commandDefinitions=definitions)
    )
    adapter = SimpleNamespace(
        document_id='doc', in_direct_apply=False, is_sketch_edit=lambda: sketch
    )
    monkeypatch.setattr(entry, '_adapter', adapter)
    monkeypatch.setattr(entry, '_pending', None)
    monkeypatch.setattr(
        entry, '_send', lambda mode, action, data: sent.append((mode, action, data))
    )
    monkeypatch.setattr(
        entry, '_broadcast', lambda action, data: sent.append(('all', action, data))
    )

    def dispatch(a, message):
        assert a.in_direct_apply
        assert entry._pending == message
        return {'requestId': 'r', 'ok': success}

    monkeypatch.setattr(entry, 'dispatch', dispatch)
    args = SimpleNamespace(
        action='request',
        data=json.dumps({'requestId': 'r', 'action': 'parameters.apply'}),
        returnData='',
    )
    entry.HtmlHandler('parameters').notify(args)
    assert args.returnData == 'OK'
    assert sent == [
        ('parameters', 'response', {'requestId': 'r', 'ok': success}),
        ('all', 'state.changed', {}),
    ]
    assert entry._pending is None
    assert not adapter.in_direct_apply


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

    palette = Palette()

    class Palettes:
        def itemById(self, identifier):
            return None

        def add(self, *args):
            events.append(('add', args[7], args[8]))
            return palette

    entry._ui = SimpleNamespace(palettes=Palettes())
    entry._palettes = {}
    monkeypatch.setattr(entry.os.path, 'isfile', lambda path: True)
    monkeypatch.setattr(entry, '_listen', lambda event, handler: None)
    entry._show_palette('cleanup')
    assert ('resize', 360, 450, True) in events


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


def test_release_blocks_hidden_cleanup_entry(entry, monkeypatch):
    sent = []
    shown = []
    entry._adapter = SimpleNamespace(document_id='doc')
    monkeypatch.setattr(entry, '_send', lambda mode, action, payload: sent.append(payload))
    monkeypatch.setattr(entry, '_show_palette', lambda mode: shown.append(mode))
    message = {'requestId': 'r', 'action': 'cleanup.open', 'documentId': 'doc', 'payload': {}}
    entry.HtmlHandler('parameters').notify(
        SimpleNamespace(action='request', data=json.dumps(message), returnData='')
    )
    assert not shown
    assert sent[0]['ok'] is False
    assert sent[0]['error']['code'] == 'UNSUPPORTED'
