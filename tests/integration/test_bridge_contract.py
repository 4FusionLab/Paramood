from Paramood.bridge.protocol import dispatch


class FakeAdapter:
    document_id = 'doc-1'

    def state(self):
        return {'documentId': self.document_id}

    def request(self, action, payload):
        return {'action': action}


def test_rejects_stale_mutations_without_calling_adapter():
    adapter = FakeAdapter()
    result = dispatch(
        adapter,
        {'requestId': 'r', 'action': 'parameters.apply', 'documentId': 'old', 'payload': {}},
    )
    assert result['ok'] is False
    assert result['error']['code'] == 'STALE_DOCUMENT'


def test_cleanup_is_forwarded_for_adapter_safety_validation():
    result = dispatch(
        FakeAdapter(),
        {
            'requestId': 'r',
            'action': 'cleanup.delete',
            'documentId': 'doc-1',
            'payload': {'names': ['a']},
        },
    )
    assert result['ok'] is True
    assert result['data']['action'] == 'cleanup.delete'


def test_echoes_request_id_and_state():
    result = dispatch(FakeAdapter(), {'requestId': '42', 'action': 'state.get', 'payload': {}})
    assert result == {
        'requestId': '42',
        'ok': True,
        'data': {'documentId': 'doc-1'},
        'documentId': 'doc-1',
    }


def test_unknown_action_is_structured_error():
    result = dispatch(FakeAdapter(), {'requestId': 'r', 'action': 'unknown'})
    assert result['requestId'] == 'r'
    assert result['error']['code'] == 'BAD_REQUEST'


def test_no_design_rejects_apply():
    adapter = FakeAdapter()
    adapter.document_id = None
    result = dispatch(adapter, {'requestId': 'r', 'action': 'parameters.apply', 'payload': {}})
    assert result['error']['code'] == 'NO_DESIGN'


def test_favorite_requires_current_document():
    adapter = FakeAdapter()
    result = dispatch(
        adapter,
        {'requestId': 'r', 'action': 'parameters.favorite', 'documentId': 'old', 'payload': {}},
    )
    assert result['error']['code'] == 'STALE_DOCUMENT'
