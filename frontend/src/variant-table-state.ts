import type { ModelState, Variant, VariantColumn } from './bridge';

export type TableRow = Omit<Variant, 'id'> & { id?: string; key: string };
export type TableDraft = { columns: VariantColumn[]; rows: TableRow[] };
export const columnKey = (column: VariantColumn) => `${column.kind}:${column.entityToken}`;

export function tableDraft(model: ModelState): TableDraft {
  const columns = model.variantColumns?.map((c) => ({ ...c })) ?? [];
  const rows = (model.variants ?? []).map((row) => ({
    ...row,
    key: row.id,
    parameters: row.parameters.map((p) => ({ ...p })),
    features: (row.features ?? []).map((f) => ({ ...f })),
  }));
  return { columns, rows };
}

export function newRow(model: ModelState, columns: VariantColumn[], name: string): TableRow {
  return {
    key: crypto.randomUUID(),
    name,
    parameters: columns.flatMap((c) => {
      if (c.kind !== 'parameter') return [];
      const p = model.parameters.find((p) => p.name === c.name && !p.driven && p.entityToken);
      return p && !c.missing
        ? [{ ...p, entityToken: c.entityToken, value: p.value, missing: false }]
        : [];
    }),
    features: columns.flatMap((c) => {
      if (c.kind !== 'feature') return [];
      const f = model.timelineFeatures?.find((f) => f.entityToken === c.entityToken);
      return f ? [{ ...f }] : [];
    }),
  };
}

/** A drop moves an existing member, never accepts data or identities from another window. */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from < 0 || to < 0 || from >= items.length || to >= items.length || from === to) return items;
  const result = [...items];
  result.splice(to, 0, result.splice(from, 1)[0]);
  return result;
}

export function tableProblem(draft: TableDraft): string | undefined {
  if (draft.rows.length && !draft.columns.length)
    return 'Select at least one parameter or feature.';
  const names = new Set<string>();
  for (const row of draft.rows) {
    const name = row.name.trim().toLocaleLowerCase();
    if (!name || row.name.trim().length > 120)
      return 'Enter a name for every variant (up to 120 characters).';
    if (names.has(name)) return 'Variant names must be unique.';
    names.add(name);
    for (const c of draft.columns) {
      if (c.missing)
        return `Missing from model: ${c.name}. Remove it from the configured set to continue.`;
      if (c.kind === 'parameter') {
        const p = row.parameters.find((p) => p.entityToken === c.entityToken);
        if (!p || !p.expression.trim() || p.missing) return `Fill ${row.name} / ${c.name}.`;
      } else {
        const f = row.features?.find((f) => f.entityToken === c.entityToken);
        if (!f || f.missing) return `Fill ${row.name} / ${c.name}.`;
      }
    }
  }
}

export function tablePayload(draft: TableDraft) {
  return {
    columns: draft.columns.map(({ kind, name, entityToken, unit }) => ({
      kind,
      name,
      entityToken,
      unit,
    })),
    variants: draft.rows.map((row) => ({
      id: row.id,
      name: row.name.trim(),
      parameters: draft.columns.flatMap((c) =>
        c.kind === 'parameter' ? row.parameters.filter((p) => p.entityToken === c.entityToken) : [],
      ),
      features: draft.columns.flatMap((c) =>
        c.kind === 'feature'
          ? (row.features ?? []).filter((f) => f.entityToken === c.entityToken)
          : [],
      ),
    })),
  };
}
