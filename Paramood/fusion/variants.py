"""Model-owned variant metadata. Called only on Fusion's main thread."""

import copy
import re

import adsk.core

from ..bridge.protocol import BridgeError
from ..core.text import map_code, normalize_literals
from ..core.variants import encode_variants, values_match
from .variant_table import VariantTableMixin

GROUP = '4FusionLab.Paramood'
ATTRIBUTE = 'variants.v2'


class VariantsMixin(VariantTableMixin):
    def _read_variants(self, design):
        table, token = self._read_variant_table(design)
        return table['variants'], token

    def _write_variants(self, design, variants):
        table, _ = self._read_variant_table(design)
        columns = table['columns']
        self._store_variant_raw(design, encode_variants(variants, columns))

    @staticmethod
    def _store_variant_raw(design, raw):
        try:
            attribute = design.attributes.add(GROUP, ATTRIBUTE, raw)
            if not attribute or attribute.value != raw:
                raise ValueError('Fusion did not retain variant data.')
        except Exception as exc:
            raise BridgeError(
                'VARIANT_SAVE_FAILED', 'Could not save variants: ' + str(exc)
            ) from exc

    def _resolve_variant_parameter(self, design, entry):
        try:
            matches = design.findEntityByToken(entry['entityToken'])
        except RuntimeError:
            return None
        if len(matches) != 1:
            return None
        parameter = matches[0]
        current = self._editable_parameter(design, parameter.name)
        if not current or current != parameter:
            return None
        if (current.unit == 'Text') != (entry['unit'] == 'Text'):
            return None
        if current.unit != entry['unit']:
            # Model parameters follow the design's display units. Their tokens
            # and internal values stay stable when mm becomes inches.
            if (
                not current.unit
                or not entry['unit']
                or not design.fusionUnitsManager.isValidExpression(
                    '1 ' + entry['unit'], current.unit
                )
            ):
                return None
        return current

    def _variant_matches(self, design, variant):
        for entry in variant['parameters']:
            parameter = self._resolve_variant_parameter(design, entry)
            if not parameter or not values_match(
                parameter.textValue if parameter.unit == 'Text' else parameter.value, entry['value']
            ):
                return False
        for entry in variant.get('features', []):
            feature = self._resolve_variant_feature(design, entry)
            if not feature or (not feature.isSuppressed) != entry['enabled']:
                return False
        return True

    def _active_variant(self, design, variants):
        sessions = self._variant_sessions
        key = self._draft_id
        if key not in sessions:
            sessions[key] = next(
                (v['id'] for v in variants if self._variant_matches(design, v)), None
            )
        identity = sessions[key]
        active = next((v for v in variants if v['id'] == identity), None)
        if active and not self._variant_matches(design, active):
            sessions[key] = None
            return None
        return active

    def _variants_state(self, design):
        try:
            variants, token = self._read_variants(design)
            active = self._active_variant(design, variants)
            public = copy.deepcopy(variants)
            table, _ = self._read_variant_table(design)
            columns = copy.deepcopy(table['columns'])
            for column in columns:
                entity = (
                    self._resolve_variant_parameter(design, column)
                    if column['kind'] == 'parameter'
                    else self._resolve_variant_feature(design, column)
                )
                column['missing'] = entity is None
                if entity:
                    column['name'] = entity.name
            for variant in public:
                for entry in variant['parameters']:
                    parameter = self._resolve_variant_parameter(design, entry)
                    entry['missing'] = parameter is None
                    if parameter:
                        entry['name'] = parameter.name
                for entry in variant.get('features', []):
                    feature = self._resolve_variant_feature(design, entry)
                    entry['missing'] = feature is None
                    if feature:
                        entry['name'] = feature.name
            return {
                'variants': public,
                'activeVariantId': active['id'] if active else None,
                'variantsToken': token,
                'variantSnapshotToken': self._snapshot_token(design, 'variants'),
                'variantColumns': columns,
                'variantTableVersion': table['version'],
                'timelineFeatures': [
                    self._feature_entry(f) for f in self._timeline_features(design)
                ],
            }
        except Exception as exc:
            return {'variants': [], 'activeVariantId': None, 'variantsError': str(exc)}

    def _variant_edit_context(self, design):
        variants, _ = self._read_variants(design)
        active = self._active_variant(design, variants)
        return variants, active

    def _execute_tracked_parameters(self, design, ops):
        context = self._variant_edit_context(design)
        originals = []
        if context[1] and self.in_direct_apply:
            for op in ops:
                if op.status == 'Update':
                    parameter = self._editable_parameter(design, op.name)
                    originals.append((parameter, parameter.expression))
        result = (
            self._execute_direct_batch(design, ops)
            if self.in_direct_apply
            else self._execute_new_batch(design, ops)
        )
        try:
            self._capture_variant_edits(design, context, [op.name for op in ops])
        except Exception as exc:
            if self.in_direct_apply:
                restored = not result['created'] and design.modifyParameters(
                    [p for p, _ in originals],
                    [
                        adsk.core.ValueInput.createByString(expression)
                        for _, expression in originals
                    ],
                )
                if not restored:
                    raise BridgeError(
                        'VARIANT_PARTIAL',
                        'Parameters changed, but the active variant could not be saved. '
                        'Review the model before retrying. ' + str(exc),
                    ) from exc
            raise
        return result

    def _rename_variant_references(self, design, variants, old_name, new_name):
        changed = False
        pattern = re.compile(
            r'(?<![A-Za-zА-Яа-яЁё_0-9])' + re.escape(old_name) + r'(?![A-Za-zА-Яа-яЁё_0-9])'
        )
        for variant in variants:
            for entry in variant['parameters']:
                expression = map_code(entry['expression'], lambda code: pattern.sub(new_name, code))
                if expression != entry['expression'] or entry['name'] == old_name:
                    changed = True
                    entry['expression'] = expression
                    if entry['name'] == old_name:
                        entry['name'] = new_name
        if changed:
            self._write_variants(design, variants)

    def _capture_variant_edits(self, design, context, names):
        variants, active = context
        if not active:
            return
        parameters = []
        for entry in active['parameters']:
            parameter = self._resolve_variant_parameter(design, entry)
            if not parameter:
                raise BridgeError('CONFLICT', 'A variant parameter is no longer available.')
            parameters.append(parameter)
        if not set(names).intersection(parameter.name for parameter in parameters):
            return
        active['parameters'] = [
            {**self._variant_entry(p), 'entityToken': entry['entityToken']}
            for p, entry in zip(parameters, active['parameters'])
        ]
        self._write_variants(design, variants)

    @staticmethod
    def _variant_entry(parameter, expression=None):
        return {
            'name': parameter.name,
            'entityToken': parameter.entityToken,
            'expression': parameter.expression if expression is None else expression,
            'unit': parameter.unit,
            'value': parameter.textValue if parameter.unit == 'Text' else parameter.value,
        }

    def _request_variant(self, action, payload):
        if not self.in_command and not self.in_direct_apply:
            raise BridgeError('BAD_CONTEXT', 'Changes require a Fusion command.')
        design = self._design()
        variants, token = self._read_variants(design)
        if payload.get('variantsToken') != token or payload.get(
            'snapshotToken'
        ) != self._snapshot_token(design, 'variants'):
            raise BridgeError('CONFLICT', 'The model or variants changed. Refresh and try again.')
        identity = payload.get('id')
        variant = next((v for v in variants if v['id'] == identity), None)
        if action == 'variants.free':
            self._variant_sessions[self._draft_id] = None
            return {'activeVariantId': None}
        if action == 'variants.table.save':
            return self._save_variant_table(design, payload)
        if not variant:
            raise BridgeError('CONFLICT', 'This variant no longer exists.')
        if action == 'variants.delete':
            self._write_variants(design, [v for v in variants if v['id'] != identity])
            if self._variant_sessions.get(self._draft_id) == identity:
                self._variant_sessions[self._draft_id] = None
            return {'deleted': identity}
        return self._apply_variant(design, variant)

    def _apply_variant(self, design, variant, after_apply=None):
        parameters, expressions = [], []
        renames = {}
        for entry in variant['parameters']:
            parameter = self._resolve_variant_parameter(design, entry)
            if not parameter:
                raise BridgeError('MISSING_PARAMETER', 'Parameter unavailable: ' + entry['name'])
            parameters.append(parameter)
            renames[entry['name']] = parameter.name
        for entry, parameter in zip(variant['parameters'], parameters):
            expression = map_code(
                normalize_literals(entry['expression']),
                lambda code: re.sub(
                    r'[A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё_0-9]*',
                    lambda match: renames.get(match.group(), match.group()),
                    code,
                ),
            )
            if parameter.unit != 'Text' and not design.fusionUnitsManager.isValidExpression(
                expression, parameter.unit
            ):
                raise BridgeError('INVALID_EXPRESSION', 'Invalid expression for ' + parameter.name)
            expressions.append(expression)
        if any(p.unit == 'Text' for p in parameters):
            _, operations = self._plan(
                ';'.join(
                    p.name + '=' + expression for p, expression in zip(parameters, expressions)
                )
            )
            planned = {op.name: op for op in operations}
            expressions = [planned[p.name].expression for p in parameters]
        feature_states = []
        for entry in variant.get('features', []):
            feature = self._resolve_variant_feature(design, entry)
            if not feature:
                raise BridgeError('MISSING_FEATURE', 'Feature unavailable: ' + entry['name'])
            feature_states.append((feature, entry['enabled']))
        old_states = [(feature, not feature.isSuppressed) for feature, _ in feature_states]
        old_expressions = [p.expression for p in parameters]
        values = [adsk.core.ValueInput.createByString(e) for e in expressions]
        try:
            # Unsuppress first so parameters belonging to enabled features become writable.
            self._set_feature_states([(f, True) for f, enabled in feature_states if enabled])
            if parameters and not design.modifyParameters(parameters, values):
                raise BridgeError('UPDATE_FAILED', 'Fusion could not apply the variant parameters.')
            self._set_feature_states(feature_states)
            if any(p.unit == 'Text' for p in parameters):
                for p in parameters:
                    self._verify_value(p, planned[p.name])
            if after_apply:
                after_apply()
        except Exception as exc:
            # Direct callbacks have no command transaction to abort. Restore only
            # these expressions; never undo unrelated user work.
            try:
                self._set_feature_states([(f, True) for f, enabled in old_states if enabled])
                restored = not parameters or design.modifyParameters(
                    parameters, [adsk.core.ValueInput.createByString(e) for e in old_expressions]
                )
                self._set_feature_states(old_states)
            except Exception:
                restored = False
            if not restored:
                raise BridgeError(
                    'VARIANT_PARTIAL',
                    'Variant apply failed and the original state could not be restored. Review the model.',
                ) from exc
            raise
        self._variant_sessions[self._draft_id] = variant['id']
        return {'activeVariantId': variant['id']}
