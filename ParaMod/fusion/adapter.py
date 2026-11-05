"""Fusion-only adapter. All public methods run on Fusion's main thread."""
import hashlib
import json
import math
import re
import uuid

import adsk.core
import adsk.fusion

from ..core.expressions import (ANGLE, LENGTH, SCALAR, UNITS, ParameterSnapshot,
                                Quantity, evaluate, normalize_expression, plan_batch, plan_batch_snapshot)
from ..bridge.protocol import BridgeError
from ..bridge.formatting import display_quantity


class FusionAdapter:
    def __init__(self, app):
        self.app = app
        self._document = None
        self._document_id = None
        self._draft_id = None
        self._draft_documents = []
        self.in_command = False

    def invalidate(self):
        self._document = None
        self._document_id = None
        self._draft_id = None

    def _design(self):
        doc = self.app.activeDocument
        design = adsk.fusion.Design.cast(self.app.activeProduct)
        if not doc or not design:
            self.invalidate()
            return None
        if self._document is None or self._document != doc:
            self._document = doc
            self._document_id = uuid.uuid4().hex
            self._draft_documents = [(item, identity) for item, identity in self._draft_documents
                                     if getattr(item, 'isValid', True)]
            self._draft_id = next((identity for item, identity in self._draft_documents if item == doc), None)
            if self._draft_id is None:
                self._draft_id = uuid.uuid4().hex
                self._draft_documents.append((doc, self._draft_id))
        return design

    @property
    def document_id(self):
        self._design()
        return self._document_id

    def _quantities(self, design):
        result = {}
        for parameter in design.allParameters:
            unit = parameter.unit
            if unit not in UNITS and unit != '':
                continue
            try:
                value = parameter.value
                if unit == '':
                    result[parameter.name] = Quantity(value, SCALAR)
                elif UNITS[unit][1] == LENGTH:
                    result[parameter.name] = Quantity(value * 10.0, LENGTH)
                elif UNITS[unit][1] == ANGLE:
                    result[parameter.name] = Quantity(value, ANGLE)
            except Exception:
                continue
        return result

    def _dependency_snapshot(self, design):
        """Read a strict graph for future update planning; it does not authorize writes."""
        try:
            parameters = list(design.allParameters)
            by_name = {}
            for parameter in parameters:
                if not parameter.name or parameter.name in by_name:
                    raise ValueError('Duplicate or empty parameter name')
                by_name[parameter.name] = parameter

            def names_of(items):
                names = set()
                for item in items:
                    name = item.name
                    canonical = by_name.get(name)
                    if canonical is None or (canonical is not item and canonical != item):
                        raise ValueError('Dependency is outside the parameter snapshot')
                    if name in names:
                        raise ValueError('Duplicate dependency')
                    names.add(name)
                return names

            dependencies = {}
            dependents = {}
            result = {}
            for name, parameter in by_name.items():
                if parameter.valueType != adsk.fusion.ParameterValueTypes.NumericParameterValueType:
                    raise ValueError('Non-numeric parameter: ' + name)
                unit = parameter.unit
                if unit == '':
                    dimension, value = SCALAR, parameter.value
                elif unit in UNITS and UNITS[unit][1] == LENGTH:
                    dimension, value = LENGTH, parameter.value * 10.0
                elif unit in UNITS and UNITS[unit][1] == ANGLE:
                    dimension, value = ANGLE, parameter.value
                else:
                    raise ValueError('Unsupported parameter unit: ' + name)
                if not math.isfinite(value):
                    raise ValueError('Non-finite parameter value: ' + name)
                dependencies[name] = names_of(parameter.dependencyParameters)
                dependents[name] = names_of(parameter.dependentParameters)
                result[name] = ParameterSnapshot(parameter.expression, unit,
                                                 Quantity(value, dimension), dependencies[name])
            expected_dependents = {name: set() for name in by_name}
            for name, deps in dependencies.items():
                for dependency in deps:
                    expected_dependents[dependency].add(name)
            for name in by_name:
                if dependents[name] != expected_dependents[name]:
                    raise ValueError('Inconsistent parameter dependency graph: ' + name)
            return result
        except Exception as exc:
            raise BridgeError('INCOMPLETE_SNAPSHOT', 'Cannot verify parameter dependencies: ' + str(exc)) from exc

    def _healthy_timeline_snapshot(self, design):
        """Capture only healthy timeline objects for future geometry validation.

        A healthy timeline is necessary, not sufficient, for a safe update.
        """
        try:
            timeline = design.timeline
            items = list(timeline)
            if not items:
                raise ValueError('No timeline objects available')
            healthy = adsk.fusion.FeatureHealthStates.HealthyFeatureHealthState
            snapshot = []
            def capture(item):
                if not item or not item.isValid:
                    raise ValueError('Invalid timeline item')
                is_group = item.isGroup
                if item.isSuppressed or (not (is_group and not item.isCollapsed) and item.isRolledBack):
                    raise ValueError('Timeline item is not computed: ' + item.name)
                snapshot.append((item, item.name))
                if is_group:
                    if item.count < 1:
                        raise ValueError('Empty timeline group: ' + item.name)
                    for index in range(item.count):
                        capture(item.item(index))
                elif item.healthState != healthy:
                    raise ValueError('Timeline item is not healthy: ' + item.name)

            for item in items:
                capture(item)
            groups = []
            for group in timeline.timelineGroups:
                if not group or not group.isValid:
                    raise ValueError('Invalid timeline group')
                members = [group.item(index) for index in range(group.count)]
                if any(not child or not child.isValid for child in members):
                    raise ValueError('Invalid timeline group contents: ' + group.name)
                children = tuple((child, child.name) for child in members)
                if not children:
                    raise ValueError('Invalid timeline group contents: ' + group.name)
                groups.append((group, group.name, group.isCollapsed, children))
            return snapshot, timeline.markerPosition, groups
        except Exception as exc:
            raise BridgeError('UNHEALTHY_MODEL', 'Cannot verify model timeline: ' + str(exc)) from exc

    def _verify_timeline_health(self, design, baseline):
        current, marker, groups = self._healthy_timeline_snapshot(design)
        previous, old_marker, old_groups = baseline
        if marker != old_marker or groups != old_groups or len(current) != len(previous):
            raise BridgeError('UNHEALTHY_MODEL', 'Model timeline changed during the operation.')
        for (old, old_name), (new, new_name) in zip(previous, current):
            if not old.isValid or old != new or old_name != new_name:
                raise BridgeError('UNHEALTHY_MODEL', 'Model timeline changed during the operation.')

    def state(self):
        design = self._design()
        if not design:
            return {'documentId': None, 'parameters': []}
        manager = design.fusionUnitsManager
        parameters = []
        for param in design.allParameters:
            try:
                display = manager.formatValue(param.value, param.unit) if param.unit else str(param.value)
            except Exception:
                display = ''
            parameters.append({'name': param.name, 'expression': param.expression,
                               'value': display, 'unit': param.unit, 'comment': param.comment})
        return {'documentId': self._document_id, 'draftId': self._draft_id, 'documentName': self._document.name,
                'defaultLengthUnit': manager.defaultLengthUnits, 'parameters': parameters}

    def _snapshot_token(self, design, text):
        parameters = []
        for param in design.allParameters:
            try:
                value = param.value
            except Exception:
                value = None  # Text/unsupported parameter, expression is still part of the snapshot.
            parameters.append((param.name, param.expression, param.unit, value))
        payload = [self._document_id, text, design.fusionUnitsManager.defaultLengthUnits, sorted(parameters)]
        return hashlib.sha256(json.dumps(payload, ensure_ascii=True, allow_nan=False).encode('utf-8')).hexdigest()

    def _plan(self, text):
        design = self._design()
        if not design:
            raise BridgeError('NO_DESIGN', 'Open a Fusion design first.')
        if not isinstance(text, str) or len(text) > 10000:
            raise BridgeError('BAD_REQUEST', 'Expression is missing or too long.')
        names = [re.sub(r'[+*/-]$', '', item.split('=', 1)[0].strip()).strip().replace('.', '_') for item in re.split(r'[;\n]+', text)
                 if item.strip()]
        existing = [design.allParameters.itemByName(name) for name in names]
        if any(existing):
            for parameter in existing:
                if parameter:
                    user_parameter = design.userParameters.itemByName(parameter.name)
                    if not user_parameter or user_parameter != parameter:
                        raise BridgeError('UNSUPPORTED', 'Only user parameters can be updated.')
            snapshot = self._dependency_snapshot(design)
            ops = plan_batch_snapshot(text, snapshot, design.fusionUnitsManager.defaultLengthUnits)
        else:
            ops = plan_batch(text, self._quantities(design), design.fusionUnitsManager.defaultLengthUnits)
        for op in ops:
            if op.status != 'New':
                continue
            try:
                unit_name = design.fusionUnitsManager.formatUnits(op.name)
            except RuntimeError:
                unit_name = ''
            if unit_name:
                raise BridgeError('INVALID_PARAMETER_NAME',
                                  "Parameter '" + op.name + "' is a Fusion unit name. Choose another name.")
        return design, ops

    def _execute_new_batch(self, design, ops):
        # Dependencies are applied before operations that reference them.
        # Errors propagate to Command.execute, which aborts the transaction.
        created_names, updated_names = [], []
        for op in ops:
            existing = design.allParameters.itemByName(op.name)
            if op.status == 'Update':
                created = design.userParameters.itemByName(op.name)
                if not created or not existing or created != existing:
                    raise BridgeError('CONFLICT', 'User parameter changed: ' + op.name)
                unit = created.unit
            else:
                if existing:
                    raise BridgeError('CONFLICT', 'A parameter with this name already exists: ' + op.name)
                unit = op.unit
            if not design.fusionUnitsManager.isValidExpression(op.expression, unit):
                raise BridgeError('INVALID_EXPRESSION', 'Fusion cannot validate expression for ' + op.name + '.')
            if op.status == 'Update':
                created.expression = op.expression
                if ''.join(created.expression.split()) != ''.join(op.expression.split()):
                    raise BridgeError('RESULT_MISMATCH', 'Fusion returned a different expression for ' + op.name + '.')
                updated_names.append(op.name)
            else:
                try:
                    created = design.userParameters.add(op.name, adsk.core.ValueInput.createByString(op.expression), op.unit, '')
                except RuntimeError as exc:
                    raise BridgeError('CREATE_FAILED', "Fusion could not create parameter '" + op.name + "': " + str(exc)) from exc
                if not created:
                    raise BridgeError('CREATE_FAILED', 'Fusion could not create parameter ' + op.name + '.')
                created_names.append(op.name)
            unit = created.unit
            if unit == '' and op.quantity.dimension == SCALAR:
                actual = created.value
            elif unit in UNITS and UNITS[unit][1] == LENGTH and op.quantity.dimension == LENGTH:
                actual = created.value * 10.0
            elif unit in UNITS and UNITS[unit][1] == ANGLE and op.quantity.dimension == ANGLE:
                actual = created.value
            else:
                raise BridgeError('RESULT_MISMATCH', 'Fusion returned an unexpected unit for ' + op.name + '.')
            if not math.isclose(actual, op.quantity.value, rel_tol=1e-9, abs_tol=1e-9):
                raise BridgeError('RESULT_MISMATCH', 'Fusion result differs from preview for ' + op.name + '.')
        return {'created': created_names, 'updated': updated_names}

    def request(self, action, payload):
        if action == 'parameters.preview':
            design, ops = self._plan(payload.get('text'))
            token = self._snapshot_token(design, payload.get('text'))
            return {'snapshotToken': token, 'items': [{'name': op.name, 'expression': op.expression,
                               'value': display_quantity(op.quantity, op.unit), 'unit': op.unit,
                               'status': op.status,
                               'previous': str(display_quantity(op.previous, op.unit)) if op.previous else None}
                              for op in ops], 'valid': bool(ops)}
        if action == 'parameters.apply':
            if not self.in_command:
                raise BridgeError('BAD_CONTEXT', 'Changes require a Fusion command.')
            design = self._design()
            text = payload.get('text')
            if not design or not isinstance(text, str) or payload.get('snapshotToken') != self._snapshot_token(design, text):
                raise BridgeError('STALE_PREVIEW', 'The design changed. Refresh the preview and try again.')
            design, ops = self._plan(text)
            return self._execute_new_batch(design, ops)
        if action == 'calculator.evaluate':
            design = self._design()
            expression = payload.get('expression')
            if not isinstance(expression, str) or len(expression) > 10000:
                raise BridgeError('BAD_REQUEST', 'Expression is missing or too long.')
            quantities = self._quantities(design)
            expression = normalize_expression(expression, quantities)
            quantity = evaluate(expression, quantities)
            unit = {LENGTH: design.fusionUnitsManager.defaultLengthUnits, ANGLE: 'deg', SCALAR: ''}.get(quantity.dimension)
            if unit is None:
                raise BridgeError('UNSUPPORTED', 'This result dimension is not supported yet.')
            manager = design.fusionUnitsManager
            if not manager.isValidExpression(expression, unit):
                raise BridgeError('INVALID_EXPRESSION', 'Fusion cannot validate this expression.')
            value = manager.evaluateExpression(expression, unit)
            formatted = manager.formatValue(value, unit) if unit else str(value)
            display_value = value if not unit else manager.convert(value, 'cm' if quantity.dimension == LENGTH else 'rad', unit)
            return {'value': display_value, 'unit': unit, 'formatted': formatted}
        if action == 'cleanup.analyze':
            design = self._design()
            items = []
            for p in design.userParameters:
                try:
                    formatted = design.fusionUnitsManager.formatValue(p.value, p.unit) if p.unit else str(p.value)
                except Exception:
                    formatted = ''
                items.append({'name': p.name, 'expression': p.expression, 'value': formatted,
                              'unit': p.unit, 'comment': p.comment, 'favorite': p.isFavorite,
                              'protected': True, 'selected': False,
                              'reason': 'Protected: dependency coverage has not yet been verified.'})
            return {'items': items}

        raise BridgeError('BAD_REQUEST', 'Unknown action.')
