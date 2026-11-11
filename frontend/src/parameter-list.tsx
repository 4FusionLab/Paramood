import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import {
  ChevronDown,
  ChevronRight,
  Link2,
  X,
  DraftingCompass,
  Shapes,
  ArrowDownAZ,
  ArrowUpAZ,
  Star,
  ChevronsDownUp,
  ChevronsUpDown,
  Table2,
} from 'lucide-preact';
import type { Parameter } from './bridge';

export function expressionWithoutUnit(parameter: Parameter): string {
  if (parameter.valueType === 'text' || parameter.unit === 'Text') return parameter.expression;
  const match = parameter.expression
    .trim()
    .match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*([A-Za-z]+)$/);
  if (!match) return parameter.expression;
  if (match[2] === parameter.unit) return match[1];
  if (match[2] === 'rad' && parameter.unit === 'deg')
    return String(Number(((Number(match[1]) * 180) / Math.PI).toPrecision(15)));
  if (match[2] === 'deg' && parameter.unit === 'rad')
    return String(Number(((Number(match[1]) * Math.PI) / 180).toPrecision(15)));
  return parameter.expression;
}
function displayValue(parameter: Parameter): string {
  const text = String(parameter.value);
  const suffix = parameter.unit && parameter.unit !== 'Text' ? ` ${parameter.unit}` : '';
  return suffix && text.endsWith(suffix) ? text.slice(0, -suffix.length) : text;
}
import {
  parameterTree as tree,
  sortedParameterChildren as sortedChildren,
  type ParameterNode,
  type ParameterSort as Sort,
} from './parameter-tree';
type Node = ParameterNode<Parameter>;
function Branch({
  name,
  node,
  path,
  onEdit,
  onDelete,
  onRename,
  editingName,
  editor,
  sort,
  onFavorite,
  busy,
  expansion,
}: {
  name: string;
  sort?: Sort;
  onFavorite?: (parameter: Parameter) => void;
  busy?: boolean;
  expansion: { open: boolean; version: number };
  node: Node;
  path: string;
  onEdit: (parameter: Parameter) => void;
  onDelete: (parameter: Parameter) => void;
  onRename?: (parameter: Parameter, name: string) => Promise<boolean>;
  editingName?: string;
  editor?: ComponentChildren;
}) {
  const [open, setOpen] = useState(expansion.open);
  useEffect(() => setOpen(expansion.open), [expansion.version]);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState('');
  const parameter = node.parameter;
  return (
    <div class="tree-node">
      <div class="tree-row" data-parameter-name={parameter?.name}>
        {node.children.size > 0 ? (
          <button
            class="icon tree-toggle"
            aria-label={`${open ? 'Collapse' : 'Expand'} ${path}`}
            onClick={() => setOpen(!open)}
          >
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : (
          <span class="tree-spacer" />
        )}
        {parameter && onFavorite && (
          <button
            class={`icon favorite ${parameter.favorite ? 'is-favorite' : ''}`}
            disabled={busy || typeof parameter.favorite !== 'boolean'}
            aria-label={`${parameter.favorite ? 'Remove from' : 'Add to'} featured ${parameter.name}`}
            aria-pressed={!!parameter.favorite}
            title={parameter.favorite ? 'Remove from featured' : 'Add to featured'}
            onClick={() => onFavorite(parameter)}
          >
            <Star size={14} fill={parameter.favorite ? 'currentColor' : 'none'} />
          </button>
        )}
        {renaming && parameter ? (
          <input
            class="tree-name"
            autoFocus
            aria-label={`Rename ${parameter.name}`}
            value={newName}
            onInput={(event) => setNewName(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setRenaming(false);
              if (event.key === 'Enter') {
                event.preventDefault();
                void onRename?.(parameter, newName.trim()).then((ok) => {
                  if (ok) setRenaming(false);
                });
              }
            }}
          />
        ) : parameter && !parameter.driven && onRename ? (
          <button
            class="tree-name tree-name-button"
            title={parameter.name}
            aria-label={`Rename ${parameter.name}`}
            onClick={() => {
              setNewName(parameter.name);
              setRenaming(true);
            }}
          >
            {name}
          </button>
        ) : (
          <span class="tree-name" title={parameter?.name || path}>
            {name}
          </span>
        )}
        {parameter?.configured && (
          <span
            class="configured-parameter"
            aria-label={`${parameter.name}: controlled by variants`}
            title="Controlled by variants"
          >
            <Table2 size={13} />
          </span>
        )}
        {parameter?.linked && (
          <span
            class="binding-icons"
            aria-label="Linked to model"
            title={parameter.bindings?.join(', ') || 'Used by model parameters'}
          >
            {parameter.bindings?.includes('sketch') && (
              <DraftingCompass size={13} aria-label="Used in sketch" />
            )}
            {parameter.bindings?.includes('feature') && (
              <Shapes size={13} aria-label="Used in feature" />
            )}
            {(!parameter.bindings ||
              parameter.bindings.some((item) => item === 'other' || item === 'unknown')) && (
              <Link2 size={13} aria-label="Other or unknown model link" />
            )}
          </span>
        )}
        {parameter && (
          <>
            {editingName === parameter.name ? (
              editor
            ) : parameter.driven ? (
              <span class="tree-value" title="Driven dimension (read-only)">
                ({displayValue(parameter)})
              </span>
            ) : (
              <button
                class="tree-value"
                title="Edit expression"
                aria-label={`Edit value ${parameter.name}`}
                onClick={() => onEdit(parameter)}
              >
                {displayValue(parameter)}
                {parameter.kind === 'model' &&
                !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?(?:\s*[A-Za-z]+)?$/.test(
                  parameter.expression.trim(),
                )
                  ? ` (${parameter.expression})`
                  : ''}
              </button>
            )}
            <span class="tree-unit">{parameter.unit === 'Text' ? '' : parameter.unit}</span>
            {!parameter.driven && (
              <button
                class="icon"
                aria-label={`Delete ${parameter.name}`}
                title="Delete parameter"
                onClick={() => onDelete(parameter)}
              >
                <X size={13} />
              </button>
            )}
          </>
        )}
      </div>
      {open && node.children.size > 0 && (
        <div class="tree-children">
          {sortedChildren(node, sort).map(([child, value]) => (
            <Branch
              key={child}
              sort={sort}
              expansion={expansion}
              onFavorite={onFavorite}
              busy={busy}
              name={child}
              node={value}
              path={`${path}.${child}`}
              onEdit={onEdit}
              onDelete={onDelete}
              onRename={onRename}
              editingName={editingName}
              editor={editor}
            />
          ))}
        </div>
      )}
    </div>
  );
}
export function ParameterList({
  parameters,
  onEdit,
  onDelete,
  onRename,
  onFavorite,
  onCopyReference,
  busy,
  editingName,
  editor,
}: {
  parameters: Parameter[];
  onCopyReference?: (name: string) => void;
  onFavorite?: (parameter: Parameter) => void;
  busy?: boolean;
  onEdit: (parameter: Parameter) => void;
  onDelete: (parameter: Parameter) => void;
  onRename?: (parameter: Parameter, name: string) => Promise<boolean>;
  editingName?: string;
  editor?: ComponentChildren;
}) {
  const [context, setContext] = useState<{ name: string; x: number; y: number } | null>(null);
  const menu = useRef<HTMLDivElement>(null);
  const origin = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!context || !menu.current) return;
    const element = menu.current;
    const bounds = element.getBoundingClientRect();
    element.style.left = `${Math.max(4, Math.min(context.x, innerWidth - bounds.width - 4))}px`;
    element.style.top = `${Math.max(4, Math.min(context.y, innerHeight - bounds.height - 4))}px`;
    element.querySelector('button')?.focus({ preventScroll: true });
    const close = () => setContext(null);
    const outside = (event: PointerEvent) => {
      if (!element.contains(event.target as globalThis.Node)) close();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        origin.current?.focus({ preventScroll: true });
      } else if (event.key === 'Tab') close();
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', key, true);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', key, true);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
    };
  }, [context]);
  useEffect(() => setContext(null), [parameters]);
  const [expansion, setExpansion] = useState({ open: false, version: 0 });
  const [featuredOpen, setFeaturedOpen] = useState(false);
  const [modelsOpen, setModelsOpen] = useState(false);
  useEffect(() => setModelsOpen(expansion.open), [expansion.version]);
  const [editInFeatured, setEditInFeatured] = useState(false);
  const [sortBy, setSortBy] = useState<'name' | 'value'>('name');
  const [descending, setDescending] = useState(false);
  const sort: Sort = { by: sortBy, descending };
  const featured = parameters.filter((p) => p.favorite);
  const users = tree(parameters.filter((p) => p.kind !== 'model' || !/^d\d+$/i.test(p.name)));
  const models = tree(parameters.filter((p) => p.kind === 'model' && /^d\d+$/i.test(p.name)));
  const renderNodes = (root: Node, order?: Sort) =>
    sortedChildren(root, order).map(([name, node]) => (
      <Branch
        key={name}
        sort={order}
        expansion={expansion}
        onFavorite={onFavorite}
        busy={busy}
        name={name}
        path={name}
        node={node}
        onEdit={(parameter) => {
          setEditInFeatured(false);
          onEdit(parameter);
        }}
        onDelete={onDelete}
        onRename={onRename}
        editingName={editInFeatured ? undefined : editingName}
        editor={editor}
      />
    ));
  return (
    <section
      class="parameter-list"
      aria-label="Parameters list"
      onContextMenu={(event) => {
        if (!(event.target instanceof Element)) return;
        if (event.target.closest('input, textarea, [contenteditable="true"]')) return;
        const row = event.target.closest<HTMLElement>('[data-parameter-name]');
        const name = row?.dataset.parameterName;
        if (!name || !row || !onCopyReference) return;
        event.preventDefault();
        origin.current = row.querySelector<HTMLElement>('button') || null;
        setContext({ name, x: event.clientX, y: event.clientY });
      }}
    >
      {context && (
        <div ref={menu} class="parameter-context-menu" role="menu" aria-label="Parameter actions">
          <button
            role="menuitem"
            onClick={() => {
              // Use the native name rather than the shortened label or dotted display path.
              onCopyReference?.(context.name);
              setContext(null);
              origin.current?.focus({ preventScroll: true });
            }}
          >
            Copy parameter reference
            <small>{context.name}</small>
          </button>
        </div>
      )}
      <div class="section-body">
        <div class="featured-parameters">
          <button
            class="featured-heading"
            aria-expanded={featuredOpen}
            onClick={() => setFeaturedOpen(!featuredOpen)}
          >
            {featuredOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Featured
            parameters ({featured.length})
          </button>
          {featuredOpen &&
            (featured.length ? (
              featured.map((parameter) => (
                <Branch
                  key={parameter.name}
                  name={parameter.name}
                  path={parameter.name}
                  node={{ children: new Map(), parameter }}
                  expansion={expansion}
                  onFavorite={onFavorite}
                  busy={busy}
                  onEdit={(item) => {
                    setEditInFeatured(true);
                    onEdit(item);
                  }}
                  onDelete={onDelete}
                  onRename={onRename}
                  editingName={editInFeatured ? editingName : undefined}
                  editor={editor}
                />
              ))
            ) : (
              <p class="helper">No featured parameters</p>
            ))}
        </div>
        <div class="parameter-list-header">
          <div class="minor-label">Named parameters</div>
          <button
            class="icon"
            aria-label="Expand all groups"
            title="Expand all groups"
            onClick={() => setExpansion((state) => ({ open: true, version: state.version + 1 }))}
          >
            <ChevronsUpDown size={15} />
          </button>
          <button
            class="icon"
            aria-label="Collapse all groups"
            title="Collapse all groups"
            onClick={() => setExpansion((state) => ({ open: false, version: state.version + 1 }))}
          >
            <ChevronsDownUp size={15} />
          </button>
          <select
            aria-label="Sort named parameters by"
            value={sortBy}
            onChange={(event) => setSortBy(event.currentTarget.value as 'name' | 'value')}
          >
            <option value="name">Name</option>
            <option value="value">Value</option>
          </select>
          <button
            class="icon sort-direction"
            aria-label={descending ? 'Sort ascending' : 'Sort descending'}
            title={descending ? 'Sort ascending' : 'Sort descending'}
            onClick={() => setDescending(!descending)}
          >
            {descending ? <ArrowUpAZ size={15} /> : <ArrowDownAZ size={15} />}
          </button>
        </div>
        {renderNodes(users, sort)}
        {!users.children.size && <p class="helper">No named parameters</p>}
        <div class="model-parameters">
          <button
            class="featured-heading"
            aria-expanded={modelsOpen}
            onClick={() => setModelsOpen(!modelsOpen)}
          >
            {modelsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Model parameters
          </button>
          {modelsOpen && renderNodes(models)}
          {modelsOpen && !models.children.size && <p class="helper">No model parameters</p>}
        </div>
      </div>
    </section>
  );
}
