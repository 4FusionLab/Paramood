import type { Parameter } from './bridge';
import type { ParameterNode } from './parameter-tree';

const folded = (value: string) => value.normalize('NFC').toLocaleLowerCase();

export function parameterMatches(parameter: Parameter, query: string): boolean {
  const needle = folded(query.trim());
  return [
    parameter.name,
    parameter.name.replaceAll('_', '.'),
    parameter.expression,
    parameter.comment || '',
  ].some((value) => folded(value).includes(needle));
}

/** Keep matching parameters and their ancestors, without unrelated parent values. */
export function searchParameterTree(
  node: ParameterNode<Parameter>,
  query: string,
): ParameterNode<Parameter> {
  if (!query.trim()) return node;
  const children = new Map<string, ParameterNode<Parameter>>();
  for (const [name, child] of node.children) {
    const result = searchParameterTree(child, query);
    if (result.parameter || result.children.size) children.set(name, result);
  }
  return {
    children,
    isGroup: node.isGroup ?? node.children.size > 0,
    parameter:
      node.parameter && parameterMatches(node.parameter, query) ? node.parameter : undefined,
  };
}

/** Capture nested palette scrolling and the document scroller before filtering shrinks them. */
export function captureTreeScroll(root: HTMLElement | null): () => void {
  const positions: { element: Element; top: number; left: number }[] = [];
  let element: Element | null = root;
  while (element) {
    positions.push({ element, top: element.scrollTop, left: element.scrollLeft });
    element = element.parentElement;
  }
  if (
    document.scrollingElement &&
    !positions.some((p) => p.element === document.scrollingElement)
  ) {
    element = document.scrollingElement;
    positions.push({ element, top: element.scrollTop, left: element.scrollLeft });
  }
  return () =>
    positions.forEach(({ element, top, left }) => {
      element.scrollTop = top;
      element.scrollLeft = left;
    });
}
