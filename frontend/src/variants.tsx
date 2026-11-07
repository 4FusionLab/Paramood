import { useEffect, useRef, useState } from 'preact/hooks';
import { Check, ChevronDown, Pencil, Plus, Search, Trash2, X } from 'lucide-preact';
import type { ModelState, Variant, VariantParameter } from './bridge';
import { VariantParameterTree } from './variant-parameter-tree';
import { ExpressionEditor } from './editor';
import { parseVariantQuery } from './variant-query';

type Action = 'variants.save' | 'variants.apply' | 'variants.free' | 'variants.delete';
type Props = {
  model: ModelState;
  disabled: boolean;
  error?: string;
  onAction: (action: Action, payload: Record<string, unknown>) => Promise<boolean>;
};
type Draft = {
  id?: string;
  name: string;
  parameters: VariantParameter[];
  variantsToken: string | undefined;
  snapshotToken: string | undefined;
};

export function VariantsControl({ model, disabled, error, onAction }: Props) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [parameterFilter, setParameterFilter] = useState('');
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [menuPosition, setMenuPosition] = useState({
    left: 12,
    top: 38,
    width: 300,
    maxHeight: 400,
  });
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const variants = model.variants || [];
  const active = variants.find((variant) => variant.id === model.activeVariantId);
  const unavailable = disabled || !!model.variantsError || !model.variantSnapshotToken;
  const tokens = { variantsToken: model.variantsToken, snapshotToken: model.variantSnapshotToken };

  function positionMenu() {
    const bounds = trigger.current?.getBoundingClientRect();
    if (!bounds) return;
    const width = Math.min(360, window.innerWidth - 24);
    const top = bounds.bottom + 6;
    setMenuPosition({
      left: Math.max(12, Math.min(bounds.right - width, window.innerWidth - width - 12)),
      top,
      width,
      maxHeight: Math.max(80, window.innerHeight - top - 8),
    });
  }

  useEffect(() => {
    if (!open) return;
    positionMenu();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', positionMenu);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', positionMenu);
    };
  }, [open]);
  useEffect(() => {
    if (draft) nameInput.current?.focus();
  }, [!!draft]);

  function closeEditor() {
    if (disabled) return;
    setDraft(null);
    setDeleting(false);
    trigger.current?.focus();
  }
  function edit(variant?: Variant) {
    setOpen(false);
    setParameterFilter('');
    setSelectedOnly(false);
    setDeleting(false);
    setDraft({
      ...(variant ? { id: variant.id } : {}),
      name: variant?.name || '',
      parameters: variant ? variant.parameters.map((parameter) => ({ ...parameter })) : [],
      ...tokens,
    });
  }
  async function select(variant?: Variant) {
    if (
      await onAction(variant ? 'variants.apply' : 'variants.free', { id: variant?.id, ...tokens })
    ) {
      setOpen(false);
      trigger.current?.focus();
    }
  }
  const matching = variants.filter((variant) =>
    variant.name.toLocaleLowerCase().includes(filter.toLocaleLowerCase()),
  );
  const nameExists =
    !!draft &&
    variants.some(
      (variant) =>
        variant.id !== draft.id &&
        variant.name.toLocaleLowerCase() === draft.name.trim().toLocaleLowerCase(),
    );
  const parameters = model.parameters.filter(
    (parameter) => !parameter.driven && parameter.entityToken,
  );
  // Resolve by name for the UI. The adapter validates actual Fusion entities by token before writing.
  const rows: (VariantParameter & { kind?: 'user' | 'model' })[] = parameters.map((parameter) => ({
    name: parameter.name,
    entityToken: parameter.entityToken!,
    expression: parameter.expression,
    unit: parameter.unit,
    value: parameter.value,
    missing: false,
    kind: parameter.kind,
  }));
  for (const parameter of draft?.parameters || []) {
    if (parameter.missing || !rows.some((row) => row.name === parameter.name)) {
      const replacement = rows.findIndex((row) => row.name === parameter.name);
      if (replacement !== -1) rows.splice(replacement, 1);
      rows.unshift({ ...parameter, missing: true, kind: undefined });
    }
  }
  const query = parseVariantQuery(parameterFilter, model.parameters);
  const visibleRows = rows.filter(
    (parameter) =>
      parameter.name.toLocaleLowerCase().includes(query.filter) &&
      (!selectedOnly || draft?.parameters.some((entry) => entry.name === parameter.name)),
  );
  function changeParameterQuery(text: string) {
    setParameterFilter(text);
    const result = parseVariantQuery(text, model.parameters);
    if (!result.assignment) return;
    const { parameter, expression } = result.assignment;
    setDraft((current) => {
      if (!current) return current;
      const entry: VariantParameter = {
        name: parameter.name,
        entityToken: parameter.entityToken!,
        unit: parameter.unit,
        expression,
        value: 0,
      };
      const exists = current.parameters.some((item) => item.name === parameter.name);
      return {
        ...current,
        parameters: exists
          ? current.parameters.map((item) => (item.name === parameter.name ? entry : item))
          : [...current.parameters, entry],
      };
    });
  }

  return (
    <div class="variants-control" ref={root}>
      <button
        ref={trigger}
        class={`variant-trigger ${active ? 'has-variant' : ''}`}
        aria-label={`Variants: ${active?.name || 'Free'}`}
        aria-expanded={open}
        aria-controls="variants-menu"
        disabled={unavailable}
        title={
          model.variantsError ||
          (active
            ? `Changes in Paramood update ${active.name} automatically`
            : 'Switch or manage variants')
        }
        onClick={() => {
          positionMenu();
          setOpen(!open);
          setFilter('');
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            positionMenu();
            event.preventDefault();
            setOpen(true);
            requestAnimationFrame(() =>
              root.current?.querySelector<HTMLButtonElement>('.variant-choice')?.focus(),
            );
          }
        }}
      >
        <span>{active?.name || 'Free'}</span>
        <ChevronDown size={13} />
      </button>
      {open && (
        <div
          id="variants-menu"
          class="variants-menu"
          style={menuPosition}
          aria-label="Variants"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setOpen(false);
              trigger.current?.focus();
            }
            if (
              ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) &&
              !(event.target instanceof HTMLInputElement)
            ) {
              event.preventDefault();
              const buttons = Array.from(
                root.current!.querySelectorAll<HTMLButtonElement>(
                  '.variants-menu button:not(:disabled)',
                ),
              );
              const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? buttons.length - 1
                    : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) %
                      buttons.length;
              buttons[next]?.focus();
            }
          }}
        >
          <div class="variant-menu-heading">Variants</div>
          {error && (
            <div class="variant-editor-error error" role="alert">
              {error}
            </div>
          )}
          <button
            class="variant-choice free-choice"
            aria-pressed={!active}
            disabled={disabled}
            onClick={() => void select()}
          >
            <span class="variant-check">{!active && <Check size={14} />}</span>
            <span>
              <strong>Free</strong>
              <small>Edit without updating a variant</small>
            </span>
          </button>
          {variants.length > 5 && (
            <label class="variant-search">
              <Search size={13} />
              <input
                aria-label="Find variant"
                placeholder="Find variant…"
                value={filter}
                onInput={(event) => setFilter(event.currentTarget.value)}
              />
            </label>
          )}
          <div class="variant-options">
            {matching.map((variant) => (
              <div class="variant-option" key={variant.id}>
                <button
                  class="variant-choice"
                  aria-pressed={variant.id === active?.id}
                  disabled={disabled || variant.parameters.some((parameter) => parameter.missing)}
                  onClick={() => void select(variant)}
                >
                  <span class="variant-check">
                    {variant.id === active?.id && <Check size={14} />}
                  </span>
                  <span>
                    <strong>{variant.name}</strong>
                    <small>
                      {variant.parameters.length} parameter
                      {variant.parameters.length === 1 ? '' : 's'}
                      {variant.parameters.some((parameter) => parameter.missing)
                        ? ' · Needs attention'
                        : ''}
                    </small>
                  </span>
                </button>
                <button
                  class="icon"
                  aria-label={`Edit ${variant.name}`}
                  title="Edit variant"
                  disabled={disabled}
                  onClick={() => edit(variant)}
                >
                  <Pencil size={13} />
                </button>
              </div>
            ))}
            {!variants.length && (
              <p class="variants-empty">
                Save parameter values as a variant to switch between model sizes or configurations.
              </p>
            )}
            {!!variants.length && !matching.length && (
              <p class="variants-empty">No matching variants.</p>
            )}
          </div>
          <button class="variant-create" disabled={disabled} onClick={() => edit()}>
            <Plus size={14} />
            Create variant
          </button>
        </div>
      )}
      {draft && (
        <div class="variant-backdrop">
          <div
            class="variant-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="variant-title"
            ref={dialog}
            onKeyDown={(event) => {
              if (event.defaultPrevented) return;
              if (event.key === 'Escape') {
                event.stopPropagation();
                closeEditor();
              }
              if (event.key === 'Tab') {
                const elements = Array.from(
                  dialog.current!.querySelectorAll<HTMLElement>(
                    'button:not(:disabled), input:not(:disabled), [contenteditable="true"]',
                  ),
                );
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
              <h2 id="variant-title">{draft.id ? 'Edit variant' : 'Create variant'}</h2>
              <button
                class="icon"
                aria-label="Close variant editor"
                disabled={disabled}
                onClick={closeEditor}
              >
                <X size={15} />
              </button>
            </div>
            <div class="variant-name-field">
              <label for="variant-name">Name</label>
              <input
                ref={nameInput}
                id="variant-name"
                value={draft.name}
                maxLength={120}
                placeholder="e.g. Compact"
                disabled={disabled}
                onInput={(event) => setDraft({ ...draft, name: event.currentTarget.value })}
                aria-invalid={nameExists}
              />
              {nameExists && (
                <span class="error" role="alert">
                  A variant with this name already exists.
                </span>
              )}
            </div>
            <div class="variant-parameters-heading">
              <strong>Parameters</strong>
              <button
                class={`variant-selected-filter ${selectedOnly ? 'active' : ''}`}
                aria-pressed={selectedOnly}
                onClick={() => setSelectedOnly(!selectedOnly)}
              >
                {draft.parameters.length} selected
              </button>
            </div>
            <div class="variant-query">
              <Search size={14} />
              <ExpressionEditor
                value={parameterFilter}
                onChange={changeParameterQuery}
                onSubmit={() => setParameterFilter('')}
                onCancel={() => (parameterFilter ? setParameterFilter('') : closeEditor())}
                parameters={model.parameters.filter(
                  (parameter) => !parameter.driven && !!parameter.entityToken,
                )}
                batch
                singleLine
                inline
                disabled={disabled}
                label="Find parameters for variant"
                hint="Find or set: box.width=30"
              />
            </div>
            {query.error && (
              <div class="variant-query-feedback error" role="status">
                {query.error}
              </div>
            )}
            {query.assignment && (
              <div class="variant-query-feedback" role="status">
                {query.assignment.parameter.name} selected · {query.assignment.expression}
                <span>Enter to clear search</span>
              </div>
            )}
            <div class="variant-parameter-list">
              <VariantParameterTree
                parameters={visibleRows}
                selected={draft.parameters}
                disabled={disabled}
                filtered={!!parameterFilter || selectedOnly}
                onChange={(parameters) => setDraft({ ...draft, parameters })}
              />
              {!visibleRows.length && (
                <p class="variants-empty">
                  {parameters.length
                    ? 'No matching parameters.'
                    : 'Add editable parameters to this model first.'}
                </p>
              )}
            </div>
            <p class="variant-editor-hint">
              Selected values are applied when you save. Removing a parameter here keeps it in the
              model.
            </p>
            {error && (
              <div class="variant-editor-error error" role="alert">
                {error}
                <button
                  disabled={disabled}
                  onClick={() => edit(variants.find((variant) => variant.id === draft.id))}
                >
                  Reload from model
                </button>
              </div>
            )}
            {deleting ? (
              <div class="variant-delete-confirm">
                <span>Delete “{draft.name}”? Model parameters will stay.</span>
                <button disabled={disabled} onClick={() => setDeleting(false)}>
                  Keep variant
                </button>
                <button
                  class="danger"
                  disabled={disabled}
                  onClick={async () => {
                    if (
                      await onAction('variants.delete', {
                        id: draft.id,
                        variantsToken: draft.variantsToken,
                        snapshotToken: draft.snapshotToken,
                      })
                    )
                      closeEditor();
                  }}
                >
                  Delete variant
                </button>
              </div>
            ) : (
              <div class="variant-dialog-footer">
                {draft.id && (
                  <button
                    class="icon variant-delete"
                    aria-label="Delete variant"
                    title="Delete variant"
                    disabled={disabled}
                    onClick={() => setDeleting(true)}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
                <button disabled={disabled} onClick={closeEditor}>
                  Cancel
                </button>
                <button
                  class="primary"
                  disabled={
                    disabled ||
                    !draft.name.trim() ||
                    nameExists ||
                    !draft.parameters.length ||
                    draft.parameters.some(
                      (parameter) => parameter.missing || !parameter.expression.trim(),
                    )
                  }
                  onClick={async () => {
                    if (
                      await onAction('variants.save', {
                        id: draft.id,
                        name: draft.name.trim(),
                        parameters: draft.parameters,
                        variantsToken: draft.variantsToken,
                        snapshotToken: draft.snapshotToken,
                      })
                    ) {
                      setDraft(null);
                      trigger.current?.focus();
                    }
                  }}
                >
                  {disabled ? 'Saving…' : 'Save & apply'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
