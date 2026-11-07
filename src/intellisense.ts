/**
 * UI-only symbolic layer for Autodesk Fusion parameters.
 * Virtual box.size resolves to a real Fusion parameter named box_size.
 */
export interface FusionParameter {
  name: string;
  expression?: string;
  unit?: string;
  comment?: string;
  value?: number | string;
  isReadOnly?: boolean;
}
export interface SymbolEntry {
  label: string;
  kind: 'namespace' | 'parameter';
  path: string;
  nativeName?: string;
  unit?: string;
  comment?: string;
  value?: number | string;
  isReadOnly?: boolean;
}
export interface Diagnostic {
  code: 'unknown-path' | 'namespace-as-value' | 'invalid-target' | 'name-collision';
  from: number;
  to: number;
  path: string;
  message: string;
}
interface Node {
  path: string;
  children: Map<string, Node>;
  parameter?: FusionParameter;
}
const IDENTIFIER = /^[A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё_0-9]*$/;
const VIRTUAL_PATH =
  /^[A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё_0-9]*(?:\.[A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё_0-9]*)*$/;
const IDENTIFIER_START = /[A-Za-zА-Яа-яЁё_]/;
const IDENTIFIER_PART = /[A-Za-zА-Яа-яЁё_0-9]/;
function createNode(path: string): Node {
  return { path, children: new Map() };
}

/** Explicit aliases override the default underscore -> dot interpretation. */
export class ParameterIndex {
  private root = createNode('');
  private byPath = new Map<string, FusionParameter>();
  private byName = new Map<string, string>();
  private rawParameters = new Map<string, FusionParameter>();

  constructor(
    parameters: readonly FusionParameter[],
    aliases: Readonly<Record<string, string>> = {},
  ) {
    for (const parameter of parameters) {
      if (!IDENTIFIER.test(parameter.name))
        throw new Error('Invalid Fusion parameter identifier: ' + parameter.name);
      if (this.rawParameters.has(parameter.name))
        throw new Error('Duplicate Fusion parameter: ' + parameter.name);
      const inferredPath = parameter.name.split('_').join('.');
      // Legal native names such as _internal or a__b cannot be losslessly split.
      const path =
        aliases[parameter.name] ??
        (VIRTUAL_PATH.test(inferredPath) ? inferredPath : parameter.name);
      if (!VIRTUAL_PATH.test(path))
        throw new Error('Invalid virtual path for ' + parameter.name + ': ' + path);
      if (this.byPath.has(path)) throw new Error('Virtual path collision: ' + path);
      this.rawParameters.set(parameter.name, parameter);
      this.byName.set(parameter.name, path);
      this.byPath.set(path, parameter);
      let current = this.root;
      for (const segment of path.split('.')) {
        let child = current.children.get(segment);
        if (!child) {
          child = createNode(current.path ? current.path + '.' + segment : segment);
          current.children.set(segment, child);
        }
        current = child;
      }
      current.parameter = parameter;
    }
  }

  nativeName(path: string): string | undefined {
    // Native identifiers and virtual names both work; native takes precedence.
    return this.rawParameters.has(path) ? path : this.byPath.get(path)?.name;
  }
  virtualPath(nativeName: string): string | undefined {
    return this.byName.get(nativeName);
  }
  hasNamespace(path: string): boolean {
    const node = this.findNode(path);
    return !!node && node.children.size > 0;
  }
  /** Direct child symbols only, namespaces before parameters. */
  children(path = '', prefix = ''): SymbolEntry[] {
    const node = this.findNode(path);
    if (!node) return [];
    const entries: SymbolEntry[] = [];
    for (const [label, child] of node.children) {
      if (!label.toLowerCase().startsWith(prefix.toLowerCase())) continue;
      if (child.children.size) entries.push({ label, path: child.path, kind: 'namespace' });
      if (child.parameter) entries.push(this.toEntry(label, child.path, child.parameter));
    }
    // Also offer native flat identifiers, at lower priority, for compatibility.
    if (!path)
      for (const parameter of this.rawParameters.values()) {
        if (!parameter.name.includes('_')) continue;
        if (!parameter.name.toLowerCase().startsWith(prefix.toLowerCase())) continue;
        entries.push(this.toEntry(parameter.name, parameter.name, parameter));
      }
    return entries.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'namespace' ? -1 : 1;
      const aFlat = a.path.includes('_') && !a.path.includes('.');
      const bFlat = b.path.includes('_') && !b.path.includes('.');
      if (aFlat !== bFlat) return aFlat ? 1 : -1;
      return a.label.localeCompare(b.label);
    });
  }
  private toEntry(label: string, path: string, parameter: FusionParameter): SymbolEntry {
    return {
      label,
      path,
      kind: 'parameter',
      nativeName: parameter.name,
      unit: parameter.unit,
      comment: parameter.comment,
      value: parameter.value,
      isReadOnly: parameter.isReadOnly,
    };
  }
  private findNode(path: string): Node | undefined {
    if (!path) return this.root;
    let current: Node | undefined = this.root;
    for (const segment of path.split('.')) current = current?.children.get(segment);
    return current;
  }
}

interface Token {
  value: string;
  from: number;
  to: number;
  kind: 'identifier' | 'number' | 'string';
}
/** Preserve quoted strings, decimal points and scientific notation. */
function* tokens(input: string): Generator<Token> {
  let i = 0;
  while (i < input.length) {
    const start = i;
    const ch = input[i];
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      while (i < input.length) {
        if (input[i] === '\\') {
          i += Math.min(2, input.length - i);
          continue;
        }
        if (input[i] === quote) {
          i++;
          if (input[i] === quote) {
            i++;
            continue;
          }
          break;
        }
        i++;
      }
      yield { value: input.slice(start, i), from: start, to: i, kind: 'string' };
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === '.' && i + 1 < input.length && /[0-9]/.test(input[i + 1]))) {
      const match = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(input.slice(i));
      if (match) {
        i += match[0].length;
        yield { value: match[0], from: start, to: i, kind: 'number' };
        continue;
      }
    }
    if (IDENTIFIER_START.test(ch)) {
      i++;
      while (i < input.length) {
        if (IDENTIFIER_PART.test(input[i])) {
          i++;
          continue;
        }
        if (input[i] === '.' && i + 1 < input.length && IDENTIFIER_START.test(input[i + 1])) {
          i += 2;
          continue;
        }
        break;
      }
      yield { value: input.slice(start, i), from: start, to: i, kind: 'identifier' };
      continue;
    }
    i++;
  }
}
function rewrite(input: string, transform: (token: Token) => string): string {
  let output = '';
  let offset = 0;
  for (const token of tokens(input)) {
    if (token.kind !== 'identifier') continue;
    output += input.slice(offset, token.from) + transform(token);
    offset = token.to;
  }
  return output + input.slice(offset);
}
export function compileExpression(
  expression: string,
  index: ParameterIndex,
): { expression: string; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const compiled = rewrite(expression, (token) => {
    const native = index.nativeName(token.value);
    if (native) return native;
    if (index.hasNamespace(token.value)) {
      diagnostics.push({
        code: 'namespace-as-value',
        from: token.from,
        to: token.to,
        path: token.value,
        message: '“' + token.value + '” is a group, not a parameter.',
      });
    } else if (token.value.includes('.')) {
      diagnostics.push({
        code: 'unknown-path',
        from: token.from,
        to: token.to,
        path: token.value,
        message: 'Unknown parameter path: ' + token.value,
      });
    }
    // Unknown plain names, functions and units are validated by Fusion.
    return token.value;
  });
  return { expression: compiled, diagnostics };
}
/** Resolve the left-hand side of a new or existing named definition. */
export function resolveParameterTarget(
  path: string,
  index: ParameterIndex,
): { nativeName: string | null; diagnostics: Diagnostic[] } {
  if (!VIRTUAL_PATH.test(path)) {
    return {
      nativeName: null,
      diagnostics: [
        {
          code: 'invalid-target',
          from: 0,
          to: path.length,
          path,
          message: 'Invalid parameter path: ' + path,
        },
      ],
    };
  }
  const existing = index.nativeName(path);
  if (existing) return { nativeName: existing, diagnostics: [] };
  const candidate = path.replaceAll('.', '_');
  if (index.nativeName(candidate)) {
    return {
      nativeName: null,
      diagnostics: [
        {
          code: 'name-collision',
          from: 0,
          to: path.length,
          path,
          message: '“' + candidate + '” exists with a different virtual path.',
        },
      ],
    };
  }
  return { nativeName: candidate, diagnostics: [] };
}
export function displayExpression(fusionExpression: string, index: ParameterIndex): string {
  return rewrite(fusionExpression, (token) => index.virtualPath(token.value) ?? token.value);
}
export interface SuggestionResult {
  from: number;
  to: number;
  options: SymbolEntry[];
}
/** Caret-aware suggestions. No completion inside quoted strings. */
export function suggestCompletions(
  text: string,
  cursor: number,
  index: ParameterIndex,
  explicit = false,
): SuggestionResult | null {
  if (!Number.isInteger(cursor) || cursor < 0 || cursor > text.length) return null;
  for (const token of tokens(text)) {
    if (token.kind === 'string' && token.from < cursor && cursor <= token.to) return null;
  }
  let from = cursor;
  while (from > 0 && /[A-Za-zА-Яа-яЁё_0-9.]/.test(text[from - 1])) from--;
  const fragment = text.slice(from, cursor);
  if (!fragment) return explicit ? { from: cursor, to: cursor, options: index.children() } : null;
  if (
    !/^[A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё_0-9]*(?:\.[A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё_0-9]*)*\.?$/.test(
      fragment,
    )
  )
    return null;
  const lastDot = fragment.lastIndexOf('.');
  const scope = lastDot < 0 ? '' : fragment.slice(0, lastDot);
  const prefix = lastDot < 0 ? fragment : fragment.slice(lastDot + 1);
  const start = lastDot < 0 ? from : from + lastDot + 1;
  let to = cursor;
  while (to < text.length && IDENTIFIER_PART.test(text[to])) to++;
  return { from: start, to, options: index.children(scope, prefix) };
}
