import { compileExpression, ParameterIndex } from '../../src/intellisense';
import type { Parameter } from './bridge';
import { hasAssignment, hasDefinitionSeparator, mapExpressionCode } from './expression-syntax';

export function parseVariantQuery(text: string, parameters: Parameter[]) {
  const separator = text.indexOf('=');
  const target = (separator < 0 ? text : text.slice(0, separator)).trim();
  const filter = target.replace(/\./g, '_').toLocaleLowerCase();
  if (separator < 0) return { filter };
  const index = new ParameterIndex(parameters);
  const name = index.nativeName(target);
  const parameter = parameters.find((item) => item.name === name);
  if (!parameter || parameter.driven || !parameter.entityToken)
    return { filter, error: 'Choose an existing editable parameter.' };
  const expression = text.slice(separator + 1).trim();
  if (!expression) return { filter };
  if (hasAssignment(expression) || hasDefinitionSeparator(expression))
    return { filter, error: 'Enter one parameter assignment.' };
  const compiled = compileExpression(expression, index);
  if (compiled.diagnostics.length) return { filter, error: compiled.diagnostics[0].message };
  let usesCurrent = false;
  mapExpressionCode(compiled.expression, (code) => {
    usesCurrent ||= /\bthis\b/.test(code);
    return code;
  });
  if (usesCurrent) {
    if (!parameter.valueExpression)
      return { filter, error: 'The current parameter value is unavailable.' };
    compiled.expression = mapExpressionCode(compiled.expression, (code) =>
      code.replace(/\bthis\b/g, `(${parameter.valueExpression})`),
    );
  }
  // A literal always uses this parameter's units, even when the model's default differs.
  const numeric = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
  return {
    filter,
    assignment: {
      parameter,
      expression:
        compiled.expression +
        (numeric.test(expression) && parameter.unit && parameter.unit !== 'Text'
          ? ` ${parameter.unit}`
          : ''),
    },
  };
}
