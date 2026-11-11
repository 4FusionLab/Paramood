"""Preserve Fusion's public selection set without inspecting command inputs.

Call only on Fusion's main thread. This cannot reconstruct invalid geometry or
private selection groups that a command does not expose through activeSelections.
"""

from contextlib import contextmanager


class SelectionUnavailable(RuntimeError):
    pass


class SelectionSnapshot:
    def __init__(self, app, ui):
        self.app, self.ui = app, ui
        self.document, self.command, self.saved = None, None, []
        if not app:
            return
        try:
            self.document, self.command = app.activeDocument, ui.activeCommand
            self.saved = _entities(ui)
        except Exception as exc:
            raise SelectionUnavailable('Fusion cannot expose the current selection.') from exc
        if any(entity is None for entity in self.saved):
            raise SelectionUnavailable(
                'Fusion cannot expose selected objects while this preview is active.'
            )

    def restore(self):
        app, ui, saved = self.app, self.ui, self.saved
        if not saved:
            return
        try:
            if app.activeDocument != self.document or ui.activeCommand != self.command:
                return
            current = _entities(ui)
            # Never clear selections or merge an unrelated new selection into
            # an earlier one. A command may change its state during a write.
            if all(entity in saved for entity in current):
                for entity in saved:
                    if app.activeDocument != self.document or ui.activeCommand != self.command:
                        break
                    if entity.isValid and entity not in _entities(ui):
                        if not ui.activeSelections.add(entity):
                            app.log('Paramood could not restore a selected entity.')
        except Exception as exc:
            # A completed parameter operation must not be reported as failed
            # merely because Fusion rejected a selection restoration.
            app.log('Paramood could not restore the current selection: ' + str(exc))


def _entities(ui):
    selections = ui.activeSelections
    return [selections.item(index).entity for index in range(selections.count)]


@contextmanager
def preserve_selection(app, ui):
    snapshot = SelectionSnapshot(app, ui)
    try:
        yield
    finally:
        snapshot.restore()
