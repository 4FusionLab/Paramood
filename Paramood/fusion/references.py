"""Find parameter owners without moving the timeline or modifying geometry."""

import adsk.fusion

from ..bridge.protocol import BridgeError
from ..core.expressions import dependency_closure
from ..core.references import expression_references, reference_paths


class ReferencesMixin:
    @staticmethod
    def _reference_graph(design):
        parameters = list(design.allParameters)
        by_name = {p.name: p for p in parameters}
        if len(by_name) != len(parameters):
            raise ValueError('Duplicate parameter names')

        def names(items):
            result = set()
            for item in items:
                if item.name not in by_name or by_name[item.name] != item:
                    raise ValueError('A dependency is outside this design')
                result.add(item.name)
            return result

        dependencies = {p.name: names(p.dependencyParameters) for p in parameters}
        dependents = {p.name: names(p.dependentParameters) for p in parameters}
        closure = dependency_closure(dependencies)
        reverse = dependency_closure(dependents)
        for name, parameter in by_name.items():
            expected = {other for other, deps in closure.items() if name in deps}
            if expected != reverse[name]:
                raise ValueError('Inconsistent dependencies for ' + name)
            if not expression_references(parameter.expression, by_name) <= dependencies[name]:
                raise ValueError('Incomplete dependencies for ' + name)
        return by_name, dependencies, reverse

    def _unused_parameter_names(self, design, variant_state):
        try:
            if variant_state.get('variantsError'):
                return set()
            by_name, _, dependents = self._reference_graph(design)
            used = {
                column['name']
                for column in variant_state.get('variantColumns', [])
                if column['kind'] == 'parameter'
            }
            for variant in variant_state.get('variants', []):
                for entry in variant['parameters']:
                    used.add(entry['name'])
                    used.update(expression_references(entry['expression'], by_name))
            return {
                name
                for name, parameter in by_name.items()
                if not dependents[name]
                and name not in used
                and design.userParameters.itemByName(name) == parameter
            }
        except Exception:
            # Missing API coverage must never be advertised as unused.
            return set()

    def _reference_parameter(self, design, payload):
        name, token = payload.get('name'), payload.get('entityToken')
        if not isinstance(name, str) or not isinstance(token, str) or not token:
            raise BridgeError('BAD_REQUEST', 'A parameter name and entity token are required.')
        parameter = design.allParameters.itemByName(name)
        matches = design.findEntityByToken(token)
        if not parameter or len(matches) != 1 or matches[0] != parameter:
            raise BridgeError('CONFLICT', 'The parameter changed. Refresh and try again.')
        return parameter

    def _find_references(self, payload):
        design = self._design()
        parameter = self._reference_parameter(design, payload)
        try:
            by_name, dependencies, dependents = self._reference_graph(design)
            expressions = {name: item.expression for name, item in by_name.items()}
            paths = reference_paths(parameter.name, expressions, dependencies)
        except Exception as exc:
            raise BridgeError(
                'REFERENCES_UNAVAILABLE', 'Cannot verify references: ' + str(exc)
            ) from exc
        entries, owners, warnings, user_references = [], [], [], []
        for name in [parameter.name, *sorted(dependents[parameter.name])]:
            current = by_name[name]
            path = paths.get(name)
            detail = {
                'name': name,
                'entityToken': current.entityToken,
                'expression': current.expression,
                'path': path or [],
                'relation': (
                    'Owner'
                    if name == parameter.name
                    else 'Direct'
                    if path and len(path) == 2
                    else 'Indirect'
                    if path
                    else 'Unknown'
                ),
            }
            if design.userParameters.itemByName(name) == current:
                if name != parameter.name:
                    user_references.append(detail)
                continue
            try:
                owner = current.createdBy
                dimension = adsk.fusion.SketchDimension.cast(owner)
                if dimension:
                    owner = dimension.parentSketch
                if not owner or not owner.isValid or not owner.timelineObject:
                    raise ValueError('No public timeline owner')
                existing = next((i for i, previous in enumerate(owners) if previous == owner), None)
                if existing is None:
                    owners.append(owner)
                    entries.append(
                        {
                            'name': owner.name,
                            'entityToken': owner.entityToken,
                            'component': current.component.name,
                            'kind': 'Sketch' if adsk.fusion.Sketch.cast(owner) else 'Feature',
                            'uses': [detail],
                        }
                    )
                else:
                    entries[existing]['uses'].append(detail)
            except Exception:
                warnings.append('Cannot resolve the timeline owner of ' + name + '.')
        return {'features': entries, 'parameters': user_references, 'warnings': warnings}

    def _select_reference(self, payload):
        ui = self.app.userInterface
        if ui.activeCommand != 'SelectCommand' or self.is_sketch_edit():
            raise BridgeError(
                'BAD_CONTEXT', 'Finish the active command or sketch before selecting a reference.'
            )
        target = payload.get('targetToken')
        if not isinstance(target, str) or not target:
            raise BridgeError('BAD_REQUEST', 'A reference token is required.')
        # Recompute membership: an old popup cannot select an unrelated or deleted entity.
        result = self._find_references(payload)
        design = self._design()
        matches = design.findEntityByToken(target)
        if len(matches) != 1:
            raise BridgeError('CONFLICT', 'The reference changed. Run Find References again.')
        entity = matches[0]
        allowed = False
        for entry in result['features']:
            candidates = design.findEntityByToken(entry['entityToken'])
            if len(candidates) == 1 and candidates[0] == entity:
                allowed = True
                break
        if not allowed or not entity.isValid:
            raise BridgeError('CONFLICT', 'This feature no longer references the parameter.')
        selections = ui.activeSelections
        previous = [selections.item(i).entity for i in range(selections.count)]
        group = getattr(entity.timelineObject, 'parentGroup', None)
        was_collapsed = bool(group and group.isCollapsed)
        try:
            if was_collapsed:
                group.isCollapsed = False
            if not selections.clear() or not selections.add(entity):
                raise RuntimeError('Fusion refused the selection')
        except Exception as exc:
            if was_collapsed and group.isValid:
                group.isCollapsed = True
            selections.clear()
            for item in previous:
                if item.isValid:
                    selections.add(item)
            raise BridgeError(
                'SELECTION_FAILED', 'Could not select the reference: ' + str(exc)
            ) from exc
        return {'selected': True}
