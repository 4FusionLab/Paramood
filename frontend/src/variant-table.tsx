import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Fragment } from 'preact';
import { GripVertical, Plus, X, Copy, Trash2 } from 'lucide-preact';
import {
  onTimelineSelection,
  request,
  type TimelineSelection,
  type ModelState,
  type VariantColumn,
} from './bridge';
import { VariantParameterTree } from './variant-parameter-tree';
import { ExpressionEditor } from './editor';
import { prepareInlineEdit } from './inline-edit';
import { hasAssignment } from './expression-syntax';
import type { Parameter } from './bridge';
import {
  columnKey,
  moveItem,
  newRow,
  tableDraft,
  tablePayload,
  tableProblem,
  type TableDraft,
  type TableRow,
} from './variant-table-state';

type Props = {
  model: ModelState;
  create: boolean;
  disabled: boolean;
  error?: string;
  onSave: (payload: Record<string, unknown>) => Promise<boolean>;
  onClose: () => void;
};
type Axis = 'rows' | 'columns';
type CellEdit = {
  rowKey: string;
  token: string;
  value: string;
  original: string;
  wasDirty: boolean;
};
type CellPreview = { expression: string; newParameters: Parameter[] };

function unusedName(rows: TableRow[], base = 'Variant') {
  let name = base,
    n = 2;
  while (rows.some((r) => r.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase()))
    name = `${base} ${n++}`;
  return name;
}

export function VariantTable({ model, create, disabled, error, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<TableDraft>(() => {
    const result = tableDraft(model);
    if (create) result.rows.push(newRow(model, result.columns, unusedName(result.rows)));
    return result;
  });
  const [dirty, setDirty] = useState(create);
  const [picker, setPicker] = useState(false);
  const [filter, setFilter] = useState('');
  const [renaming, setRenaming] = useState<string | undefined>(
    create ? draft.rows[draft.rows.length - 1]?.key : undefined,
  );
  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmReload, setConfirmReload] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [deleteKey, setDeleteKey] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [pickError, setPickError] = useState('');
  const [editingCell, setEditingState] = useState<CellEdit | null>(null);
  const editingRef = useRef<CellEdit | null>(null);
  const [cellError, setCellError] = useState('');
  const [cellBusy, setCellBusy] = useState(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const cellGeneration = useRef(0);
  const cellFlight = useRef<Promise<TableDraft | null> | null>(null);
  const originalName = useRef(create ? draft.rows[draft.rows.length - 1]?.name : '');
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    axis: Axis;
    index: number;
    pointerId: number;
    x: number;
    y: number;
    moved: boolean;
    target: number | null;
  } | null>(null);
  const pickGeneration = useRef(0);
  const tokens = useRef({
    variantsToken: model.variantsToken,
    snapshotToken: model.variantSnapshotToken,
  });
  const stale =
    tokens.current.variantsToken !== model.variantsToken ||
    tokens.current.snapshotToken !== model.variantSnapshotToken;
  const unavailable = disabled || stale;
  const problem = tableProblem(draft);
  const completionParameters = useMemo(() => {
    const row = draft.rows.find((r) => r.key === editingCell?.rowKey);
    return row ? cellParameters(row) : model.parameters;
  }, [model.parameters, draft.rows, draft.newParameters, editingCell?.rowKey]);

  useEffect(() => {
    const element = dialog.current!;
    const target = create
      ? element.querySelector<HTMLInputElement>('[aria-label="Variant name"]')
      : element.querySelector<HTMLButtonElement>('[aria-label="Close variant editor"]');
    (
      target ?? element.querySelector<HTMLButtonElement>('[aria-label="Close variant editor"]')
    )?.focus();
    return () => {
      cellGeneration.current++;
      pickGeneration.current++;
    };
  }, []);

  useEffect(() => {
    if (!picking || unavailable) return;
    return onTimelineSelection((selection) => addPickedFeatures(selection));
  }, [picking, unavailable, draft, model.documentId]);

  function addPickedFeatures(selection: TimelineSelection) {
    if (selection.documentId !== model.documentId || unavailable) return;
    setDraft((current) => {
      const added = selection.features.filter(
        (f) =>
          !current.columns.some((c) => c.kind === 'feature' && c.entityToken === f.entityToken),
      );
      if (!added.length) return current;
      setDirty(true);
      setAnnouncement(`Added ${added.map((f) => f.name).join(', ')} to the configured set.`);
      return {
        ...current,
        columns: [
          ...current.columns,
          ...added.map((f) => ({
            kind: 'feature' as const,
            name: f.name,
            entityToken: f.entityToken,
          })),
        ],
        rows: current.rows.map((r) => ({
          ...r,
          features: [...(r.features ?? []), ...added.map((f) => ({ ...f }))],
        })),
      };
    });
  }
  function stopPicking() {
    pickGeneration.current++;
    setPicking(false);
  }
  async function togglePicking() {
    const generation = ++pickGeneration.current;
    if (picking) {
      stopPicking();
      return;
    }
    setPickError('');
    setPicking(true);
    try {
      const selection = await request<TimelineSelection>(
        'variants.selection.get',
        {},
        model.documentId!,
      );
      if (generation === pickGeneration.current) addPickedFeatures(selection);
    } catch (error) {
      if (generation === pickGeneration.current) {
        setPickError(error instanceof Error ? error.message : String(error));
        stopPicking();
      }
    }
  }
  function afterCell(action: (current: TableDraft) => void) {
    if (!editingRef.current && !cellFlight.current) action(draftRef.current);
    else
      void commitCell().then((current) => {
        if (current) action(current);
      });
  }
  function addVariant() {
    afterCell((current) => {
      const added = newRow(model, current.columns, unusedName(current.rows));
      change({ ...current, rows: [...current.rows, added] });
      originalName.current = added.name;
      setRenaming(added.key);
    });
  }
  function duplicateVariant(source: TableRow) {
    afterCell((current) => {
      const row = current.rows.find((r) => r.key === source.key);
      if (!row) return;
      const added = {
        ...row,
        id: undefined,
        key: crypto.randomUUID(),
        name: unusedName(current.rows, `${row.name} copy`),
        parameters: row.parameters.map((p) => ({ ...p })),
        features: row.features?.map((f) => ({ ...f })),
      };
      change({ ...current, rows: [...current.rows, added] });
      originalName.current = added.name;
      setRenaming(added.key);
    });
  }

  function change(next: TableDraft) {
    draftRef.current = next;
    setDraft(next);
    setDirty(true);
  }
  function setEditingCell(next: CellEdit | null) {
    editingRef.current = next;
    setEditingState(next);
  }
  function cellParameters(row: TableRow): Parameter[] {
    return [...model.parameters, ...(draft.newParameters ?? [])].map((parameter) => {
      const cell = row.parameters.find((p) => p.name === parameter.name);
      return cell
        ? {
            ...parameter,
            expression: cell.expression,
            value: cell.unit === 'Text' ? cell.value : cell.expression,
            valueExpression: cell.expression,
          }
        : parameter;
    });
  }
  async function commitCell(): Promise<TableDraft | null> {
    if (cellFlight.current) return cellFlight.current;
    const edit = editingRef.current;
    if (!edit) return draftRef.current;
    if (edit.value === edit.original) {
      setEditingCell(null);
      return draftRef.current;
    }
    const row = draftRef.current.rows.find((r) => r.key === edit.rowKey);
    const parameter = row?.parameters.find((p) => p.entityToken === edit.token);
    if (!row || !parameter) return null;
    const generation = ++cellGeneration.current;
    const promise = Promise.resolve().then(async () => {
      setCellBusy(true);
      setCellError('');
      try {
        const parameters = cellParameters(row);
        const target = parameters.find((p) => p.name === parameter.name)!;
        const prepared = prepareInlineEdit(target, edit.value, parameters);
        const result = await request<CellPreview>(
          'variants.cell.preview',
          {
            target: parameter.name,
            parameters: row.parameters,
            text: prepared.text,
            ...(prepared.equation ? { inlineEquation: prepared.equation } : {}),
            ...(prepared.sourceValueExpression ? { sourceName: parameter.name } : {}),
            newParameters: draftRef.current.newParameters,
            ...tokens.current,
          },
          model.documentId!,
        );
        if (generation !== cellGeneration.current) return null;
        const current = draftRef.current;
        if (
          !current.rows.some(
            (r) => r.key === row.key && r.parameters.some((p) => p.entityToken === edit.token),
          )
        ) {
          setEditingCell(null);
          return current;
        }
        const next = {
          ...current,
          newParameters: [...(current.newParameters ?? []), ...result.newParameters],
          rows: current.rows.map((r) =>
            r.key !== row.key
              ? r
              : {
                  ...r,
                  parameters: r.parameters.map((p) =>
                    p.entityToken !== edit.token ? p : { ...p, expression: result.expression },
                  ),
                },
          ),
        };
        change(next);
        draftRef.current = next;
        setEditingCell(null);
        return next;
      } catch (error) {
        if (generation === cellGeneration.current)
          setCellError(error instanceof Error ? error.message : String(error));
        return null;
      } finally {
        setCellBusy(false);
        cellFlight.current = null;
      }
    });
    cellFlight.current = promise;
    return promise;
  }
  function close() {
    if (!disabled) {
      if (dirty) setConfirmClose(true);
      else onClose();
    }
  }
  function beginCell(row: TableRow, column: VariantColumn) {
    const open = (current: TableDraft) => {
      const parameter = current.rows
        .find((r) => r.key === row.key)
        ?.parameters.find((p) => p.entityToken === column.entityToken);
      if (!parameter) return;
      setCellError('');
      setEditingCell({
        rowKey: row.key,
        token: column.entityToken,
        value: parameter.expression,
        original: parameter.expression,
        wasDirty: dirty,
      });
    };
    if (editingRef.current || cellFlight.current)
      void commitCell().then((current) => {
        if (current) open(current);
      });
    else open(draftRef.current);
  }
  function reload() {
    setDraft(tableDraft(model));
    tokens.current = {
      variantsToken: model.variantsToken,
      snapshotToken: model.variantSnapshotToken,
    };
    setDirty(false);
    setConfirmReload(false);
    setRenaming(undefined);
    stopPicking();
    setDeleteKey(null);
    cellGeneration.current++;
    setEditingCell(null);
    setCellError('');
  }
  function reorder(axis: Axis, from: number, to: number) {
    if (unavailable) return;
    if (axis === 'rows') change({ ...draft, rows: moveItem(draft.rows, from, to) });
    else change({ ...draft, columns: moveItem(draft.columns, from, to) });
    setAnnouncement(
      `${axis === 'rows' ? 'Variant' : 'Parameter or feature'} moved to position ${to + 1}.`,
    );
  }
  useLayoutEffect(() => {
    function cancelDrag() {
      drag.current = null;
      setDropTarget(null);
    }
    function track(event: PointerEvent) {
      const source = drag.current;
      if (!source || source.pointerId !== event.pointerId || unavailable) return;
      if (Math.hypot(event.clientX - source.x, event.clientY - source.y) < 4 && !source.moved)
        return;
      source.moved = true;
      event.preventDefault();
      const scroller = dialog.current?.querySelector<HTMLElement>('.variant-table-scroll');
      if (scroller) {
        const bounds = scroller.getBoundingClientRect();
        if (source.axis === 'columns') {
          if (event.clientX > bounds.right - 28) scroller.scrollLeft += 24;
          else if (event.clientX < bounds.left + 28) scroller.scrollLeft -= 24;
        } else {
          if (event.clientY > bounds.bottom - 28) scroller.scrollTop += 24;
          else if (event.clientY < bounds.top + 28) scroller.scrollTop -= 24;
        }
      }
      // Pointer capture retargets events to the handle. Hit-test the actual position instead.
      const hit = document.elementFromPoint(event.clientX, event.clientY);
      const target = hit?.closest<HTMLElement>(`[data-reorder-${source.axis}]`);
      source.target =
        target && dialog.current?.contains(target)
          ? Number(target.getAttribute(`data-reorder-${source.axis}`))
          : null;
      setDropTarget(source.target === null ? null : `${source.axis}:${source.target}`);
    }
    function finish(event: PointerEvent) {
      const source = drag.current;
      if (!source || source.pointerId !== event.pointerId) return;
      track(event);
      cancelDrag();
      if (source.moved && source.target !== null && !unavailable)
        reorder(source.axis, source.index, source.target);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape' && drag.current) {
        event.preventDefault();
        event.stopImmediatePropagation();
        cancelDrag();
      }
    }
    window.addEventListener('pointermove', track, { passive: false });
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', cancelDrag);
    window.addEventListener('lostpointercapture', cancelDrag);
    window.addEventListener('blur', cancelDrag);
    window.addEventListener('keydown', escape, true);
    return () => {
      window.removeEventListener('pointermove', track);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', cancelDrag);
      window.removeEventListener('lostpointercapture', cancelDrag);
      window.removeEventListener('blur', cancelDrag);
      window.removeEventListener('keydown', escape, true);
      drag.current = null;
    };
  }, [unavailable, draft]);
  function dropProps(axis: Axis, index: number) {
    return {
      [`data-reorder-${axis}`]: index,
      class: dropTarget === `${axis}:${index}` ? 'table-drop-target' : '',
    };
  }
  function handle(axis: Axis, index: number, name: string) {
    return (
      <button
        type="button"
        class="table-drag-handle"
        draggable={false}
        disabled={unavailable}
        aria-label={`Reorder ${name}`}
        title="Drag to reorder; Alt + arrow keys to move"
        onDragStart={(event) => event.preventDefault()}
        onPointerDown={(event) => {
          if (unavailable || event.button !== 0 || event.isPrimary === false) return;
          event.preventDefault();
          drag.current = {
            axis,
            index,
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            moved: false,
            target: null,
          };
          event.currentTarget.setPointerCapture?.(event.pointerId);
        }}
        onKeyDown={(event) => {
          if (
            !event.altKey ||
            !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)
          )
            return;
          event.preventDefault();
          const next = index + (['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 1);
          const count = axis === 'rows' ? draft.rows.length : draft.columns.length;
          if (next >= 0 && next < count) reorder(axis, index, next);
        }}
      >
        <GripVertical size={12} />
      </button>
    );
  }
  function cell(r: TableRow, column: VariantColumn) {
    const parameter = r.parameters.find((p) => p.entityToken === column.entityToken);
    const feature = r.features?.find((f) => f.entityToken === column.entityToken);
    const missingCell = column.kind === 'parameter' ? !parameter : !feature;
    return (
      <td
        key={`${r.key}:${columnKey(column)}`}
        class={column.kind === 'feature' ? 'variant-feature-cell' : ''}
      >
        {column.missing || parameter?.missing || feature?.missing ? (
          <span class="error">Missing from model</span>
        ) : missingCell ? (
          <span class="error">Unavailable</span>
        ) : column.kind === 'parameter' ? (
          editingCell?.rowKey === r.key && editingCell.token === column.entityToken ? (
            <ExpressionEditor
              inline
              autoFocus
              floatingTooltips
              singleLine
              label={`${r.name} / ${column.name}`}
              hint="Expression"
              parameters={completionParameters}
              currentTarget={column.name}
              batch={hasAssignment(editingCell.value)}
              value={editingCell.value}
              disabled={unavailable || cellBusy}
              onChange={(value) => {
                setEditingCell({ ...editingCell, value });
                setDirty(true);
                setCellError('');
              }}
              onSubmit={() => void commitCell()}
              onBlur={() => void commitCell()}
              onCancel={() => {
                cellGeneration.current++;
                setDirty(editingCell.wasDirty);
                setEditingCell(null);
                setCellError('');
              }}
            />
          ) : (
            <button
              class="variant-cell-value"
              aria-label={`${r.name} / ${column.name}`}
              title={parameter!.expression}
              disabled={unavailable}
              onClick={() => beginCell(r, column)}
            >
              {parameter!.expression}
            </button>
          )
        ) : (
          <input
            type="checkbox"
            aria-label={`${r.name} / ${column.name} enabled`}
            checked={feature!.enabled}
            disabled={unavailable}
            title={feature!.enabled ? 'Enabled' : 'Suppressed'}
            onChange={(event) => {
              const enabled = event.currentTarget.checked;
              change({
                ...draft,
                rows: draft.rows.map((item) =>
                  item.key !== r.key
                    ? item
                    : {
                        ...item,
                        features: item.features!.map((f) =>
                          f.entityToken === column.entityToken ? { ...f, enabled } : f,
                        ),
                      },
                ),
              });
            }}
          />
        )}
      </td>
    );
  }
  function variantHeader(r: TableRow, index: number) {
    return (
      <div class="variant-row-heading">
        {renaming === r.key ? (
          <input
            aria-label="Variant name"
            maxLength={120}
            disabled={unavailable}
            value={r.name}
            ref={(element) => {
              if (element && document.activeElement !== element) {
                element.focus();
                element.select();
              }
            }}
            onInput={(event) => {
              const name = event.currentTarget.value;
              change({
                ...draft,
                rows: draft.rows.map((row) => (row.key === r.key ? { ...row, name } : row)),
              });
            }}
            onBlur={() => setRenaming(undefined)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                event.stopPropagation();
                setRenaming(undefined);
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                change({
                  ...draft,
                  rows: draft.rows.map((row) =>
                    row.key === r.key ? { ...row, name: originalName.current } : row,
                  ),
                });
                setRenaming(undefined);
              }
            }}
          />
        ) : (
          <button
            class="variant-table-name"
            title="Click to rename"
            disabled={unavailable}
            aria-label={`Rename ${r.name}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() =>
              afterCell(() => {
                originalName.current = r.name;
                setRenaming(r.key);
              })
            }
          >
            {r.name || 'Unnamed variant'}
          </button>
        )}
        {r.id && r.id === model.activeVariantId && (
          <small class="variant-active-label">Active</small>
        )}
        <div class="variant-row-actions">
          {handle('rows', index, r.name)}
          <button
            class="icon"
            title="Duplicate variant"
            aria-label={`Duplicate ${r.name}`}
            onMouseDown={(event) => event.preventDefault()}
            disabled={unavailable}
            onClick={() => duplicateVariant(r)}
          >
            <Copy size={12} />
          </button>
          <button
            class="icon"
            title="Delete variant"
            aria-label={`Delete ${r.name}`}
            onMouseDown={(event) => event.preventDefault()}
            disabled={unavailable}
            onClick={() =>
              afterCell(() => {
                setDeleteKey(r.key);
                stopPicking();
              })
            }
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    );
  }
  function columnHeader(column: VariantColumn, index: number) {
    return (
      <div class="variant-table-heading">
        {handle('columns', index, column.name)}
        <span title={column.name}>
          {column.name.split('_').map((part, index) => (
            <Fragment key={index}>
              {index > 0 && (
                <>
                  .<wbr />
                </>
              )}
              {part}
            </Fragment>
          ))}
          <small>{column.kind === 'feature' ? 'Enabled' : column.unit || 'Unitless'}</small>
        </span>
      </div>
    );
  }
  function toggleColumn(column: VariantColumn, selected: boolean) {
    if (selected) {
      const existing = draft.columns.find((c) => columnKey(c) === columnKey(column));
      if (existing) return;
      change({
        ...draft,
        columns: [...draft.columns, column],
        rows: draft.rows.map((r) => {
          const current = newRow(model, [column], r.name);
          return {
            ...r,
            parameters: [...r.parameters, ...current.parameters],
            features: [...(r.features ?? []), ...(current.features ?? [])],
          };
        }),
      });
    } else
      change({
        ...draft,
        columns: draft.columns.filter((c) => columnKey(c) !== columnKey(column)),
        rows: draft.rows.map((r) => ({
          ...r,
          parameters:
            column.kind === 'parameter'
              ? r.parameters.filter((p) => p.entityToken !== column.entityToken)
              : r.parameters,
          features:
            column.kind === 'feature'
              ? r.features?.filter((f) => f.entityToken !== column.entityToken)
              : r.features,
        })),
      });
  }
  const editable = model.parameters
    .filter((p) => !p.driven && p.entityToken)
    .map((p) => ({ ...p, entityToken: p.entityToken! }));
  const pickerRows = editable.filter((p) =>
    p.name.toLocaleLowerCase().includes(filter.replaceAll('.', '_').toLocaleLowerCase()),
  );
  const selected = draft.columns
    .filter((c) => c.kind === 'parameter')
    .map((c) => ({
      name: c.name,
      entityToken: c.entityToken,
      unit: c.unit ?? '',
      expression: '',
      value: 0,
      missing: c.missing,
    }));
  const missing = draft.columns.filter((c) => c.missing);

  return (
    <div class="variant-backdrop">
      <div
        ref={dialog}
        class="variant-dialog variant-table-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="variant-table-title"
        onKeyDown={(event) => {
          if (event.defaultPrevented) return;
          if (event.key === 'Escape') {
            event.stopPropagation();
            close();
          }
          if (event.key === 'Tab') {
            const elements = Array.from(
              dialog.current!.querySelectorAll<HTMLElement>(
                'button:not(:disabled),input:not(:disabled),select:not(:disabled),[contenteditable="true"]',
              ),
            ).filter((e) => !e.closest('[hidden]'));
            const first = elements[0],
              last = elements[elements.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <div class="variant-dialog-header">
          <h2 id="variant-table-title">Configure variants</h2>
          <button
            class="icon"
            aria-label="Close variant editor"
            onMouseDown={(event) => event.preventDefault()}
            onClick={close}
            disabled={disabled}
          >
            <X size={15} />
          </button>
        </div>
        <div class="variant-table-toolbar">
          <button
            aria-expanded={picker}
            disabled={unavailable}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => afterCell(() => setPicker(!picker))}
          >
            Configure · {draft.columns.length}
          </button>
          <span>{draft.rows.length} variants</span>
        </div>
        {picker && (
          <section class="variant-table-picker" aria-label="Configured items for this model">
            <strong>Parameters and features for all variants</strong>
            <input
              type="search"
              aria-label="Find configured items"
              placeholder="Find parameter or feature…"
              value={filter}
              onInput={(event) => setFilter(event.currentTarget.value)}
            />
            <VariantParameterTree
              parameters={pickerRows}
              selected={selected}
              selectionOnly
              disabled={unavailable}
              filtered={!!filter}
              onChange={(items) => {
                const added = items.find((p) => !selected.some((s) => s.name === p.name));
                const removed = selected.find((p) => !items.some((s) => s.name === p.name));
                if (added)
                  toggleColumn(
                    {
                      kind: 'parameter',
                      name: added.name,
                      entityToken: added.entityToken,
                      unit: added.unit,
                    },
                    true,
                  );
                if (removed)
                  toggleColumn(
                    draft.columns.find((c) => c.kind === 'parameter' && c.name === removed.name)!,
                    false,
                  );
              }}
            />
            <strong class="table-feature-heading">Timeline features</strong>
            <button
              disabled={unavailable}
              aria-pressed={picking}
              onClick={() => void togglePicking()}
            >
              {picking ? 'Done picking' : 'Pick from timeline'}
            </button>
            {picking && (
              <p class="variant-editor-hint">
                Click features in the Fusion timeline to add them. Nothing is applied until Save.
              </p>
            )}
            {pickError && (
              <p class="error" role="alert">
                {pickError}
              </p>
            )}
            {(model.timelineFeatures ?? [])
              .filter((f) => f.name.toLocaleLowerCase().includes(filter.toLocaleLowerCase()))
              .map((f) => (
                <label class="table-feature-option" key={f.entityToken}>
                  <input
                    type="checkbox"
                    aria-label={`Include feature ${f.name}`}
                    checked={draft.columns.some(
                      (c) => c.kind === 'feature' && c.entityToken === f.entityToken,
                    )}
                    disabled={unavailable}
                    onChange={(event) =>
                      toggleColumn(
                        { kind: 'feature', name: f.name, entityToken: f.entityToken },
                        event.currentTarget.checked,
                      )
                    }
                  />
                  {f.name}
                </label>
              ))}
            {!model.timelineFeatures?.length && (
              <p class="variant-editor-hint">No supported parametric features in the timeline.</p>
            )}
            {missing.map((c) => (
              <div class="table-feature-option" key={columnKey(c)}>
                <span class="error">Missing: {c.name}</span>
                <button disabled={unavailable} onClick={() => toggleColumn(c, false)}>
                  Remove from set
                </button>
              </div>
            ))}
            <p class="variant-editor-hint">
              New items use current model values for all variants. Removing an item keeps it in the
              model.
            </p>
            <button
              onClick={() => {
                setPicker(false);
                stopPicking();
              }}
            >
              Done
            </button>
          </section>
        )}
        {stale && (
          <div class="variant-editor-error error" role="alert">
            The model changed. Your draft is preserved.{' '}
            <button disabled={disabled} onClick={() => (dirty ? setConfirmReload(true) : reload())}>
              Reload from model
            </button>
          </div>
        )}
        {confirmReload && (
          <div class="variant-delete-confirm">
            <span>Replace your unsaved table with the current model data?</span>
            <button onClick={() => setConfirmReload(false)}>Keep editing</button>
            <button onClick={reload}>Replace draft</button>
          </div>
        )}
        {!draft.columns.length && (
          <p class="variants-empty">
            Choose the parameters and timeline features this model will configure.
          </p>
        )}
        <div class="variant-table-scroll">
          <table
            class="variant-config-table"
            data-headings="wrapped"
            style={{
              minWidth: `calc(var(--variant-name-width) + ${draft.columns.length} * var(--variant-cell-width))`,
            }}
          >
            <thead>
              <tr>
                <th scope="col">Variant</th>
                {draft.columns.map((column, index) => (
                  <th scope="col" key={columnKey(column)} {...dropProps('columns', index)}>
                    {columnHeader(column, index)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {draft.rows.map((r, index) => (
                <Fragment key={r.key}>
                  <tr data-variant-id={r.id ?? r.key} {...dropProps('rows', index)}>
                    <th scope="row">{variantHeader(r, index)}</th>
                    {draft.columns.map((column) => cell(r, column))}
                  </tr>
                  {deleteKey === r.key && (
                    <tr class="variant-delete-row">
                      <td colSpan={draft.columns.length + 1}>
                        <div role="alert" class="variant-inline-confirm">
                          <span>Delete “{r.name}”? Model parameters and features will stay.</span>
                          <button onClick={() => setDeleteKey(null)} disabled={disabled}>
                            Keep variant
                          </button>
                          <button
                            class="danger"
                            disabled={unavailable}
                            onClick={() => {
                              change({
                                ...draft,
                                rows: draft.rows.filter((row) => row.key !== r.key),
                              });
                              setDeleteKey(null);
                            }}
                          >
                            Delete variant
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              <tr class="variant-add-row">
                <td colSpan={draft.columns.length + 1}>
                  <button
                    disabled={unavailable}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={addVariant}
                  >
                    <Plus size={13} /> Add variant
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="variant-editor-hint">
          Features: checked = Enabled · unchecked = Suppressed. Drag handles to reorder.
        </p>
        {problem && (
          <div class="variant-query-feedback" role="status">
            {problem}
          </div>
        )}
        {error && (
          <div class="variant-editor-error error" role="alert">
            {error}
          </div>
        )}
        {cellError && (
          <div class="variant-editor-error error" role="alert">
            {cellError}
          </div>
        )}
        {!!draft.newParameters?.length && (
          <p class="variant-editor-hint">
            New global parameters will be created on Save:{' '}
            {draft.newParameters.map((p) => p.name).join(', ')}.
          </p>
        )}
        <div class="sr-only" role="status" aria-live="polite">
          {announcement}
        </div>
        {confirmClose && (
          <div class="variant-delete-confirm">
            <span>Discard unsaved table changes?</span>
            <button onClick={() => setConfirmClose(false)}>Keep editing</button>
            <button onClick={onClose}>Discard changes</button>
          </div>
        )}
        <div class="variant-dialog-footer">
          <span>{dirty ? 'Unsaved changes' : 'All changes saved'}</span>
          <button
            disabled={disabled}
            onMouseDown={(event) => event.preventDefault()}
            onClick={close}
          >
            Cancel
          </button>
          <button
            class="primary"
            disabled={unavailable || !dirty || !!problem}
            onMouseDown={(event) => event.preventDefault()}
            onClick={async () => {
              const current = await commitCell();
              if (current && (await onSave({ ...tablePayload(current), ...tokens.current })))
                onClose();
            }}
          >
            {disabled ? 'Saving…' : 'Save'}
          </button>
        </div>
        <p class="variant-editor-hint">
          Save applies changes to the active variant. Other variants are saved without switching.
        </p>
      </div>
    </div>
  );
}
