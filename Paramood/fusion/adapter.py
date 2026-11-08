"""Fusion-only adapter. All public methods run on Fusion's main thread."""

import hashlib
import json
import math
import re
import uuid
from dataclasses import replace

import adsk.core
import adsk.fusion

from ..core.expressions import (
    ANGLE,
    LENGTH,
    SCALAR,
    TextValue,
    ParameterSnapshot,
    Quantity,
    dependency_closure,
    dimension_unit,
    unit_definition,
    mark_stochastic,
    evaluate,
    normalize_expression,
    plan_batch,
    plan_batch_snapshot,
)
from ..core.inline_equation import solve_inline_equation
from ..bridge.protocol import BridgeError
from ..bridge.formatting import display_quantity
from .variants import VariantsMixin
from .expression_engine import NativeExpressionEngine
from ..core.text import map_code, normalize_literals, split_definitions, text_literal


def _is_text(parameter):
    types = getattr(adsk.fusion, 'ParameterValueTypes', None)
    text_type = getattr(types, 'TextParameterValueType', None)
    return text_type is not None and getattr(parameter, 'valueType', None) == text_type


def _expression_matches(actual, expected):
    return map_code(normalize_literals(actual), lambda code: ''.join(code.split())) == map_code(
        normalize_literals(expected), lambda code: ''.join(code.split())
    )


def _value_expression(parameter):
    if _is_text(parameter):
        return text_literal(parameter.textValue)
    unit, value = parameter.unit, parameter.value
    if not math.isfinite(value):
        raise ValueError('Non-finite parameter value')
    if not unit:
        return repr(value) + 'n'
    factor, dimension, offset = unit_definition(unit)
    base = value * 10.0 ** dimension[0]
    converted = (base - offset) / factor
    if not math.isfinite(converted):
        raise ValueError('Non-finite converted value')
    if abs(converted) < 1e12:
        integer = round(converted)
        if integer * factor + offset == base:
            converted = float(integer)
    return repr(converted) + ' ' + unit


def _is_driven(parameter):
    try:
        owner = parameter.createdBy
        if not owner:
            return False
        type_name = owner.objectType.rsplit('::', 1)[-1]
        if type_name == 'Sketch':
            try:
                for dimension in owner.sketchDimensions:
                    if dimension.parameter == parameter:
                        return not dimension.isDriving
            except Exception:
                return True
            return True  # Do not allow a write when the sketch dimension cannot be verified.
        return bool(type_name.startswith('Sketch') and owner.isDriving is False)
    except (AttributeError, RuntimeError):
        return False


class FusionAdapter(VariantsMixin):
    def __init__(self, app):
        self.app = app
        self._document = None
        self._document_id = None
        self._draft_id = None
        self._draft_documents = []
        self._variant_sessions = {}
        self.in_command = False
        self.in_direct_apply = False

    def is_sketch_edit(self):
        # A sketch edit may still report SelectCommand. Never start another command
        # when Fusion cannot tell us the current edit target.
        try:
            target = self.app.activeEditObject
            return bool(target and adsk.fusion.Sketch.cast(target))
        except Exception:
            return True

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
            self._draft_documents = [
                (item, identity)
                for item, identity in self._draft_documents
                if getattr(item, 'isValid', True)
            ]
            self._draft_id = next(
                (identity for item, identity in self._draft_documents if item == doc), None
            )
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
            if _is_text(parameter):
                result[parameter.name] = TextValue(parameter.textValue)
            else:
                _, dimension, _ = unit_definition(parameter.unit)
                result[parameter.name] = Quantity(parameter.value * 10.0 ** dimension[0], dimension)
        dynamic = self._stochastic_parameters(design)
        return {name: replace(value, stochastic=name in dynamic) for name, value in result.items()}

    @staticmethod
    def _stochastic_parameters(design):
        expressions = {p.name: p.expression for p in design.allParameters}
        dependencies = {}
        for parameter in design.allParameters:
            # API dependency lists are preferred. Lightweight offline fixtures have none.
            native = getattr(parameter, 'dependencyParameters', None)
            if native is not None:
                dependencies[parameter.name] = {p.name for p in native}
            else:
                dependencies[parameter.name] = (
                    set(re.findall(r'[A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё_0-9]*', parameter.expression))
                    & expressions.keys()
                )
        return mark_stochastic(expressions, dependencies)

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
                text = _is_text(parameter)
                if (
                    not text
                    and parameter.valueType
                    != adsk.fusion.ParameterValueTypes.NumericParameterValueType
                ):
                    raise ValueError('Unknown parameter value type: ' + name)
                unit = parameter.unit
                if text:
                    dimension, value = 'text', parameter.textValue
                    if not isinstance(value, str) or unit != 'Text':
                        raise ValueError('Invalid text parameter: ' + name)
                else:
                    _, dimension, _ = unit_definition(unit)
                    value = parameter.value * 10.0 ** dimension[0]
                if not text and not math.isfinite(value):
                    raise ValueError('Non-finite parameter value: ' + name)
                dependencies[name] = names_of(parameter.dependencyParameters)
                dependents[name] = names_of(parameter.dependentParameters)
                result[name] = ParameterSnapshot(
                    parameter.expression,
                    unit,
                    TextValue(value) if text else Quantity(value, dimension),
                    dependencies[name],
                )
            # The API lists can expose different depths in each direction.
            # Compare all reachable pairs, never merely accept extra edges.
            expected_dependents = {name: set() for name in by_name}
            for name, deps in dependency_closure(dependencies).items():
                for dependency in deps:
                    expected_dependents[dependency].add(name)
            actual_dependents = dependency_closure(dependents)
            for name in by_name:
                if actual_dependents[name] != expected_dependents[name]:
                    raise ValueError('Inconsistent parameter dependency graph: ' + name)
            dynamic = self._stochastic_parameters(design)
            return {
                name: replace(item, quantity=replace(item.quantity, stochastic=name in dynamic))
                for name, item in result.items()
            }
        except Exception as exc:
            raise BridgeError(
                'INCOMPLETE_SNAPSHOT', 'Cannot verify parameter dependencies: ' + str(exc)
            ) from exc

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
                if item.isSuppressed or (
                    not (is_group and not item.isCollapsed) and item.isRolledBack
                ):
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
            raise BridgeError(
                'UNHEALTHY_MODEL', 'Cannot verify model timeline: ' + str(exc)
            ) from exc

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
                display = (
                    param.textValue
                    if _is_text(param)
                    else (
                        manager.formatValue(param.value, param.unit)
                        if param.unit
                        else str(param.value)
                    )
                )
            except Exception:
                display = ''
            user_param = design.userParameters.itemByName(param.name)
            is_user = bool(user_param and user_param == param)
            driven = not is_user and _is_driven(param)
            try:
                value_expression = _value_expression(param)
            except (AttributeError, ValueError, TypeError, RuntimeError):
                value_expression = None
            bindings = set()
            try:
                pending, visited = [param], set()
                while pending:
                    current = pending.pop()
                    if current.name in visited:
                        continue
                    visited.add(current.name)
                    owner = getattr(current, 'createdBy', None)
                    if owner:
                        type_name = owner.objectType.rsplit('::', 1)[-1]
                        if type_name == 'Sketch':
                            bindings.add('sketch')
                        elif type_name.endswith('Feature'):
                            bindings.add('feature')
                        else:
                            bindings.add('other')
                    pending.extend(current.dependentParameters)
            except Exception:
                bindings.add('unknown')
            parameters.append(
                {
                    'name': param.name,
                    'valueType': 'text' if _is_text(param) else 'number',
                    'expression': param.expression,
                    'value': display,
                    'unit': param.unit,
                    'comment': param.comment,
                    'kind': 'user' if is_user else 'model',
                    'linked': bool(bindings),
                    'bindings': sorted(bindings),
                    'entityToken': getattr(param, 'entityToken', ''),
                    'driven': driven,
                    'favorite': getattr(param, 'isFavorite', None),
                    'valueExpression': value_expression,
                }
            )
        variant_state = self._variants_state(design)
        controlled = {
            column['name']
            for column in variant_state.get('variantColumns', [])
            if column['kind'] == 'parameter' and not column.get('missing')
        }
        for parameter in parameters:
            parameter['configured'] = parameter['name'] in controlled
        return {
            'documentId': self._document_id,
            'draftId': self._draft_id,
            'documentName': self._document.name,
            'defaultLengthUnit': manager.defaultLengthUnits,
            'unitsSnapshotToken': (
                self._snapshot_token(design, 'units')
                if not variant_state.get('variantsError')
                else None
            ),
            'parameters': parameters,
            **variant_state,
        }

    def _snapshot_token(self, design, text):
        parameters = []
        dynamic = self._stochastic_parameters(design)
        for param in design.allParameters:
            try:
                value = param.textValue if _is_text(param) else param.value
            except Exception:
                value = (
                    None  # Text/unsupported parameter, expression is still part of the snapshot.
                )
            parameters.append(
                (param.name, param.expression, param.unit, None if param.name in dynamic else value)
            )
        payload = [
            self._document_id,
            text,
            design.fusionUnitsManager.defaultLengthUnits,
            sorted(parameters),
            self._variant_sessions.get(self._draft_id),
            self._read_variants(design)[1],
            self._variant_feature_snapshot(design)
            if text == 'variants'
            or any(c['kind'] == 'feature' for c in self._read_variant_table(design)[0]['columns'])
            else [],
        ]
        return hashlib.sha256(
            json.dumps(payload, ensure_ascii=True, allow_nan=False).encode('utf-8')
        ).hexdigest()

    def _editable_parameter(self, design, name):
        parameter = design.allParameters.itemByName(name)
        if not parameter:
            return None
        user_parameter = design.userParameters.itemByName(name)
        if user_parameter and user_parameter == parameter:
            return parameter
        model_parameter = adsk.fusion.ModelParameter.cast(parameter)
        return (
            parameter
            if model_parameter and model_parameter == parameter and not _is_driven(parameter)
            else None
        )

    def _normalize_unit_aliases(self, text, design):
        if not callable(getattr(design.fusionUnitsManager, 'formatUnits', None)):
            return text
        known = {p.name for p in design.allParameters}
        known.update(
            match.group(1).replace('.', '_')
            for match in re.finditer(
                r'(?:^|[;\n])\s*([A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё_0-9.]*)\s*[+*/-]?=', text
            )
        )
        cache = {}

        def normalize(code):
            def alias(match):
                name = match.group()
                if name in known or name[0].isdigit() or name.startswith('.') or '.' in name:
                    return name
                if name not in cache:
                    try:
                        cache[name] = design.fusionUnitsManager.formatUnits(name) or name
                    except RuntimeError:
                        cache[name] = name
                return cache[name]

            return re.sub(
                r'(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё_0-9]*(?:\.[A-Za-zА-Яа-яЁё_0-9]+)*',
                alias,
                code,
            )

        return map_code(text, normalize)

    def _plan(self, text):
        design = self._design()
        if not design:
            raise BridgeError('NO_DESIGN', 'Open a Fusion design first.')
        if not isinstance(text, str) or len(text) > 10000:
            raise BridgeError('BAD_REQUEST', 'Expression is missing or too long.')
        text = self._normalize_unit_aliases(text, design)
        names = [
            re.sub(r'[+*/-]$', '', item.split('=', 1)[0].strip()).strip().replace('.', '_')
            for item in split_definitions(text)
            if item.strip()
        ]
        existing = [design.allParameters.itemByName(name) for name in names]
        if any(existing):
            for parameter in existing:
                if parameter:
                    if not self._editable_parameter(design, parameter.name):
                        raise BridgeError('UNSUPPORTED', 'This parameter type cannot be updated.')
            snapshot = self._dependency_snapshot(design)
            # An isolated model parameter can retain a stale, unresolved identifier
            # after a sketch edit. It cannot participate in this plan if neither it
            # nor that identifier is mentioned, and Fusion reports no graph edges.
            # It remains in the document-wide snapshot token checked before writes.
            mentioned = set(re.findall(r'[A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё_0-9]*', text))
            isolated = []
            for name, item in snapshot.items():
                expression = item.expression.strip()
                if (
                    not re.fullmatch(r'[A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё_0-9]*', expression)
                    or expression in snapshot
                    or name in mentioned
                    or expression in mentioned
                    or item.dependencies
                    or any(name in other.dependencies for other in snapshot.values())
                ):
                    continue
                parameter = design.allParameters.itemByName(name)
                if parameter and adsk.fusion.ModelParameter.cast(parameter):
                    isolated.append(name)
            planned_snapshot = {
                name: item for name, item in snapshot.items() if name not in isolated
            }
            ops = plan_batch_snapshot(
                text,
                planned_snapshot,
                design.fusionUnitsManager.defaultLengthUnits,
                self._native_function(design),
            )
        else:
            ops = plan_batch(
                text,
                self._quantities(design),
                design.fusionUnitsManager.defaultLengthUnits,
                self._native_function(design),
            )
        for op in ops:
            if op.status != 'New':
                continue
            try:
                unit_name = design.fusionUnitsManager.formatUnits(op.name)
            except RuntimeError:
                unit_name = ''
            if unit_name:
                raise BridgeError(
                    'INVALID_PARAMETER_NAME',
                    "Parameter '" + op.name + "' is a Fusion unit name. Choose another name.",
                )
        return design, ops

    def _execute_new_batch(self, design, ops):
        # Dependencies are applied before operations that reference them.
        # Errors propagate to Command.execute, which aborts the transaction.
        created_names, updated_names = [], []
        for op in ops:
            existing = design.allParameters.itemByName(op.name)
            if op.status == 'Update':
                created = self._editable_parameter(design, op.name)
                if not created or not existing or created != existing:
                    raise BridgeError('CONFLICT', 'Parameter changed: ' + op.name)
                unit = created.unit
            else:
                if existing:
                    raise BridgeError(
                        'CONFLICT', 'A parameter with this name already exists: ' + op.name
                    )
                unit = op.unit
            if unit != 'Text' and not design.fusionUnitsManager.isValidExpression(
                op.expression, unit
            ):
                raise BridgeError(
                    'INVALID_EXPRESSION', 'Fusion cannot validate expression for ' + op.name + '.'
                )
            if op.status == 'Update':
                created.expression = op.expression
                if not _expression_matches(created.expression, op.expression):
                    raise BridgeError(
                        'RESULT_MISMATCH',
                        'Fusion returned a different expression for ' + op.name + '.',
                    )
                updated_names.append(op.name)
            else:
                try:
                    created = design.userParameters.add(
                        op.name, adsk.core.ValueInput.createByString(op.expression), op.unit, ''
                    )
                except RuntimeError as exc:
                    raise BridgeError(
                        'CREATE_FAILED',
                        "Fusion could not create parameter '" + op.name + "': " + str(exc),
                    ) from exc
                if not created:
                    raise BridgeError(
                        'CREATE_FAILED', 'Fusion could not create parameter ' + op.name + '.'
                    )
                created_names.append(op.name)
            self._verify_value(created, op)
        return {'created': created_names, 'updated': updated_names}

    def _native_function(self, design):
        manager = design.fusionUnitsManager
        return (
            NativeExpressionEngine(manager, self._quantities(design))
            if hasattr(manager, 'evaluateExpression')
            else None
        )

    def _verify_value(self, parameter, op):
        unit = parameter.unit
        if isinstance(op.quantity, TextValue):
            if not _is_text(parameter) or (
                not op.quantity.stochastic and parameter.textValue != op.quantity.value
            ):
                raise BridgeError(
                    'RESULT_MISMATCH', 'Fusion text differs from preview for ' + op.name + '.'
                )
            return
        if _is_text(parameter):
            raise BridgeError('TYPE_MISMATCH', 'Cannot assign a number to a text parameter.')
        _, dimension, _ = unit_definition(unit)
        if dimension != op.quantity.dimension:
            raise BridgeError(
                'RESULT_MISMATCH', 'Fusion returned an unexpected unit for ' + op.name + '.'
            )
        actual = parameter.value * 10.0 ** dimension[0]
        if not math.isfinite(actual):
            raise BridgeError(
                'RESULT_MISMATCH', 'Fusion returned a non-finite value for ' + op.name + '.'
            )
        if op.quantity.stochastic:
            # The expression and type are verified; the sampled preview value is
            # deliberately not compared with a fresh native random evaluation.
            return
        if not math.isclose(actual, op.quantity.value, rel_tol=1e-9, abs_tol=1e-9):
            raise BridgeError(
                'RESULT_MISMATCH', 'Fusion result differs from preview for ' + op.name + '.'
            )

    def _execute_direct_batch(self, design, ops):
        if len(ops) == 1:
            return self._execute_new_batch(design, ops)
        if any(op.status != 'Update' for op in ops):
            created, updated = [], []
            for op in ops:
                try:
                    result = self._execute_new_batch(design, [op])
                    created.extend(result['created'])
                    updated.extend(result['updated'])
                except Exception as exc:
                    completed = created + updated
                    summary = ', '.join(completed) if completed else 'none confirmed'
                    raise BridgeError(
                        'DIRECT_PARTIAL',
                        'The batch did not finish. Confirmed changes: '
                        + summary
                        + '. '
                        + op.name
                        + ' may also have changed. '
                        'Refresh the model before retrying: ' + str(exc),
                    ) from exc
            return {'created': created, 'updated': updated}
        if not ops:
            return {'created': [], 'updated': []}
        parameters, values = [], []
        for op in ops:
            parameter = self._editable_parameter(design, op.name)
            existing = design.allParameters.itemByName(op.name)
            if not parameter or parameter != existing:
                raise BridgeError('CONFLICT', 'Parameter changed: ' + op.name)
            if parameter.unit != 'Text' and not design.fusionUnitsManager.isValidExpression(
                op.expression, parameter.unit
            ):
                raise BridgeError(
                    'INVALID_EXPRESSION', 'Fusion cannot validate expression for ' + op.name + '.'
                )
            parameters.append(parameter)
            values.append(adsk.core.ValueInput.createByString(op.expression))
        if not design.modifyParameters(parameters, values):
            raise BridgeError('UPDATE_FAILED', 'Fusion could not update the parameter batch.')
        for parameter, op in zip(parameters, ops):
            if not _expression_matches(parameter.expression, op.expression):
                raise BridgeError(
                    'RESULT_MISMATCH', 'Fusion returned a different expression for ' + op.name + '.'
                )
            self._verify_value(parameter, op)
        return {'created': [], 'updated': [op.name for op in ops]}

    def request(self, action, payload):
        if action == 'variants.cell.preview':
            return self._preview_variant_cell(payload)
        if action == 'variants.selection.get':
            return self._variant_timeline_selection()
        if action.startswith('variants.'):
            return self._request_variant(action, payload)
        if action == 'document.units':
            if not self.in_command and not self.in_direct_apply:
                raise BridgeError('BAD_CONTEXT', 'Changes require a Fusion command.')
            design = self._design()
            if payload.get('snapshotToken') != self._snapshot_token(design, 'units'):
                raise BridgeError(
                    'CONFLICT', 'The model changed. Check the current units and retry.'
                )
            names = {
                'mm': 'MillimeterDistanceUnits',
                'cm': 'CentimeterDistanceUnits',
                'm': 'MeterDistanceUnits',
                'in': 'InchDistanceUnits',
                'ft': 'FootDistanceUnits',
            }
            unit = payload.get('unit')
            if not isinstance(unit, str) or unit not in names:
                raise BridgeError('BAD_REQUEST', 'Choose a supported length unit.')
            manager = design.fusionUnitsManager
            manager.distanceDisplayUnits = getattr(adsk.fusion.DistanceUnits, names[unit])
            if manager.defaultLengthUnits != unit:
                raise BridgeError('UPDATE_FAILED', 'Fusion did not accept the model units.')
            return {'defaultLengthUnit': manager.defaultLengthUnits}
        if action == 'parameters.favorite':
            if not self.in_command and not self.in_direct_apply:
                raise BridgeError('BAD_CONTEXT', 'Changes require a Fusion command.')
            name, token, expected, favorite = (
                payload.get('name'),
                payload.get('entityToken'),
                payload.get('expected'),
                payload.get('favorite'),
            )
            if (
                not isinstance(name, str)
                or not name
                or not isinstance(token, str)
                or not token
                or type(expected) is not bool
                or type(favorite) is not bool
            ):
                raise BridgeError('BAD_REQUEST', 'Parameter identity or favorite state is missing.')
            design = self._design()
            parameter = design.allParameters.itemByName(name) if design else None
            matches = design.findEntityByToken(token) if design else []
            if (
                not parameter
                or len(matches) != 1
                or matches[0] != parameter
                or parameter.isFavorite != expected
            ):
                raise BridgeError('CONFLICT', 'The parameter changed. Refresh and try again.')
            try:
                parameter.isFavorite = favorite
                if parameter.isFavorite != favorite:
                    raise ValueError('Fusion did not accept the favorite state.')
            except Exception as exc:
                raise BridgeError(
                    'FAVORITE_FAILED', 'Fusion could not update the favorite: ' + str(exc)
                ) from exc
            return {'favorite': favorite}
        if action == 'parameters.rename':
            if not self.in_command and not self.in_direct_apply:
                raise BridgeError('BAD_CONTEXT', 'Changes require a Fusion command.')
            name, token, new_name = (
                payload.get('name'),
                payload.get('entityToken'),
                payload.get('newName'),
            )
            if (
                not isinstance(name, str)
                or not isinstance(token, str)
                or not token
                or not isinstance(new_name, str)
            ):
                raise BridgeError('BAD_REQUEST', 'Parameter identity or name is missing.')
            if not re.fullmatch(r'[A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё_0-9]*', new_name):
                raise BridgeError('INVALID_PARAMETER_NAME', 'Enter a valid parameter name.')
            design = self._design()
            parameter = design.allParameters.itemByName(name) if design else None
            matches = design.findEntityByToken(token) if design else []
            if not parameter or len(matches) != 1 or matches[0] != parameter:
                raise BridgeError('CONFLICT', 'The parameter changed. Refresh and try again.')
            if not self._editable_parameter(design, name):
                raise BridgeError('READ_ONLY', 'This parameter cannot be renamed.')
            if parameter.expression != payload.get('expression') or parameter.unit != payload.get(
                'unit'
            ):
                raise BridgeError('CONFLICT', 'The parameter changed. Refresh and try again.')
            existing = design.allParameters.itemByName(new_name)
            if existing and existing != parameter:
                raise BridgeError('CONFLICT', 'A parameter with this name already exists.')
            variants, _ = self._read_variants(design)
            try:
                parameter.name = new_name
                if parameter.name != new_name:
                    raise ValueError('Fusion did not accept the name.')
                self._rename_variant_references(design, variants, name, new_name)
            except Exception as exc:
                raise BridgeError(
                    'RENAME_FAILED', 'Fusion could not rename the parameter: ' + str(exc)
                ) from exc
            return {'renamed': new_name}
        if action == 'parameters.delete':
            if not self.in_command and not self.in_direct_apply:
                raise BridgeError('BAD_CONTEXT', 'Changes require a Fusion command.')
            name, token = payload.get('name'), payload.get('entityToken')
            if not isinstance(name, str) or not name or not isinstance(token, str) or not token:
                raise BridgeError(
                    'BAD_REQUEST', 'Parameter identity is missing. Refresh and try again.'
                )
            design = self._design()
            parameter = design.allParameters.itemByName(name) if design else None
            matches = design.findEntityByToken(token) if design else []
            if not parameter or len(matches) != 1 or matches[0] != parameter:
                raise BridgeError('CONFLICT', 'The parameter changed. Refresh and try again.')
            if _is_driven(parameter):
                raise BridgeError(
                    'READ_ONLY', 'Driven dimensions cannot be deleted from this panel.'
                )
            try:
                deleted = parameter.deleteMe()
            except Exception as exc:
                raise BridgeError(
                    'DELETE_FAILED', 'Fusion could not delete ' + name + ': ' + str(exc)
                ) from exc
            if not deleted:
                raise BridgeError('DELETE_FAILED', 'Fusion could not delete ' + name + '.')
            return {'deleted': name}
        if action == 'parameters.preview':
            equation = payload.get('inlineEquation')
            if equation is not None:
                if (
                    not isinstance(equation, dict)
                    or not isinstance(equation.get('target'), str)
                    or not isinstance(equation.get('expression'), str)
                ):
                    raise BridgeError('BAD_REQUEST', 'The equation is invalid.')
                design = self._design()
                target = self._editable_parameter(design, equation['target']) if design else None
                if not target:
                    raise BridgeError(
                        'CONFLICT', 'The target parameter changed. Refresh and try again.'
                    )
                text = solve_inline_equation(
                    equation['expression'],
                    target.name,
                    target.unit,
                    self._quantities(design),
                    [p.name for p in design.allParameters],
                )
                design, ops = self._plan(text)
                created = [op.name for op in ops if op.status == 'New']
                updated = [op.name for op in ops if op.status == 'Update']
                if len(ops) != 2 or len(created) != 1 or updated != [target.name]:
                    raise BridgeError(
                        'BAD_REQUEST',
                        'The equation must create one parameter and update the target.',
                    )
                return {
                    'snapshotToken': self._snapshot_token(design, text),
                    'resolvedText': text,
                    'newName': created[0],
                    'items': [
                        {
                            'name': op.name,
                            'expression': op.expression,
                            'value': display_quantity(op.quantity, op.unit),
                            'unit': op.unit,
                            'status': op.status,
                            'estimated': op.quantity.stochastic,
                            'message': 'Sample value. Fusion will evaluate this expression again when applied.'
                            if op.quantity.stochastic
                            else None,
                        }
                        for op in ops
                    ],
                    'valid': True,
                }
            if 'sourceValueExpression' in payload:
                design = self._design()
                name = payload.get('sourceName')
                expected = payload.get('sourceValueExpression')
                if not isinstance(name, str) or not isinstance(expected, str):
                    raise BridgeError('BAD_REQUEST', 'The source parameter value is missing.')
                parameter = design.allParameters.itemByName(name) if design else None
                try:
                    current = _value_expression(parameter) if parameter else None
                except (AttributeError, ValueError, TypeError, RuntimeError):
                    current = None
                if current != expected:
                    raise BridgeError(
                        'CONFLICT', 'The parameter value changed. Refresh and try again.'
                    )
            design, ops = self._plan(payload.get('text'))
            token = self._snapshot_token(design, payload.get('text'))
            return {
                'snapshotToken': token,
                'items': [
                    {
                        'name': op.name,
                        'expression': op.expression,
                        'value': display_quantity(op.quantity, op.unit),
                        'unit': op.unit,
                        'status': op.status,
                        'estimated': op.quantity.stochastic,
                        'message': 'Sample value. Fusion will evaluate this expression again when applied.'
                        if op.quantity.stochastic
                        else None,
                        'previous': str(display_quantity(op.previous, op.unit))
                        if op.previous
                        else None,
                    }
                    for op in ops
                ],
                'valid': bool(ops),
            }
        if action == 'parameters.apply':
            if not self.in_command and not self.in_direct_apply:
                raise BridgeError('BAD_CONTEXT', 'Changes require a Fusion command.')
            if payload.get('requireTransaction') is True and self.in_direct_apply:
                raise BridgeError(
                    'TRANSACTION_REQUIRED',
                    'Finish the active Fusion command or sketch before creating and linking a parameter.',
                )
            design = self._design()
            text = payload.get('text')
            if (
                not design
                or not isinstance(text, str)
                or payload.get('snapshotToken') != self._snapshot_token(design, text)
            ):
                raise BridgeError(
                    'STALE_PREVIEW', 'The design changed. Refresh the preview and try again.'
                )
            design, ops = self._plan(text)
            if self.in_direct_apply:
                try:
                    return self._execute_tracked_parameters(design, ops)
                except BridgeError as exc:
                    if exc.code in {
                        'DIRECT_PARTIAL',
                        'CONFLICT',
                        'INVALID_EXPRESSION',
                        'UPDATE_FAILED',
                        'VARIANT_PARTIAL',
                        'VARIANT_SAVE_FAILED',
                    }:
                        raise
                    raise BridgeError(
                        'DIRECT_APPLY_FAILED',
                        'Fusion could not confirm the change. Refresh the model before retrying: '
                        + str(exc),
                    ) from exc
                except Exception as exc:
                    raise BridgeError(
                        'DIRECT_APPLY_FAILED',
                        'Fusion could not confirm the change. Refresh the model before retrying: '
                        + str(exc),
                    ) from exc
            return self._execute_tracked_parameters(design, ops)
        if action == 'calculator.evaluate':
            design = self._design()
            expression = payload.get('expression')
            if not isinstance(expression, str) or len(expression) > 10000:
                raise BridgeError('BAD_REQUEST', 'Expression is missing or too long.')
            quantities = self._quantities(design)
            expression = self._normalize_unit_aliases(
                normalize_expression(expression, quantities), design
            )
            quantity = evaluate(
                expression, quantities, self._native_function(design), allow_nondeterministic=True
            )
            if isinstance(quantity, TextValue):
                return {'value': quantity.value, 'unit': 'Text', 'formatted': quantity.value}
            unit = {
                LENGTH: design.fusionUnitsManager.defaultLengthUnits,
                ANGLE: 'deg',
                SCALAR: '',
            }.get(
                quantity.dimension,
                dimension_unit(quantity.dimension, design.fusionUnitsManager.defaultLengthUnits),
            )
            manager = design.fusionUnitsManager
            value = quantity.value / (10.0 ** quantity.dimension[0])
            formatted = manager.formatValue(value, unit) if unit else str(value)
            display_value = (
                value
                if not unit
                else manager.convert(value, dimension_unit(quantity.dimension, 'cm'), unit)
            )
            return {'value': display_value, 'unit': unit, 'formatted': formatted}
        if action == 'cleanup.analyze':
            design = self._design()
            items = []
            for p in design.userParameters:
                try:
                    formatted = (
                        p.textValue
                        if _is_text(p)
                        else (
                            design.fusionUnitsManager.formatValue(p.value, p.unit)
                            if p.unit
                            else str(p.value)
                        )
                    )
                except Exception:
                    formatted = ''
                items.append(
                    {
                        'name': p.name,
                        'expression': p.expression,
                        'value': formatted,
                        'unit': p.unit,
                        'comment': p.comment,
                        'favorite': p.isFavorite,
                        'protected': True,
                        'selected': False,
                        'reason': 'Protected: dependency coverage has not yet been verified.',
                    }
                )
            return {'items': items}

        raise BridgeError('BAD_REQUEST', 'Unknown action.')
