"""Conservative cleanup with an opaque, identity-bound preview and native guards."""

import hashlib
import json
import uuid

from ..bridge.protocol import BridgeError
from ..core.dependencies import cleanup_plan
from ..core.references import expression_references


class CleanupMixin:
    def _cleanup_state(self, design):
        try:
            by_name, dependencies, dependents = self._reference_graph(design)
            users = {p.name: p for p in design.userParameters}
            if any(by_name.get(name) != p or not p.isValid for name, p in users.items()):
                raise ValueError('Cannot verify user parameter identity')
            graph = {name: dependencies[name] & users.keys() for name in users}
            roots = {
                name for name in users if any(other not in users for other in dependents[name])
            }
            # A native blocker without exposed parameter users is unknown usage.
            # Do not interpret the empty equation graph as permission to delete it.
            roots.update(
                name for name, p in users.items() if not p.isDeletable and not dependents[name]
            )
            table, variants_token = self._read_variant_table(design)
            for column in table['columns']:
                if column['kind'] == 'parameter':
                    parameter = self._resolve_variant_parameter(design, column)
                    if parameter is None:
                        raise ValueError('A saved variant parameter cannot be resolved')
                    if parameter.name in users:
                        roots.add(parameter.name)
            for variant in table['variants']:
                definitions = []
                for entry in variant['parameters']:
                    parameter = self._resolve_variant_parameter(design, entry)
                    if parameter is None:
                        raise ValueError('A saved variant parameter cannot be resolved')
                    if parameter.unit != entry['unit']:
                        raise ValueError('A saved variant parameter type changed')
                    if parameter.name in users:
                        roots.add(parameter.name)
                    roots.update(expression_references(entry['expression'], users))
                    definitions.append(parameter.name + '=' + entry['expression'])
                if definitions:
                    # Schema-valid metadata can still contain stale/unknown formulas.
                    # Validate the complete saved row without applying its values.
                    _, operations = self._plan(';'.join(definitions))
                    expected = {
                        self._resolve_variant_parameter(design, entry).name
                        for entry in variant['parameters']
                    }
                    if {op.name for op in operations} != expected:
                        raise ValueError('Cannot verify saved variant expressions')
            favorites = {name for name, p in users.items() if p.isFavorite}
            order = cleanup_plan(graph, roots, favorites)
            fingerprint = hashlib.sha256(
                json.dumps(
                    [
                        self.document_id,
                        variants_token,
                        design.fusionUnitsManager.defaultLengthUnits,
                        [
                            [
                                name,
                                p.expression,
                                p.unit,
                                sorted(dependencies[name]),
                                p.comment if name in users else None,
                                p.isFavorite if name in users else None,
                                p.isDeletable if name in users else None,
                            ]
                            for name, p in sorted(by_name.items())
                        ],
                    ],
                    ensure_ascii=True,
                    allow_nan=False,
                ).encode('utf-8')
            ).hexdigest()
            return by_name, graph, roots, favorites, order, fingerprint
        except BridgeError:
            raise
        except Exception as exc:
            raise BridgeError(
                'CLEANUP_UNAVAILABLE', 'Cannot verify unused parameters: ' + str(exc)
            ) from exc

    def _analyze_cleanup(self):
        self._cleanup_preview = None
        design = self._design()
        by_name, graph, _, _, order, fingerprint = self._cleanup_state(design)
        items = []
        for name in sorted(order):
            p = by_name[name]
            formatted = (
                p.textValue
                if p.unit == 'Text'
                else design.fusionUnitsManager.formatValue(p.value, p.unit)
                if p.unit
                else str(p.value)
            )
            items.append(
                {
                    'name': name,
                    'expression': p.expression,
                    'value': formatted,
                    'unit': p.unit,
                    'favorite': False,
                    'protected': False,
                    'selected': True,
                    'reason': 'No model or saved variant uses; native deletion rechecked on apply.',
                    'dependencies': sorted(graph[name]),
                }
            )
        snapshot = uuid.uuid4().hex
        self._cleanup_preview = {
            'snapshot': snapshot,
            'documentId': self.document_id,
            'fingerprint': fingerprint,
            # Tokens can change over time; resolve saved tokens and compare entities.
            'entities': {name: p.entityToken for name, p in by_name.items()},
        }
        return {'items': items, 'snapshot': snapshot}

    def _delete_cleanup(self, payload):
        self._require_mutation_context(transaction_only=True)
        names = payload.get('names')
        if (
            not isinstance(names, list)
            or not names
            or any(not isinstance(name, str) or not name for name in names)
            or len(set(names)) != len(names)
        ):
            raise BridgeError('BAD_REQUEST', 'Select parameters from a current cleanup preview.')
        design = self._design()
        preview = self._cleanup_preview
        if (
            not preview
            or payload.get('snapshot') != preview['snapshot']
            or preview['documentId'] != self.document_id
        ):
            raise BridgeError('STALE_PREVIEW', 'Analyze unused parameters again before deleting.')
        by_name, graph, roots, favorites, candidates, fingerprint = self._cleanup_state(design)
        if fingerprint != preview['fingerprint'] or set(by_name) != set(preview['entities']):
            raise BridgeError(
                'STALE_PREVIEW', 'The model changed. Analyze unused parameters again.'
            )
        for name, token in preview['entities'].items():
            matches = design.findEntityByToken(token)
            if len(matches) != 1 or matches[0] != by_name[name] or not by_name[name].isValid:
                raise BridgeError('STALE_PREVIEW', 'Parameter identity changed. Analyze again.')
        if not set(names) <= set(candidates):
            raise BridgeError('BAD_REQUEST', 'Only previewed unused parameters can be deleted.')
        order = cleanup_plan(graph, roots, favorites, set(names))
        if not order:
            raise BridgeError('NO_SELECTION', 'Retained parameters need the selected dependencies.')
        # No write, even command termination, happens before all validation succeeds.
        self._before_mutation({'snapshot': preview['snapshot'], 'order': order})
        for name in order:
            p = design.userParameters.itemByName(name)
            if p != by_name[name] or not p.isValid or not p.isDeletable:
                raise BridgeError('DELETE_FAILED', 'Fusion cannot safely delete ' + name + '.')
            try:
                deleted = p.deleteMe()
            except Exception as exc:
                raise BridgeError('DELETE_FAILED', 'Fusion could not delete ' + name + '.') from exc
            # Autodesk documents that deleteMe may return true even when refused.
            if not deleted or design.allParameters.itemByName(name) is not None or p.isValid:
                raise BridgeError(
                    'DELETE_FAILED', 'Fusion did not confirm deletion of ' + name + '.'
                )
        self._cleanup_preview = None
        return {'deleted': order, 'retained': sorted(set(names) - set(order))}
