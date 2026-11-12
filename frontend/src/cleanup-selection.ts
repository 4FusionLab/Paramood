import type { CleanupItem } from './bridge';

/** Keeping a candidate also keeps every input needed by its expression. */
export function updateCleanupSelection(
  items: CleanupItem[],
  name: string,
  selected: boolean,
): CleanupItem[] {
  const next = items.map((item) => (item.name === name ? { ...item, selected } : { ...item }));
  const byName = new Map(next.map((item) => [item.name, item]));
  const keep = next.filter((item) => !item.selected || item.protected || item.favorite);
  const visited = new Set<string>();
  while (keep.length) {
    const item = keep.pop()!;
    if (visited.has(item.name)) continue;
    visited.add(item.name);
    item.selected = false;
    for (const dependency of item.dependencies) {
      const input = byName.get(dependency);
      if (input) keep.push(input);
    }
  }
  return next;
}

export function keptDependencyOwner(items: CleanupItem[], target: string): string | undefined {
  const byName = new Map(items.map((item) => [item.name, item]));
  for (const item of items) {
    if (item.selected && !item.protected && !item.favorite) continue;
    const stack = [...item.dependencies];
    const visited = new Set<string>();
    while (stack.length) {
      const name = stack.pop()!;
      if (name === target) return item.name;
      if (visited.has(name)) continue;
      visited.add(name);
      stack.push(...(byName.get(name)?.dependencies ?? []));
    }
  }
}
