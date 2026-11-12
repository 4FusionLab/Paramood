"""Rename virtual parameter subtrees inside a Fusion command transaction."""

import re

from ..bridge.protocol import BridgeError
from ..core.text import map_code
from ..core.variants import encode_variants

_GROUP = re.compile(r'[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё0-9]*(?:_[A-Za-zА-Яа-яЁё0-9]+)*')


class ParameterGroupsMixin:
    def _rename_parameter_group(self, payload):
        # A failed later rename must abort the entire command, including variant metadata.
        self._require_mutation_context(transaction_only=True)
        group, new_group, expected = (
            payload.get('group'),
            payload.get('newGroup'),
            payload.get('parameters'),
        )
        if any(
            not isinstance(name, str) or not _GROUP.fullmatch(name) for name in (group, new_group)
        ):
            raise BridgeError('INVALID_PARAMETER_NAME', 'Enter a valid group name.')
        if (
            not isinstance(expected, list)
            or not expected
            or any(
                not isinstance(entry, dict)
                or any(
                    not isinstance(entry.get(key), str)
                    for key in ('name', 'entityToken', 'expression', 'unit')
                )
                or not entry['entityToken']
                for entry in expected
            )
        ):
            raise BridgeError('BAD_REQUEST', 'Group parameter identities are missing.')
        design = self._design()
        members = [
            p
            for p in design.allParameters
            if _GROUP.fullmatch(p.name) and (p.name == group or p.name.startswith(group + '_'))
        ]
        if (
            not any(p.name.startswith(group + '_') for p in members)
            or len(expected) != len(members)
            or {e['name'] for e in expected} != {p.name for p in members}
        ):
            raise BridgeError('CONFLICT', 'The group changed. Refresh and try again.')
        by_name = {p.name: p for p in members}
        renames = {}
        for entry in expected:
            parameter = by_name[entry['name']]
            matches = design.findEntityByToken(entry['entityToken'])
            if (
                len(matches) != 1
                or matches[0] != parameter
                or parameter.expression != entry['expression']
                or parameter.unit != entry['unit']
            ):
                raise BridgeError('CONFLICT', 'A group parameter changed. Refresh and try again.')
            if not self._editable_parameter(design, parameter.name):
                raise BridgeError('READ_ONLY', 'A group parameter cannot be renamed.')
            new_name = new_group + parameter.name[len(group) :]
            existing = design.allParameters.itemByName(new_name)
            if existing and existing != parameter:
                raise BridgeError(
                    'CONFLICT', 'A parameter with this name already exists: ' + new_name
                )
            renames[parameter.name] = new_name
        # Rewrite all names simultaneously so nested prefixes never cascade in saved formulas.
        table, _ = self._read_variant_table(design)
        pattern = re.compile(r'[A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё_0-9]*')
        changed = False
        for variant in table['variants']:
            for entry in variant['parameters']:
                expression = map_code(
                    entry['expression'],
                    lambda code: pattern.sub(
                        lambda match: renames.get(match.group(), match.group()), code
                    ),
                )
                name = renames.get(entry['name'], entry['name'])
                changed |= name != entry['name'] or expression != entry['expression']
                entry['name'], entry['expression'] = name, expression
        for column in table['columns']:
            if column['kind'] == 'parameter' and column['name'] in renames:
                column['name'] = renames[column['name']]
                changed = True
        raw = encode_variants(table['variants'], table['columns']) if changed else None
        self._before_mutation()
        try:
            for old_name, new_name in renames.items():
                parameter = by_name[old_name]
                parameter.name = new_name
                if parameter.name != new_name:
                    raise ValueError('Fusion did not accept the name: ' + new_name)
            if raw is not None:
                self._store_variant_raw(design, raw)
        except Exception as exc:
            raise BridgeError(
                'RENAME_FAILED', 'Fusion could not rename the group: ' + str(exc)
            ) from exc
        return {'renamed': renames}
