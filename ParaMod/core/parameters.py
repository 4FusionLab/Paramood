"""Best-effort batch application; this is not a Fusion transaction."""
from __future__ import annotations
from typing import Protocol, Sequence
from .expressions import Operation


class ParameterStore(Protocol):
    def get_expression(self, name: str) -> str: ...
    def update(self, name: str, expression: str) -> None: ...
    def create(self, name: str, expression: str, unit: str) -> None: ...
    def delete(self, name: str) -> None: ...


class BatchApplyError(RuntimeError):
    def __init__(self, cause: Exception, rollback_errors: list[str], failed_name: str):
        super().__init__(f'Failed to apply {failed_name}: {cause}; model may require inspection')
        self.cause = cause
        self.rollback_errors = rollback_errors
        self.failed_name = failed_name


def apply_batch(store: ParameterStore, operations: Sequence[Operation]) -> None:
    """Apply prevalidated operations, then compensate successful writes on error.

    A failed store call might have partially mutated state; the caller must
    refresh and inspect it. Compensation may itself fail. This is not atomic.
    The caller must check active document, snapshot revision and Fusion
    validation immediately before invoking this function.
    """
    undo: list[tuple[str, str, str]] = []
    current_name = ''
    try:
        for operation in operations:
            current_name = operation.name
            if operation.status == 'Update':
                old = store.get_expression(operation.name)
                store.update(operation.name, operation.expression)
                undo.append(('update', operation.name, old))
            elif operation.status == 'New':
                store.create(operation.name, operation.expression, operation.unit)
                undo.append(('delete', operation.name, ''))
            else:
                raise ValueError('Unexpected operation status')
    except Exception as exc:
        failures: list[str] = []
        for action, name, old in reversed(undo):
            try:
                if action == 'update':
                    store.update(name, old)
                else:
                    store.delete(name)
            except Exception as rollback_exc:
                failures.append(f'{name}: {rollback_exc}')
        raise BatchApplyError(exc, failures, current_name) from exc
