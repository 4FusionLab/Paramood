"""Model-wide variant columns and feature states; no native Configuration API."""

import copy
import re
import uuid

import adsk.fusion

from ..bridge.protocol import BridgeError
from ..core.expressions import TextValue, _fold_assignments
from ..core.inline_equation import solve_inline_equation
from .expression_engine import NativeExpressionEngine
from ..core.variants import decode_variant_table, encode_variants, variants_token

GROUP = '4FusionLab.Paramood'
ATTRIBUTE = 'variants.v2'


class VariantTableMixin:
    def _new_variant_parameters(self, design, payload):
        entries = payload.get('newParameters', [])
        if not isinstance(entries, list):
            raise BridgeError('BAD_REQUEST', 'Invalid pending parameters.')
        definitions = {}
        for entry in entries:
            if not isinstance(entry, dict) or any(
                not isinstance(entry.get(k), str) or not entry[k].strip()
                for k in ('name', 'expression')
            ):
                raise BridgeError('BAD_REQUEST', 'A pending parameter needs a name and expression.')
            name = entry['name']
            if name in definitions or design.allParameters.itemByName(name):
                raise BridgeError('CONFLICT', 'A pending parameter already exists: ' + name)
            definitions[name] = entry['expression']
        if not definitions:
            return {}, []
        _, operations = self._plan(
            ';'.join(name + '=' + expression for name, expression in definitions.items())
        )
        if {op.name for op in operations} != set(definitions) or any(
            op.status != 'New' for op in operations
        ):
            raise BridgeError('BAD_REQUEST', 'Pending definitions must create new parameters only.')
        return definitions, operations

    def _preview_variant_cell(self, payload):
        design = self._design()
        if payload.get('variantsToken') != self._read_variant_table(design)[1] or payload.get(
            'snapshotToken'
        ) != self._snapshot_token(design, 'variants'):
            raise BridgeError('CONFLICT', 'The model changed. Refresh the variant table.')
        target = payload.get('target')
        cells = payload.get('parameters')
        if not isinstance(target, str) or not isinstance(cells, list):
            raise BridgeError('BAD_REQUEST', 'A cell target and row parameters are required.')
        expressions, units, entities = {}, {}, []
        for cell in cells:
            if not isinstance(cell, dict) or any(
                not isinstance(cell.get(k), str) for k in ('entityToken', 'expression', 'unit')
            ):
                raise BridgeError('BAD_REQUEST', 'Invalid row parameter.')
            parameter = self._resolve_variant_parameter(design, cell)
            if not parameter or any(parameter == p for p in entities):
                raise BridgeError('CONFLICT', 'A row parameter changed or is duplicated.')
            entities.append(parameter)
            expressions[parameter.name] = cell['expression']
            units[parameter.name] = parameter.unit
        if target not in expressions:
            raise BridgeError('BAD_REQUEST', 'The edited parameter is not in this row.')
        pending, _ = self._new_variant_parameters(design, payload)
        _, baseline = self._plan(
            ';'.join(
                name + '=' + expression for name, expression in {**pending, **expressions}.items()
            )
        )
        quantities = self._quantities(design)
        quantities.update({op.name: op.quantity for op in baseline})
        text = payload.get('text')
        if payload.get('inlineEquation') is not None:
            equation = payload['inlineEquation']
            if not isinstance(equation, str):
                raise BridgeError('BAD_REQUEST', 'Invalid inline equation.')
            text = solve_inline_equation(
                equation, target, units[target], quantities, quantities.keys()
            )
        if not isinstance(text, str) or not text.strip() or len(text) > 10000:
            raise BridgeError('BAD_REQUEST', 'Enter one expression.')
        original = {p.name: p.expression for p in design.allParameters}
        original.update({**pending, **expressions})
        display_units = {p.name: p.unit for p in design.allParameters}
        display_units.update({op.name: op.unit for op in baseline})
        folded = _fold_assignments(
            text,
            quantities,
            original,
            display_units,
            design.fusionUnitsManager.defaultLengthUnits,
            self._native_function(design),
        )
        created = [name for name in folded if name not in quantities]
        if target not in folded or len(created) > 1 or set(folded) != {target, *created}:
            raise BridgeError(
                'BAD_REQUEST', 'A cell may update only its parameter and create one new parameter.'
            )
        if payload.get('sourceName') == target and created:
            folded[created[0]] = NativeExpressionEngine.literal(quantities[target])
        expressions[target] = folded[target]
        _, operations = self._plan(
            ';'.join(
                name + '=' + expression
                for name, expression in {
                    **pending,
                    **{name: folded[name] for name in created},
                    **expressions,
                }.items()
            )
        )
        planned = {op.name: op for op in operations}
        if set(planned) != {*pending, *expressions, *created}:
            raise BridgeError('BAD_REQUEST', 'Unexpected parameter assignments in a cell.')
        return {
            'expression': planned[target].expression,
            'newParameters': [
                {
                    'name': name,
                    'expression': planned[name].expression,
                    'unit': planned[name].unit,
                    'value': planned[name].quantity.value,
                    'valueExpression': NativeExpressionEngine.literal(planned[name].quantity),
                }
                for name in created
            ],
        }

    def _read_variant_table(self, design):
        attributes = getattr(design, 'attributes', None)
        attribute = attributes.itemByName(GROUP, ATTRIBUTE) if attributes else None
        raw = attribute.value if attribute else ''
        try:
            return decode_variant_table(raw), variants_token(raw)
        except (ValueError, TypeError, KeyError) as exc:
            raise BridgeError(
                'VARIANTS_UNREADABLE',
                'Cannot read saved variants. Existing data has been preserved. ' + str(exc),
            ) from exc

    @staticmethod
    def _timeline_features(design):
        timeline = getattr(design, 'timeline', None)
        if not timeline:
            return []
        features = []

        def visit(item):
            if item.isGroup:
                for child_index in range(item.count):
                    visit(item.item(child_index))
                return
            entity = item.entity
            feature = adsk.fusion.Feature.cast(entity) if entity else None
            if (
                feature
                and feature.isValid
                and feature.isParametric
                and not any(feature == previous for previous in features)
            ):
                features.append(feature)

        for index in range(timeline.count):
            visit(timeline.item(index))
        return features

    @staticmethod
    def _feature_entry(feature):
        return {
            'name': feature.name,
            'entityToken': feature.entityToken,
            'enabled': not feature.isSuppressed,
        }

    def _resolve_variant_feature(self, design, entry):
        try:
            matches = design.findEntityByToken(entry['entityToken'])
            feature = adsk.fusion.Feature.cast(matches[0]) if len(matches) == 1 else None
            return feature if feature and feature.isValid and feature.isParametric else None
        except RuntimeError:
            return None

    def _variant_feature_snapshot(self, design):
        # Include all candidates so newly selected features cannot bypass stale-request checks.
        return [(f.name, f.entityToken, f.isSuppressed) for f in self._timeline_features(design)]

    def _variant_timeline_selection(self):
        design = self._design()
        if not design:
            raise BridgeError('NO_DESIGN', 'Open a Fusion design first.')
        ui = self.app.userInterface
        if ui.activeCommand != 'SelectCommand':
            raise BridgeError(
                'BAD_CONTEXT', 'Finish the active Fusion command before picking timeline features.'
            )
        table, _ = self._read_variant_table(design)
        configured = [c for c in table['columns'] if c['kind'] == 'feature']
        features, seen = [], []
        for index in range(ui.activeSelections.count):
            entity = ui.activeSelections.item(index).entity
            feature = adsk.fusion.Feature.cast(entity)
            if not feature or not feature.isValid or not feature.isParametric:
                continue
            # Reject foreign-document entities and compare resolved objects, not token strings.
            matches = design.findEntityByToken(feature.entityToken)
            if len(matches) != 1 or matches[0] != feature or any(feature == f for f in seen):
                continue
            seen.append(feature)
            entry = self._feature_entry(feature)
            for column in configured:
                if self._resolve_variant_feature(design, column) == feature:
                    entry['entityToken'] = column['entityToken']
                    break
            features.append(entry)
        return {'documentId': self.document_id, 'features': features}

    def _save_variant_table(self, design, payload):
        columns, rows = payload.get('columns'), payload.get('variants')
        if not isinstance(columns, list) or not isinstance(rows, list):
            raise BridgeError('BAD_REQUEST', 'A table needs columns and variants.')
        old, _ = self._read_variant_table(design)
        pending, new_operations = self._new_variant_parameters(design, payload)
        if new_operations and not self.in_command and not self._validating_mutation:
            raise BridgeError(
                'TRANSACTION_REQUIRED',
                'Finish the active Fusion command or sketch before creating and linking parameters.',
            )
        active = self._active_variant(design, old['variants'])
        old_ids = {v['id'] for v in old['variants']}
        columns = copy.deepcopy(columns)
        seen = []
        for column in columns:
            if not isinstance(column, dict) or column.get('kind') not in ('parameter', 'feature'):
                raise BridgeError('BAD_REQUEST', 'Invalid table column.')
            if not isinstance(column.get('entityToken'), str):
                raise BridgeError('BAD_REQUEST', 'Missing column identity.')
            if column['kind'] == 'parameter':
                if not isinstance(column.get('unit'), str):
                    raise BridgeError('BAD_REQUEST', 'Missing parameter unit.')
                entity = self._resolve_variant_parameter(design, column)
            else:
                entity = self._resolve_variant_feature(design, column)
            if not entity or any(entity == previous for previous in seen):
                raise BridgeError('CONFLICT', 'A column is missing, unsupported, or duplicated.')
            seen.append(entity)
            column['name'] = entity.name
            if column['kind'] == 'parameter':
                column['unit'] = entity.unit
        prepared, identities = [], set()
        for row in rows:
            if not isinstance(row, dict):
                raise BridgeError('BAD_REQUEST', 'Invalid variant row.')
            identity = row.get('id')
            if identity is not None and (identity not in old_ids or identity in identities):
                raise BridgeError('CONFLICT', 'A variant identity changed or is duplicated.')
            if identity:
                identities.add(identity)
            name = row.get('name')
            if not isinstance(name, str) or not name.strip() or len(name.strip()) > 120:
                raise BridgeError('BAD_REQUEST', 'Enter a variant name (up to 120 characters).')
            parameters, features = row.get('parameters'), row.get('features', [])
            if not isinstance(parameters, list) or not isinstance(features, list):
                raise BridgeError('BAD_REQUEST', 'Invalid variant cells.')
            expected_parameters = [c for c in columns if c['kind'] == 'parameter']
            expected_features = [c for c in columns if c['kind'] == 'feature']
            if len(parameters) != len(expected_parameters) or len(features) != len(
                expected_features
            ):
                raise BridgeError('BAD_REQUEST', 'Fill every cell in every variant.')
            entries = []
            for cell, column in zip(parameters, expected_parameters):
                if (
                    not isinstance(cell, dict)
                    or cell.get('entityToken') != column['entityToken']
                    or not isinstance(cell.get('expression'), str)
                    or not cell['expression'].strip()
                    or len(cell['expression']) > 10000
                ):
                    raise BridgeError('BAD_REQUEST', 'A parameter cell is missing or out of order.')
                expression = cell['expression'].strip()
                if (
                    column['unit']
                    and column['unit'] != 'Text'
                    and re.fullmatch(r'[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?', expression)
                ):
                    expression += ' ' + column['unit']
                entries.append({**column, 'expression': expression})
            # Plan all assignments together against Fusion's dependency snapshot. This is read-only:
            # do not cycle through variants or temporarily modify the user's model to validate cells.
            planned = {}
            if entries:
                _, operations = self._plan(
                    ';'.join(
                        [name + '=' + expression for name, expression in pending.items()]
                        + [entry['name'] + '=' + entry['expression'] for entry in entries]
                    )
                )
                planned = {op.name: op for op in operations}
                if set(planned) != {entry['name'] for entry in entries} | set(pending):
                    raise BridgeError(
                        'BAD_REQUEST', 'A cell must contain one expression, not assignments.'
                    )
            saved_parameters = []
            for entry in entries:
                op = planned[entry['name']]
                value = op.quantity.value
                if not isinstance(op.quantity, TextValue):
                    value /= 10.0 ** op.quantity.dimension[0]
                saved_parameters.append(
                    {k: entry[k] for k in ('name', 'entityToken', 'unit')}
                    | {'expression': op.expression, 'value': value}
                )
            saved_features = []
            for cell, column in zip(features, expected_features):
                if (
                    not isinstance(cell, dict)
                    or cell.get('entityToken') != column['entityToken']
                    or type(cell.get('enabled')) is not bool
                ):
                    raise BridgeError('BAD_REQUEST', 'A feature cell is missing or out of order.')
                saved_features.append(
                    {k: column[k] for k in ('name', 'entityToken')} | {'enabled': cell['enabled']}
                )
            prepared.append(
                {
                    'id': identity or uuid.uuid4().hex,
                    'name': name.strip(),
                    'parameters': saved_parameters,
                    'features': saved_features,
                }
            )
        raw = encode_variants(prepared, columns)
        if self._design() != design:
            raise BridgeError(
                'STALE_DOCUMENT', 'The active document changed. Refresh and try again.'
            )
        self._before_mutation()
        # The Fusion command transaction owns creation rollback if applying/storing later fails.
        # No global parameter is created during cell preview or before the complete table validates.
        if new_operations:
            self._execute_new_batch(design, new_operations)
        replacement = next((row for row in prepared if active and row['id'] == active['id']), None)

        def cells(row):
            return (
                {p['entityToken']: p['expression'] for p in row['parameters']},
                {f['entityToken']: f['enabled'] for f in row.get('features', [])},
            )

        if replacement and cells(replacement) != cells(active):
            # The complete table is validated first. Apply only the active row and persist last;
            # a metadata failure restores its CAD expressions and feature states in _apply_variant.
            self._apply_variant(design, replacement, lambda: self._store_variant_raw(design, raw))
        else:
            self._store_variant_raw(design, raw)
        return {'saved': len(prepared)}

    def _set_feature_states(self, states):
        # Enable parents before children, suppress children before parents. User table ordering
        # is presentation only and must never determine the order of CAD operations.
        if not states:
            return
        features = self._timeline_features(self._design())

        def position(pair):
            return next(i for i, feature in enumerate(features) if feature == pair[0])

        ordered = sorted(states, key=position)
        for feature, enabled in ordered:
            if enabled and feature.isSuppressed:
                feature.isSuppressed = False
                if feature.isSuppressed:
                    raise BridgeError('FEATURE_UPDATE_FAILED', 'Could not enable ' + feature.name)
        for feature, enabled in reversed(ordered):
            if not enabled and not feature.isSuppressed:
                feature.isSuppressed = True
                if not feature.isSuppressed:
                    raise BridgeError('FEATURE_UPDATE_FAILED', 'Could not suppress ' + feature.name)
