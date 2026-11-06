"""Fusion entry point. All model changes run on Fusion's main thread."""

import json
import os
from pathlib import Path
import traceback
import uuid

import adsk.core
import adsk.fusion

from .bridge.protocol import dispatch
from .fusion.adapter import FusionAdapter

_app = None
_ui = None
_adapter = None
_palettes = {}
_handlers = []
_controls = []
_definitions = []
_pending = None
_result = None
_pending_prefill = None
_pending_palette = None
_ready_modes = set()
_desired_visibility = {'parameters': True, 'cleanup': False}


def _listen(event, handler):
    event.add(handler)
    _handlers.append((event, handler))


def _send(mode, action, data):
    palette = _palettes.get(mode)
    if palette and palette.isValid:
        palette.sendInfoToHTML(action, json.dumps(data))


def _broadcast(action, data):
    for mode in list(_palettes):
        _send(mode, action, data)


def _respond(mode, message):
    _send(mode, 'response', dispatch(_adapter, message))


class HtmlHandler(adsk.core.HTMLEventHandler):
    def __init__(self, mode):
        super().__init__()
        self.mode = mode

    def notify(self, args):
        global _pending, _pending_palette, _pending_prefill
        try:
            if args.action != 'request':
                return
            message = json.loads(args.data)
            if not isinstance(message, dict):
                return
            action = message.get('action')
            if action == 'cleanup.open':
                _send(
                    self.mode,
                    'response',
                    {
                        'requestId': message.get('requestId'),
                        'ok': False,
                        'error': {
                            'code': 'UNSUPPORTED',
                            'message': 'Cleanup is unavailable in this release.',
                        },
                        'documentId': _adapter.document_id,
                    },
                )
                args.returnData = 'OK'
                return
            if action in ('cleanup.open', 'parameters.open', 'parameters.prefill.ack'):
                request_id = message.get('requestId')
                if not isinstance(request_id, str) or not request_id:
                    raise ValueError('Missing request ID')
                if not _adapter.document_id or message.get('documentId') != _adapter.document_id:
                    _send(
                        self.mode,
                        'response',
                        {
                            'requestId': request_id,
                            'ok': False,
                            'error': {
                                'code': 'STALE_DOCUMENT',
                                'message': 'The active document changed.',
                            },
                            'documentId': _adapter.document_id,
                        },
                    )
                else:
                    if action == 'cleanup.open':
                        _show_palette('cleanup')
                    elif action == 'parameters.prefill.ack':
                        ack = message.get('payload', {}).get('prefillId')
                        if (
                            self.mode != 'parameters'
                            or not _pending_prefill
                            or ack != _pending_prefill['prefillId']
                        ):
                            raise ValueError('Unexpected prefill acknowledgement')
                        _pending_prefill = None
                    else:
                        text = message.get('payload', {}).get('text')
                        if not isinstance(text, str) or len(text) > 10000:
                            raise ValueError('Invalid prefill text')
                        _pending_prefill = {
                            'text': text,
                            'documentId': _adapter.document_id,
                            'prefillId': uuid.uuid4().hex,
                        }
                        _show_palette('parameters')
                        if 'parameters' in _ready_modes:
                            _send('parameters', 'parameters.prefill', _pending_prefill)
                    _send(
                        self.mode,
                        'response',
                        {
                            'requestId': request_id,
                            'ok': True,
                            'data': {},
                            'documentId': _adapter.document_id,
                        },
                    )
            elif action in ('parameters.apply', 'parameters.delete', 'parameters.rename'):
                active_command = _ui.activeCommand
                if _pending is not None:
                    _send(
                        self.mode,
                        'response',
                        {
                            'requestId': message.get('requestId'),
                            'ok': False,
                            'error': {
                                'code': 'BUSY',
                                'message': 'Wait for the previous parameter operation to finish.',
                            },
                            'documentId': _adapter.document_id,
                        },
                    )
                elif active_command != 'SelectCommand' or _adapter.is_sketch_edit():
                    _pending = message
                    _adapter.in_direct_apply = True
                    try:
                        result = dispatch(_adapter, message)
                    finally:
                        _adapter.in_direct_apply = False
                        _pending = None
                    _send(self.mode, 'response', result)
                    _broadcast('state.changed', {})
                else:
                    _pending = message
                    _pending_palette = self.mode
                    if not _ui.commandDefinitions.itemById('ParamoodApply').execute():
                        _pending = None
                        _pending_palette = None
                        _send(
                            self.mode,
                            'response',
                            {
                                'requestId': message.get('requestId'),
                                'ok': False,
                                'error': {
                                    'code': 'COMMAND_FAILED',
                                    'message': 'Fusion could not start the command.',
                                },
                                'documentId': _adapter.document_id,
                            },
                        )
            else:
                _respond(self.mode, message)
                if action == 'state.get':
                    _ready_modes.add(self.mode)
                if action == 'state.get' and self.mode == 'parameters' and _pending_prefill:
                    if _pending_prefill['documentId'] == _adapter.document_id:
                        _send('parameters', 'parameters.prefill', _pending_prefill)
                    else:
                        _pending_prefill = None
            args.returnData = 'OK'
        except Exception:
            args.returnData = 'ERROR'
            if _app:
                _app.log(traceback.format_exc())


class ApplyExecute(adsk.core.CommandEventHandler):
    def notify(self, args):
        global _result
        _adapter.in_command = True
        try:
            _result = dispatch(_adapter, _pending)
            if not _result['ok']:
                args.executeFailed = True
                args.executeFailedMessage = _result['error']['message']
        except Exception:
            args.executeFailed = True
            args.executeFailedMessage = (
                'Unexpected error during parameter creation. The transaction was aborted.'
            )
            _result = {
                'requestId': _pending.get('requestId') if _pending else None,
                'ok': False,
                'error': {'code': 'OPERATION_FAILED', 'message': args.executeFailedMessage},
                'documentId': _pending.get('documentId') if _pending else None,
            }
            _app.log(traceback.format_exc())
        finally:
            _adapter.in_command = False


class ApplyDestroy(adsk.core.CommandEventHandler):
    def notify(self, args):
        global _pending, _result, _pending_palette
        if _pending is not None:
            result = _result or {
                'requestId': _pending.get('requestId'),
                'ok': False,
                'error': {'code': 'CANCELLED', 'message': 'The operation was cancelled.'},
                'documentId': _adapter.document_id,
            }
            mode = _pending_palette
            _pending = None
            _result = None
            _pending_palette = None
            _send(mode, 'response', result)
            _broadcast('state.changed', {})


class ApplyCreated(adsk.core.CommandCreatedEventHandler):
    def notify(self, args):
        _listen(args.command.execute, ApplyExecute())
        _listen(args.command.destroy, ApplyDestroy())


_PALETTE_IDS = {'parameters': 'ParamoodParameters', 'cleanup': 'ParamoodCleanupPalette'}
_TITLES = {'parameters': 'Paramood', 'cleanup': 'Paramood-Cleanup'}


class PaletteClosed(adsk.core.UserInterfaceGeneralEventHandler):
    def __init__(self, mode):
        super().__init__()
        self.mode = mode

    def notify(self, args):
        _desired_visibility[self.mode] = False


def _show_palette(mode):
    _desired_visibility[mode] = True
    palette = _ui.palettes.itemById(_PALETTE_IDS[mode])
    if not palette:
        embedded = os.path.join(os.path.dirname(__file__), 'frontend', 'dist', 'index.html')
        sibling = os.path.join(os.path.dirname(__file__), '..', 'frontend', 'dist', 'index.html')
        html = os.path.abspath(embedded if os.path.isfile(embedded) else sibling)
        if not os.path.isfile(html):
            raise RuntimeError('Build frontend before starting Paramood.')
        palette = _ui.palettes.add(
            _PALETTE_IDS[mode],
            _TITLES[mode],
            Path(html).as_uri() + '#' + mode,
            False,
            mode == 'cleanup',
            True,
            359 if mode == 'cleanup' else 360,
            449 if mode == 'cleanup' else 260,
            True,
        )
        if not palette:
            raise RuntimeError('Fusion could not create palette ' + mode)
        _palettes[mode] = palette
        _ready_modes.discard(mode)
        _listen(palette.incomingFromHTML, HtmlHandler(mode))
        _listen(palette.closed, PaletteClosed(mode))
        if mode == 'cleanup':
            anchor = _palettes.get('parameters')
            if anchor and anchor.isValid:
                palette.setPosition(anchor.left + anchor.width, max(0, anchor.top - 100))
        if mode == 'parameters':
            palette.isVisible = True
            if hasattr(palette, 'isDockedInCanvas'):
                palette.isDockedInCanvas = True
            target = _ui.palettes.itemById('ActivityFeedPalette')
            try:
                snapped = bool(
                    target
                    and palette.snapTo(target, adsk.core.PaletteSnapOptions.PaletteSnapOptionsTop)
                )
            except Exception:
                snapped = False
            if not snapped:
                palette.dockingState = adsk.core.PaletteDockingStates.PaletteDockStateLeft
                _app.log('Paramood: snap to Comments unavailable; docked to the left edge.')
    else:
        _palettes[mode] = palette
    palette.isVisible = True
    if mode == 'cleanup' and palette.width == 359 and palette.height == 449:
        # Fusion's hidden WebView may stay at its initial tiny size until resized.
        palette.setSize(360, 450)
    return palette


class ShowExecute(adsk.core.CommandEventHandler):
    def __init__(self, mode):
        super().__init__()
        self.mode = mode

    def notify(self, args):
        try:
            _show_palette(self.mode)
        except Exception:
            _app.log(traceback.format_exc())


class ShowCreated(adsk.core.CommandCreatedEventHandler):
    def __init__(self, mode):
        super().__init__()
        self.mode = mode

    def notify(self, args):
        _listen(args.command.execute, ShowExecute(self.mode))


class WorkspaceChanged(adsk.core.WorkspaceEventHandler):
    def notify(self, args):
        try:
            if not _adapter or not _adapter._design():
                return
            for mode in ('parameters', 'cleanup'):
                if _desired_visibility[mode]:
                    _show_palette(mode)
        except Exception:
            _app.log(traceback.format_exc())


class DocumentChanged(adsk.core.DocumentEventHandler):
    def notify(self, args):
        global _pending_prefill
        _pending_prefill = None
        _adapter.invalidate()
        _broadcast('state.changed', {})


class DocumentActivated(adsk.core.DocumentEventHandler):
    def notify(self, args):
        try:
            DocumentChanged().notify(args)
            if _adapter._design():
                for mode in ('parameters', 'cleanup'):
                    if _desired_visibility[mode] and mode not in _palettes:
                        _show_palette(mode)
        except Exception:
            if _app:
                _app.log(traceback.format_exc())


class ExternalCommandEnded(adsk.core.ApplicationCommandEventHandler):
    def notify(self, args):
        if args.commandId not in ('SelectCommand', 'ParamoodApply'):
            _broadcast('state.changed', {})


def _definition(identifier, name, handler):
    existing = _ui.commandDefinitions.itemById(identifier)
    if existing:
        existing.deleteMe()
    definition = _ui.commandDefinitions.addButtonDefinition(identifier, name, name)
    _definitions.append(definition)
    _listen(definition.commandCreated, handler)
    return definition


def run(context):
    global _app, _ui, _adapter
    try:
        _app = adsk.core.Application.get()
        _ui = _app.userInterface
        _adapter = FusionAdapter(_app)
        _definition('ParamoodApply', 'Apply Paramood Parameter', ApplyCreated())
        show = _definition('ParamoodShow', 'Paramood', ShowCreated('parameters'))
        panel = _ui.allToolbarPanels.itemById('SolidScriptsAddinsPanel')
        if panel:
            control = panel.controls.itemById('ParamoodShow')
            if control:
                control.deleteMe()
            _controls.append(panel.controls.addCommand(show))
            old_calculator = panel.controls.itemById('ParamoodCalculator')
            if old_calculator:
                old_calculator.deleteMe()
            old_cleanup = panel.controls.itemById('ParamoodCleanup')
            if old_cleanup:
                old_cleanup.deleteMe()
        _listen(_app.documentActivated, DocumentActivated())
        for event in (_app.documentClosed, _app.documentOpened):
            _listen(event, DocumentChanged())
        _listen(_ui.commandTerminated, ExternalCommandEnded())
        _listen(_ui.workspaceActivated, WorkspaceChanged())
        if _adapter._design():
            _show_palette('parameters')
    except Exception:
        if _app:
            _app.log(traceback.format_exc())
        stop(context)
        raise


def stop(context):
    global _pending, _result, _pending_palette, _pending_prefill
    for event, handler in reversed(_handlers):
        try:
            event.remove(handler)
        except Exception:
            pass
    _handlers.clear()
    for control in _controls:
        try:
            control.deleteMe()
        except Exception:
            pass
    _controls.clear()
    for definition in _definitions:
        try:
            definition.deleteMe()
        except Exception:
            pass
    _definitions.clear()
    for palette in _palettes.values():
        if palette and palette.isValid:
            palette.deleteMe()
    _palettes.clear()
    _ready_modes.clear()
    _pending = None
    _pending_palette = None
    _pending_prefill = None
    _result = None
