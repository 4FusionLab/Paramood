import type { Parameter } from './bridge';

const numeric = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const reserved = new Set([
  'this',
  'mm',
  'cm',
  'm',
  'in',
  'ft',
  'deg',
  'rad',
  'n',
  'sqrt',
  'sin',
  'cos',
  'tan',
  'abs',
  'floor',
  'ceil',
  'round',
  'min',
  'max',
]);

export function prepareInlineEdit(parameter: Parameter, input: string, parameters: Parameter[]) {
  const expression = input.trim();
  if (!expression || /[;\n\r]/.test(expression)) throw new Error('Enter a single expression.');
  if (!expression.includes('=')) {
    const nativeName = expression.replace(/\./g, '_');
    if (
      /^(?:[A-Za-z_]\w*|[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+)$/.test(expression) &&
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
      text: `${parameter.name}=${expression}${numeric.test(expression) && parameter.unit ? ` ${parameter.unit}` : ''}`,
    };
  }
  const match = expression.match(/^\s*([A-Za-z_]\w*(?:\.[A-Za-z0-9]+)*)\s*=\s*(.+)$/);
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
