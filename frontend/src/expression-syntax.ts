import { expressionTokens, normalizeUnitSymbols } from '../../src/expression-language';
/** Separators and identifiers inside quoted values are content, not commands. */
export function mapExpressionCode(text: string, transform: (code: string) => string): string {
  return normalizeUnitSymbols(text).replace(
    /'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|[^'"]+/gs,
    (part) => (part.startsWith("'") || part.startsWith('"') ? part : transform(part)),
  );
}
export function hasAssignment(text: string): boolean {
  let found = false,
    depth = 0;
  mapExpressionCode(text, (code) => {
    for (let i = 0; i < code.length; i++) {
      if (code[i] === '(') depth++;
      if (code[i] === ')') depth--;
      if (
        depth === 0 &&
        code[i] === '=' &&
        !/[<>!=]/.test(code[i - 1] || '') &&
        code[i + 1] !== '='
      )
        found = true;
    }
    return code;
  });
  return found;
}
export function hasDefinitionSeparator(text: string): boolean {
  let depth = 0,
    found = false;
  mapExpressionCode(text, (code) => {
    for (const char of code) {
      if (char === '(') depth++;
      if (char === ')') depth--;
      if (depth === 0 && /[;\r\n]/.test(char)) found = true;
    }
    return code;
  });
  return found;
}
export function inString(text: string): boolean {
  const last = expressionTokens(text).at(-1);
  return !!last && last.kind === 'string' && !/^(['"])(?:\\.|(?!\1).)*\1$/s.test(last.value);
}
