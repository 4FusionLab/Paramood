import { useEffect, useRef, useState } from 'preact/hooks';
import { Check, ChevronDown, Pencil, Plus, Search } from 'lucide-preact';
import type { ModelState, Variant } from './bridge';
import { VariantTable } from './variant-table';

type Action = 'variants.table.save' | 'variants.apply' | 'variants.free' | 'variants.delete';
type Props = {
  model: ModelState;
  disabled: boolean;
  error?: string;
  onAction: (action: Action, payload: Record<string, unknown>) => Promise<boolean>;
};
export function VariantsControl({ model, disabled, error, onAction }: Props) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [editor, setEditor] = useState<{ create: boolean; initialId?: string } | null>(null);
  const [menuPosition, setMenuPosition] = useState({
    left: 12,
    top: 38,
    width: 300,
    maxHeight: 400,
  });
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const variants = model.variants || [];
  const active = variants.find((variant) => variant.id === model.activeVariantId);
  const unavailable = disabled || !!model.variantsError || !model.variantSnapshotToken;
  const tokens = { variantsToken: model.variantsToken, snapshotToken: model.variantSnapshotToken };
  function positionMenu() {
    const bounds = trigger.current?.getBoundingClientRect();
    if (!bounds) return;
    const width = Math.min(360, window.innerWidth - 24),
      top = bounds.bottom + 6;
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
    setOpen(false);
    setEditor(null);
  }, [model.documentId]);
  function edit(variant?: Variant) {
    setOpen(false);
    setEditor({ create: !variant, initialId: variant?.id });
  }
  function closeEditor() {
    setEditor(null);
    trigger.current?.focus();
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
                  disabled={
                    disabled ||
                    variant.parameters.some((parameter) => parameter.missing) ||
                    variant.features?.some((feature) => feature.missing)
                  }
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
                      {variant.parameters.some((parameter) => parameter.missing) ||
                      variant.features?.some((feature) => feature.missing)
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
      {editor && (
        <VariantTable
          model={model}
          create={editor.create}
          initialId={editor.initialId}
          disabled={disabled}
          error={error}
          onClose={closeEditor}
          onSave={(payload) => onAction('variants.table.save', payload)}
        />
      )}
    </div>
  );
}
