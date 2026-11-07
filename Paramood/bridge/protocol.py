"""Small transport-independent request validation layer."""


class BridgeError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def dispatch(adapter, message):
    request_id = message.get('requestId') if isinstance(message, dict) else None
    try:
        if not isinstance(request_id, str) or not request_id:
            raise BridgeError('BAD_REQUEST', 'A request ID is required.')
        action = message.get('action')
        payload = message.get('payload', {})
        if not isinstance(payload, dict):
            raise BridgeError('BAD_REQUEST', 'Payload must be an object.')
        if action not in {
            'state.get',
            'parameters.preview',
            'parameters.apply',
            'parameters.delete',
            'parameters.rename',
            'parameters.favorite',
            'calculator.evaluate',
            'cleanup.analyze',
            'cleanup.delete',
        }:
            raise BridgeError('BAD_REQUEST', 'Unknown action.')
        if action != 'state.get':
            if not adapter.document_id:
                raise BridgeError('NO_DESIGN', 'Open a Fusion design first.')
            if message.get('documentId') != adapter.document_id:
                raise BridgeError(
                    'STALE_DOCUMENT', 'The active document changed. Refresh and try again.'
                )
        if action == 'cleanup.delete':
            raise BridgeError(
                'UNSUPPORTED', 'Deletion is disabled until dependency coverage is verified.'
            )
        data = adapter.state() if action == 'state.get' else adapter.request(action, payload)
        return {
            'requestId': request_id,
            'ok': True,
            'data': data,
            'documentId': adapter.document_id,
        }
    except BridgeError as exc:
        return {
            'requestId': request_id,
            'ok': False,
            'error': {'code': exc.code, 'message': str(exc)},
            'documentId': adapter.document_id,
        }
    except Exception as exc:
        return {
            'requestId': request_id,
            'ok': False,
            'error': {'code': 'OPERATION_FAILED', 'message': str(exc)},
            'documentId': adapter.document_id,
        }
