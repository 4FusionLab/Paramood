import { fusionFunctions, fusionConstants, fusionUnits } from '../../src/expression-catalog';
import type { Parameter } from './bridge';
import { hasAssignment, hasDefinitionSeparator } from './expression-syntax';

const numeric = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const reserved = new Set(
  [
    'this',
    ...fusionFunctions.map((f) => f.name),
    ...fusionConstants.map((c) => c.name),
    ...fusionUnits,
  ].map((name) => name.toLowerCase()),
);

export function prepareInlineEdit(parameter: Parameter, input: string, parameters: Parameter[]) {
  const expression = input.trim();
  if (!expression || hasDefinitionSeparator(expression))
    throw new Error('Enter a single expression.');
  if (parameter.valueType === 'text' || parameter.unit === 'Text') {
    if (hasAssignment(expression))
      throw new Error('Edit the text expression directly, without an assignment.');
    return { text: `${parameter.name}=${expression}` };
  }
  const relative = expression.match(/^([+*/-])\s*=\s*(.*)$/s);
  if (relative) {
    if (!relative[2].trim() || hasAssignment(relative[2]))
      throw new Error('Enter one expression after the relative operator.');
    return { text: `${parameter.name}${relative[1]}=${relative[2].trim()}` };
  }
  if (!hasAssignment(expression)) {
    const nativeName = expression.replace(/\./g, '_');
    if (
      /^(?:[A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё_0-9]*|[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё0-9]*(?:\.[A-Za-zА-Яа-яЁё0-9]+)+)$/.test(
        expression,
      ) &&
      !reserved.has(expression.toLowerCase()) &&
      !parameters.some((item) => item.name.toLowerCase() === nativeName.toLowerCase())
    ) {
      if (!parameter.valueExpression)
        throw new Error('The current value is unavailable. Refresh and try again.');
      return {
        text: `${expression}=${parameter.valueExpression};${parameter.name}=${expression}`,
        newName: nativeName,
        sourceValueExpression: parameter.valueExpression,
      };
    }
    return {
      text: `${parameter.name}=${expression}${numeric.test(expression) ? ` ${parameter.unit || 'n'}` : ''}`,
    };
  }
  const match = expression.match(
    /^\s*([A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё_0-9]*(?:\.[A-Za-zА-Яа-яЁё0-9]+)*)\s*=\s*(.+)$/,
  );
  if (!match && expression.split('=').length === 2) return { text: '', equation: expression };
  if (!match || match[2].includes('='))
    throw new Error('Enter a new parameter definition, such as x=25.');
  const [, name, rhs] = match;
  const newName = name.replace(/\./g, '_');
  if (parameters.some((item) => item.name.toLowerCase() === newName.toLowerCase()))
    throw new Error(`Parameter ${newName} already exists. Enter a new name.`);
  const unit = parameter.unit ? ` ${parameter.unit}` : 'n';
  const value = `${rhs.trim()}${numeric.test(rhs.trim()) ? unit : ''}`;
  return { text: `${name}=${value};${parameter.name}=${name}`, newName };
}
