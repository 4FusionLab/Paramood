export type ParameterNode<T extends { name: string }> = {
  children: Map<string, ParameterNode<T>>;
  parameter?: T;
};
export function parameterTree<T extends { name: string }>(parameters: T[]): ParameterNode<T> {
  const root: ParameterNode<T> = { children: new Map() };
  for (const parameter of parameters) {
    const parts = /^[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё0-9]*(?:_[A-Za-zА-Яа-яЁё0-9]+)+$/.test(
      parameter.name,
    )
      ? parameter.name.split('_')
      : [parameter.name];
    let node = root;
    for (const part of parts) {
      if (!node.children.has(part)) node.children.set(part, { children: new Map() });
      node = node.children.get(part)!;
    }
    node.parameter = parameter;
  }
  return root;
}
export type ParameterSort = { by: 'name' | 'value'; descending: boolean };
export function sortedParameterChildren<T extends { name: string; value?: string | number }>(
  node: ParameterNode<T>,
  sort?: ParameterSort,
): [string, ParameterNode<T>][] {
  const entries = Array.from(node.children.entries());
  if (!sort) return entries;
  return entries.sort(([a, left], [b, right]) => {
    const aGroup = left.children.size > 0 && !left.parameter;
    const bGroup = right.children.size > 0 && !right.parameter;
    if (aGroup !== bGroup) return aGroup ? -1 : 1;
    if (sort.by === 'value' && !aGroup && !bGroup) {
      const number = (item: ParameterNode<T>) => {
        const value = item.parameter?.value;
        const match = String(value ?? '').match(
          /^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)(?:\s|$)/,
        );
        return match ? Number(match[1]) : NaN;
      };
      const x = number(left),
        y = number(right);
      if (Number.isFinite(x) !== Number.isFinite(y)) return Number.isFinite(x) ? -1 : 1;
      if (Number.isFinite(x) && x !== y) return (x - y) * (sort.descending ? -1 : 1);
    }
    return (
      a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }) *
      (sort.descending ? -1 : 1)
    );
  });
}
