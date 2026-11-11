from types import SimpleNamespace

import pytest

from Paramood.fusion.selection import preserve_selection


@pytest.fixture
def context():
    entities = [SimpleNamespace(isValid=True, index=i) for i in range(3)]
    selected = list(entities)
    added, logs = [], []

    class Selections:
        @property
        def count(self):
            return len(selected)

        def item(self, index):
            return SimpleNamespace(entity=selected[index])

        def add(self, entity):
            added.append(entity)
            selected.append(entity)
            return True

    return SimpleNamespace(
        entities=entities,
        selected=selected,
        added=added,
        logs=logs,
        app=SimpleNamespace(activeDocument=object(), log=logs.append),
        ui=SimpleNamespace(activeCommand='UnknownCommand', activeSelections=Selections()),
    )


@pytest.mark.parametrize('change', ['document', 'command', 'new_selection'])
def test_changed_context_is_not_overwritten(context, change):
    with preserve_selection(context.app, context.ui):
        context.selected.clear()
        if change == 'document':
            context.app.activeDocument = object()
        elif change == 'command':
            context.ui.activeCommand = 'OtherCommand'
        else:
            context.selected.append(SimpleNamespace(isValid=True, index=99))
    assert context.added == []


def test_surviving_selections_are_not_added_again(context):
    with preserve_selection(context.app, context.ui):
        context.selected.pop()
    assert context.selected == context.entities
    assert context.added == [context.entities[-1]]


def test_deleted_entities_are_not_reselected(context):
    with preserve_selection(context.app, context.ui):
        context.selected.clear()
        context.entities[1].isValid = False
    assert context.selected == [context.entities[0], context.entities[2]]


def test_original_error_is_preserved_and_selection_is_restored(context):
    with pytest.raises(ValueError, match='original failure'):
        with preserve_selection(context.app, context.ui):
            context.selected.clear()
            raise ValueError('original failure')
    assert context.selected == context.entities


def test_restore_failure_does_not_turn_completed_write_into_error(context):
    def reject(entity):
        raise RuntimeError('Selection rejected by Fusion')

    context.ui.activeSelections.add = reject
    with preserve_selection(context.app, context.ui):
        context.selected.clear()
    assert 'Selection rejected by Fusion' in context.logs[0]


def test_command_change_during_add_stops_further_restoration(context):
    original_add = context.ui.activeSelections.add

    def change_command(entity):
        result = original_add(entity)
        context.ui.activeCommand = 'OtherCommand'
        return result

    context.ui.activeSelections.add = change_command
    with preserve_selection(context.app, context.ui):
        context.selected.clear()
    assert context.selected == context.entities[:1]


def test_unavailable_preview_selection_is_reported_before_a_direct_write(context):
    context.selected[:] = [None]
    with pytest.raises(RuntimeError, match='expose'):
        with preserve_selection(context.app, context.ui):
            pytest.fail('An inaccessible preview selection cannot safely be restored')
    assert context.selected == [None]
