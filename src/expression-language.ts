import {
  constantByName,
  functionByName,
  fusionOperators,
  fusionUnits,
} from './expression-catalog.ts';

export interface ExpressionToken {
  value: string;
  from: number;
  to: number;
  kind: 'identifier' | 'number' | 'string' | 'operator';
}
/** One lexer for incomplete editor text, including scientific notation and escaped strings. */
export function expressionTokens(text: string): ExpressionToken[] {
  const pattern =
    /'(?:\\.|[^'\\])*'?|"(?:\\.|[^"\\])*"?|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-zА-Яа-яЁё_µ°][A-Za-zА-Яа-яЁё_0-9µ°]*(?:\.[A-Za-zА-Яа-яЁё0-9_]+)*|>=|<=|==|<>|!=|[^\s]/y;
  const result: ExpressionToken[] = [];
  for (let i = 0; i < text.length;) {
    if (/\s/.test(text[i])) {
      i++;
      continue;
    }
    const previous = result.at(-1);
    const symbols: Record<string, string> = { '"': 'in', "'": 'ft', µ: 'micron', '°': 'deg' };
    if (symbols[text[i]] && (previous?.kind === 'number' || previous?.value === ')')) {
      result.push({ value: symbols[text[i]], from: i, to: i + 1, kind: 'identifier' });
      i++;
      continue;
    }
    pattern.lastIndex = i;
    const match = pattern.exec(text);
    if (!match) {
      i++;
      continue;
    }
    const value = match[0];
    result.push({
      value,
      from: i,
      to: i + value.length,
      kind: /^['"]/.test(value)
        ? 'string'
        : /^(?:\d|\.\d)/.test(value)
          ? 'number'
          : /^[A-Za-zА-Яа-яЁё_µ°]/.test(value)
            ? 'identifier'
            : 'operator',
    });
    i += value.length;
  }
  return result;
}
/** Units suffix a numeric value; an identifier being entered is never itself a value. */
export function unitCompletionFrom(text: string, pos: number): number | null {
  const tokens = expressionTokens(text.slice(0, pos));
  let from = pos;
  const last = tokens.at(-1);
  if (last?.kind === 'identifier' && last.to === pos) {
    if (
      !/^[A-Za-zµ°][A-Za-z_0-9µ°]*$/.test(last.value) ||
      text.slice(last.from, last.to) !== last.value
    )
      return null;
    from = last.from;
    tokens.pop();
    if (/^[eE]$/.test(last.value) && tokens.at(-1)?.to === from) return null;
  }
  const value = tokens.at(-1);
  return value &&
    (value.kind === 'number' || value.value === ')') &&
    /^[ \t]*$/.test(text.slice(value.to, from))
    ? from
    : null;
}
export function normalizeUnitSymbols(text: string): string {
  let result = '',
    start = 0;
  for (const token of expressionTokens(text)) {
    result +=
      text.slice(start, token.from) +
      (token.kind === 'identifier' &&
      ['"', "'", 'µ', '°'].includes(text.slice(token.from, token.to))
        ? ' ' + token.value
        : text.slice(token.from, token.to));
    start = token.to;
  }
  return result + text.slice(start);
}

export function statementStart(text: string, pos: number): number {
  let depth = 0,
    start = 0;
  for (const t of expressionTokens(text.slice(0, pos))) {
    if (t.kind === 'string') continue;
    if (t.value === '(') depth++;
    if (t.value === ')') depth = Math.max(0, depth - 1);
    if (t.value === ';' && depth === 0) start = t.to;
    // Newlines only separate definitions outside function calls.
    if (depth === 0) {
      const nextLine = text.slice(t.to, pos).match(/^\s*\n/);
      if (nextLine) start = t.to + nextLine[0].length;
    }
  }
  return start;
}
export function signatureContext(text: string, pos: number) {
  const tokens = expressionTokens(text.slice(0, pos));
  const last = tokens.at(-1);
  if (last?.kind === 'string' && !/^(['"])(?:\\.|(?!\1).)*\1$/s.test(last.value)) return null;
  const stack: { name: string; from: number; argument: number }[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.value === '(')
      stack.push({
        name: tokens[i - 1]?.kind === 'identifier' ? tokens[i - 1].value : '',
        from: t.from,
        argument: 0,
      });
    else if (t.value === ')') stack.pop();
    else if (t.value === ';' && stack.length) stack[stack.length - 1].argument++;
  }
  const call = [...stack].reverse().find((frame) => frame.name);
  const fn = call && functionByName.get(call.name);
  return fn && call ? { fn, from: call.from, argument: call.argument } : null;
}
export interface ExpressionDiagnostic {
  from: number;
  to: number;
  message: string;
  code: string;
  severity?: 'error' | 'info';
}
/** Diagnose only proven errors. Missing trailing tokens remain a normal editing state. */
export function expressionDiagnostics(
  text: string,
  known: ReadonlyMap<string, string>,
  batch = false,
): ExpressionDiagnostic[] {
  const tokens = expressionTokens(text),
    result: ExpressionDiagnostic[] = [];
  const targets = new Set<string>();
  if (batch)
    for (let i = 0; i < tokens.length; i++)
      if (
        tokens[i + 1]?.value === '=' ||
        (['+', '-', '*', '/'].includes(tokens[i + 1]?.value) && tokens[i + 2]?.value === '=')
      )
        targets.add(tokens[i].value.replace(/\./g, '_'));
  const error = (t: ExpressionToken, code: string, message: string) =>
    result.push({ from: t.from, to: t.to, code, message });
  const stack: { token: ExpressionToken; name: string; count: number; start: number }[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i],
      next = tokens[i + 1];
    if (t.value === '(') {
      const previous = tokens[i - 1];
      stack.push({
        token: t,
        name: previous?.kind === 'identifier' ? previous.value : '',
        count: 0,
        start: i + 1,
      });
    } else if (t.value === ')') {
      const call = stack.pop();
      if (!call) {
        error(t, 'parenthesis', 'Unexpected closing parenthesis.');
        continue;
      }
      const fn = functionByName.get(call.name);
      if (fn) {
        const count = i === call.start ? 0 : call.count + 1;
        if (count !== fn.arity && count !== 0)
          error(
            call.token,
            'arity',
            `${fn.name} expects ${fn.arity} argument${fn.arity === 1 ? '' : 's'}; received ${count}.`,
          );
        // Infer simple arguments only. Composite expressions are validated by Fusion at Preview.
        const args: ExpressionToken[][] = [[]];
        let depth = 0;
        for (const a of tokens.slice(call.start, i)) {
          if (a.value === '(') depth++;
          if (a.value === ')') depth--;
          if (a.value === ';' && !depth) args.push([]);
          else args.at(-1)!.push(a);
        }
        const dimensions = args.map((a) => simpleDimension(a, known));
        fn.arguments.forEach((arg, n) => {
          const dim = dimensions[n];
          if (
            dim &&
            ((arg.type === 'unitless' && dim !== 'unitless') ||
              (arg.type === 'angle' && !['angle', 'unitless'].includes(dim)))
          )
            error(args[n][0], 'dimension', `${arg.name} requires ${arg.type}.`);
        });
        if (
          ['min', 'max'].includes(fn.name) &&
          dimensions[0] &&
          dimensions[1] &&
          dimensions[0] !== dimensions[1] &&
          !dimensions.includes('unitless')
        )
          error(call.token, 'dimension', 'Arguments must have matching dimensions.');
        if (
          fn.name === 'if' &&
          dimensions[1] &&
          dimensions[2] &&
          dimensions[1] !== dimensions[2] &&
          dimensions[1] !== 'unitless' &&
          dimensions[2] !== 'unitless'
        )
          error(
            call.token,
            'dimension',
            'Conditional branches must have matching types and dimensions.',
          );
      }
    } else if (t.value === ';' && stack.length) stack.at(-1)!.count++;
    else if (t.value === ',' && stack.length)
      error(t, 'separator', 'Separate function arguments with a semicolon (;).');
    else if (t.value === '!=') error(t, 'operator', 'Use <> for not equal.');
    if (t.kind !== 'identifier') continue;
    const native = t.value.replace(/\./g, '_');
    const isTarget =
      next?.value === '=' ||
      (next && ['+', '-', '*', '/'].includes(next.value) && tokens[i + 2]?.value === '=');
    if (isTarget && batch) {
      if (constantByName.has(t.value) || functionByName.has(t.value))
        error(t, 'reserved', 'This name is reserved by Fusion.');
      continue;
    }
    if (next?.value === '(') {
      if (constantByName.has(t.value))
        error(t, 'constant', `${t.value} is a constant and cannot be called.`);
      else if (!functionByName.has(t.value) && !['not'].includes(t.value))
        error(t, 'function', `Unknown function: ${t.value}.`);
      continue;
    }
    if (
      known.has(native) ||
      targets.has(native) ||
      constantByName.has(t.value) ||
      fusionUnits.includes(t.value) ||
      fusionOperators.includes(t.value) ||
      t.value === 'this'
    )
      continue;
    // The final identifier may still be a prefix the user is typing.
    if (i === tokens.length - 1 && t.to === text.length) continue;
    if (tokens[i - 1]?.kind === 'number')
      result.push({
        from: t.from,
        to: t.to,
        code: 'unit',
        severity: 'info',
        message: `Fusion will validate this unit alias: ${t.value}.`,
      });
    else error(t, 'parameter', `Unknown parameter: ${t.value}.`);
  }
  return result;
}
function simpleDimension(
  tokens: ExpressionToken[],
  known: ReadonlyMap<string, string>,
): string | undefined {
  const t = tokens.filter((t) => !['+', '-'].includes(t.value));
  if (t.length === 1) {
    if (t[0].kind === 'number') return 'unitless';
    if (t[0].kind === 'string') return 'text';
    return (
      constantByName.get(t[0].value)?.dimension ??
      unitDimension(known.get(t[0].value.replace(/\./g, '_')))
    );
  }
  if (t.length === 2 && t[0].kind === 'number') return unitDimension(t[1].value);
  return undefined;
}
function unitDimension(unit?: string): string | undefined {
  if (unit === '' || unit === 'n') return 'unitless';
  if (unit && ['deg', 'rad', 'grad'].includes(unit)) return 'angle';
  if (
    unit &&
    ['mm', 'cm', 'm', 'hm', 'micron', 'in', 'ft', 'yd', 'mi', 'nauticalMile', 'mil'].includes(unit)
  )
    return 'length';
  if (unit === 'Text') return 'text';
  return undefined;
}

/** Avoid native validation while a user is still assembling a call or token. */
export function incompleteExpression(text: string, knownNames: readonly string[] = []): boolean {
  const tokens = expressionTokens(text);
  const last = tokens.at(-1);
  if (!last) return true;
  if (
    last.kind === 'identifier' &&
    knownNames.some((name) => name !== last.value && name.startsWith(last.value))
  )
    return true;
  if (last.kind === 'string' && !/^(['"])(?:\\.|(?!\1).)*\1$/s.test(last.value)) return true;
  let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.value === '(') {
      depth++;
      const fn = functionByName.get(tokens[i - 1]?.value);
      if (fn?.arity && tokens[i + 1]?.value === ')') return true;
    }
    if (token.value === ')') {
      if (tokens[i - 1]?.value === ';') return true;
      depth--;
    }
  }
  if (
    depth > 0 ||
    [
      '=',
      '+',
      '-',
      '*',
      '/',
      '^',
      '%',
      ';',
      '<',
      '>',
      '<=',
      '>=',
      '==',
      '<>',
      'and',
      'or',
      'not',
    ].includes(last.value)
  )
    return true;
  if (
    last.kind === 'identifier' &&
    last.to === text.length &&
    (Array.from(functionByName.keys()).some((name) => name.startsWith(last.value)) ||
      Array.from(constantByName.keys()).some(
        (name) => name !== last.value && name.startsWith(last.value),
      ))
  )
    return true;
  return false;
}
