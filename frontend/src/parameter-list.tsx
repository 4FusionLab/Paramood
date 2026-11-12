import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { createContext, type ComponentChildren } from 'preact';
import {
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
  Search,
} from 'lucide-preact';
import type { Parameter } from './bridge';
import { FindReferences } from './find-references';
import { Collapsible } from './collapsible';
import { AnimatedList, Presence } from './presence';
import { favoriteFeedback, useChangeMotion, valueHighlight } from './motion';
import { useParameterDrag } from './parameter-drag';
import { captureTreeScroll, parameterMatches, searchParameterTree } from './parameter-search';

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
type RenameSession = {
  active: symbol | null;
  open: (id: symbol) => void;
  close: (id: symbol) => void;
};
const RenameContext = createContext<RenameSession>({ active: null, open() {}, close() {} });

type Expansion = {
  open: boolean;
  states: Record<string, boolean>;
  toggle: (path: string, open: boolean) => void;
};
function Branch({
  name,
  node,
  path,
  onEdit,
  onDelete,
  onRename,
  onRenameGroup,
  editingName,
  editor,
  sort,
  onFavorite,
  documentId,
  busy,
  expansion,
  dropGroup,
  searching = false,
  animate = true,
}: {
  name: string;
  sort?: Sort;
  onFavorite?: (parameter: Parameter) => void;
  busy?: boolean;
  documentId?: string;
  expansion: Expansion;
  searching?: boolean;
  animate?: boolean;
  dropGroup?: string | null;
  node: Node;
  path: string;
  onEdit: (parameter: Parameter) => void;
  onDelete: (parameter: Parameter) => void;
  onRename?: (parameter: Parameter, name: string) => Promise<boolean>;
  onRenameGroup?: (group: string, newGroup: string) => Promise<boolean>;
  editingName?: string;
  editor?: ComponentChildren;
}) {
  const open = Object.prototype.hasOwnProperty.call(expansion.states, path)
    ? expansion.states[path]
    : expansion.open;
  const setOpen = (value: boolean) => expansion.toggle(path, value);
  const renameSession = useContext(RenameContext);
  const renameId = useRef(Symbol('rename'));
  const renameInput = useRef<HTMLInputElement>(null);
  const renaming = renameSession.active === renameId.current;
  const setRenaming = (active: boolean) =>
    active ? renameSession.open(renameId.current) : renameSession.close(renameId.current);
  useLayoutEffect(() => {
    if (renaming) renameInput.current?.focus({ preventScroll: true });
  }, [renaming]);
  const [newName, setNewName] = useState('');
  const parameter = node.parameter;
  const isGroup = node.isGroup ?? node.children.size > 0;
  const groupRename = isGroup && !!onRenameGroup;
  const renameLabel = groupRename ? `Rename group ${path}` : `Rename ${parameter?.name}`;
  const rename = () =>
    groupRename
      ? onRenameGroup!(path.replaceAll('.', '_'), newName.trim())
      : onRename!(parameter!, newName.trim());
  const changed = useChangeMotion(
    JSON.stringify([parameter?.value, parameter?.expression, parameter?.unit]),
    valueHighlight,
    650,
  );
  const favorite = useChangeMotion<HTMLButtonElement>(!!parameter?.favorite, favoriteFeedback, 220);
  const renderChild = ([child, value]: [string, Node]) => (
    <Branch
      key={child}
      name={child}
      node={value}
      path={`${path}.${child}`}
      sort={sort}
      expansion={expansion}
      searching={searching}
      animate={animate}
      documentId={documentId}
      onFavorite={onFavorite}
      busy={busy}
      dropGroup={dropGroup}
      onEdit={onEdit}
      onDelete={onDelete}
      onRename={onRename}
      onRenameGroup={onRenameGroup}
      editingName={editingName}
      editor={editor}
    />
  );
  return (
    <div class="tree-node">
      <div
        ref={changed}
        class={`tree-row ${isGroup && dropGroup === path ? 'parameter-drop-target' : ''}`}
        data-parameter-name={parameter?.name}
        data-parameter-group={isGroup ? path : undefined}
      >
        {node.children.size > 0 ? (
          <button
            class="icon tree-toggle"
            aria-label={`${open ? 'Collapse' : 'Expand'} ${path}`}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            <ChevronRight size={14} />
          </button>
        ) : (
          <span class="tree-spacer" />
        )}
        {parameter && onFavorite && (
          <button
            ref={favorite}
            class={`icon favorite ${parameter.favorite ? 'is-favorite' : ''}`}
            disabled={busy || typeof parameter.favorite !== 'boolean'}
            aria-label={`${parameter.favorite ? 'Remove from' : 'Add to'} favorites ${parameter.name}`}
            aria-pressed={!!parameter.favorite}
            title={parameter.favorite ? 'Remove from favorites' : 'Add to favorites'}
            onClick={() => onFavorite(parameter)}
          >
            <Star size={14} fill={parameter.favorite ? 'currentColor' : 'none'} />
          </button>
        )}
        {renaming ? (
          <input
            class="tree-name"
            ref={renameInput}
            aria-label={renameLabel}
            disabled={busy}
            value={newName}
            onBlur={() => setRenaming(false)}
            onInput={(event) => setNewName(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setRenaming(false);
              if (event.key === 'Enter') {
                event.preventDefault();
                void rename().then((ok) => {
                  if (ok) setRenaming(false);
                });
              }
            }}
          />
        ) : groupRename || (parameter && !parameter.driven && onRename) ? (
          <button
            class={`tree-name tree-name-button ${parameter?.unused ? 'parameter-unused' : ''}`}
            title={
              parameter?.unused
                ? `${parameter.name} — Unused parameter; click to rename`
                : groupRename
                  ? `${path} — Click to rename; drag to move group and nested parameters`
                  : `${parameter!.name} — Click to rename; drag into a group`
            }
            disabled={busy}
            draggable={false}
            onDragStart={(event) => event.preventDefault()}
            aria-label={renameLabel}
            onClick={() => {
              setNewName(groupRename ? path.replaceAll('.', '_') : parameter!.name);
              setRenaming(true);
            }}
          >
            {name}
          </button>
        ) : (
          <span
            class={`tree-name ${parameter?.unused ? 'parameter-unused' : ''}`}
            title={
              parameter?.unused ? `${parameter.name} — Unused parameter` : parameter?.name || path
            }
          >
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
            <span class="tree-unit">
              {parameter.unit === 'Text' ? 'Text' : parameter.unit || '—'}
            </span>
            {documentId && (
              <FindReferences parameter={parameter} documentId={documentId} disabled={busy} />
            )}
            {!parameter.driven && (
              <button
                class="icon parameter-delete"
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
      <Collapsible open={open && node.children.size > 0} class="tree-children" animate={animate}>
        <AnimatedList
          items={sortedChildren(node, sort)}
          itemKey={([child]) => child}
          animate={animate}
        >
          {renderChild}
        </AnimatedList>
      </Collapsible>
    </div>
  );
}
export function ParameterList({
  parameters,
  onEdit,
  onDelete,
  onRename,
  onRenameGroup,
  onFavorite,
  onCopyReference,
  onCleanup,
  documentId,
  busy,
  editingName,
  editor,
}: {
  parameters: Parameter[];
  onCopyReference?: (name: string) => void;
  onCleanup?: () => void;
  onFavorite?: (parameter: Parameter) => void;
  busy?: boolean;
  documentId?: string;
  onEdit: (parameter: Parameter) => void;
  onDelete: (parameter: Parameter) => void;
  onRename?: (parameter: Parameter, name: string) => Promise<boolean>;
  onRenameGroup?: (group: string, newGroup: string) => Promise<boolean>;
  editingName?: string;
  editor?: ComponentChildren;
}) {
  const [activeRename, setActiveRename] = useState<symbol | null>(null);
  const [context, setContext] = useState<{ name: string; x: number; y: number } | null>(null);
  const moving = useParameterDrag(parameters, onRename, busy, editor, onRenameGroup);
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
  const [normalExpansion, setNormalExpansion] = useState({
    open: false,
    states: {} as Record<string, boolean>,
  });
  const [searchExpansion, setSearchExpansion] = useState({
    open: true,
    states: {} as Record<string, boolean>,
  });
  useEffect(() => {
    if (!moving.revealGroup) return;
    // Reveal once per completed move, not again when a filtered branch remounts.
    const parts = moving.revealGroup.path.split('.');
    const states = Object.fromEntries(
      parts.map((_, index) => [parts.slice(0, index + 1).join('.'), true]),
    );
    for (const update of [setNormalExpansion, setSearchExpansion])
      update((state) => ({ ...state, states: { ...state.states, ...states } }));
  }, [moving.revealGroup]);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const searching = !!query.trim();
  const previousSearching = useRef(searching);
  // Filter changes must settle layout before restoring scroll. Keep the same keyed
  // wrappers, but skip height animations both during search and on its return render.
  const animate = !searching && !previousSearching.current;
  useLayoutEffect(() => {
    previousSearching.current = searching;
  }, [searching]);
  const restoreScroll = useRef<(() => void) | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  const closeSearch = () => {
    setQuery('');
    setSearchOpen(false);
    searchButton.current?.focus({ preventScroll: true });
  };
  useLayoutEffect(() => {
    if (searchOpen) searchInput.current?.focus({ preventScroll: true });
  }, [searchOpen]);
  const updateQuery = (value: string) => {
    if (!searching && value.trim()) {
      restoreScroll.current = captureTreeScroll(moving.root.current);
      setSearchExpansion({ open: true, states: {} });
    }
    setQuery(value);
  };
  useLayoutEffect(() => {
    if (!searching && restoreScroll.current) {
      const restore = restoreScroll.current;
      restoreScroll.current = null;
      restore();
      // Collapsible may mount its restored descendants in a synchronous follow-up render.
      const frame = requestAnimationFrame(restore);
      return () => cancelAnimationFrame(frame);
    }
  }, [searching]);
  const setExpansion = searching ? setSearchExpansion : setNormalExpansion;
  const currentExpansion = searching ? searchExpansion : normalExpansion;
  const expansion: Expansion = {
    ...currentExpansion,
    toggle: (path, open) =>
      setExpansion((state) => ({ ...state, states: { ...state.states, [path]: open } })),
  };
  const [featuredOpen, setFeaturedOpen] = useState(false);
  const [modelsOpen, setModelsOpen] = useState(false);
  const favoritesExpanded = searching
    ? (searchExpansion.states['$favorites'] ?? searchExpansion.open)
    : featuredOpen;
  const modelsExpanded = searching
    ? (searchExpansion.states['$models'] ?? searchExpansion.open)
    : modelsOpen;
  const [editInFeatured, setEditInFeatured] = useState(false);
  const [sortBy, setSortBy] = useState<'name' | 'value'>('name');
  const [descending, setDescending] = useState(false);
  const sort: Sort = { by: sortBy, descending };
  const matches = parameters.filter((p) => parameterMatches(p, query));
  const featured = matches.filter((p) => p.favorite);
  const users = searchParameterTree(
    tree(parameters.filter((p) => p.kind !== 'model' || !/^d\d+$/i.test(p.name))),
    query,
  );
  const models = searchParameterTree(
    tree(parameters.filter((p) => p.kind === 'model' && /^d\d+$/i.test(p.name))),
    query,
  );
  const renderNodes = (root: Node, order?: Sort) => {
    const renderBranch = ([name, node]: [string, Node]) => (
      <Branch
        key={name}
        sort={order}
        dropGroup={moving.preview?.error ? null : moving.preview?.group}
        expansion={expansion}
        searching={searching}
        animate={animate}
        documentId={documentId}
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
        onRenameGroup={onRenameGroup}
        editingName={editInFeatured ? undefined : editingName}
        editor={editor}
      />
    );
    // Keep the same keyed component ancestry while filtering, so a matching inline
    // editor retains its DOM, selection and undo history instead of mounting again.
    return (
      <AnimatedList
        items={sortedChildren(root, order)}
        itemKey={([name]) => name}
        animate={animate}
      >
        {renderBranch}
      </AnimatedList>
    );
  };
  return (
    <RenameContext.Provider
      value={{
        active: activeRename,
        open: setActiveRename,
        close: (id) => setActiveRename((current) => (current === id ? null : current)),
      }}
    >
      <section
        ref={moving.root}
        class="parameter-list"
        aria-label="Parameters list"
        onPointerDown={moving.pointerDown}
        onClickCapture={moving.click}
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
        <Presence show={!!context}>
          {context && (
            <div
              ref={menu}
              class="parameter-context-menu"
              role="menu"
              aria-label="Parameter actions"
            >
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
        </Presence>
        <div class="section-body">
          <Collapsible open={searchOpen} class="parameter-search-reveal">
            <div class="parameter-search" role="search">
              <Search size={14} aria-hidden="true" />
              <input
                ref={searchInput}
                type="search"
                aria-label="Search parameters"
                placeholder="Search parameters"
                value={query}
                title="Search names, native or virtual paths, expressions, and comments"
                onInput={(event) => updateQuery(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    closeSearch();
                  }
                }}
              />
              <button
                class="icon"
                aria-label="Close parameter search"
                title="Close search"
                onClick={closeSearch}
              >
                <X size={14} />
              </button>
            </div>
          </Collapsible>
          {searching && (
            <p class="helper" role="status">
              {matches.length
                ? `${matches.length} matching parameter${matches.length === 1 ? '' : 's'}`
                : 'No matching parameters'}
            </p>
          )}
          {moving.error && (
            <p class="error" role="alert">
              {moving.error}
            </p>
          )}
          {moving.preview && (
            <div class="parameter-move-status" role="status">
              {moving.preview.error ||
                (moving.preview.name
                  ? moving.preview.name === moving.preview.source
                    ? 'Already in this group'
                    : `${moving.preview.source} → ${moving.preview.name}`
                  : 'Drop on a group or Named parameters')}
            </div>
          )}
          <Collapsible open={featured.length > 0} class="featured-reveal" animate={animate}>
            <div class="featured-parameters">
              <button
                class="featured-heading"
                aria-expanded={favoritesExpanded}
                onClick={() =>
                  searching
                    ? expansion.toggle('$favorites', !favoritesExpanded)
                    : setFeaturedOpen(!featuredOpen)
                }
              >
                <ChevronRight size={14} /> Favorite parameters ({featured.length})
              </button>
              <Collapsible open={favoritesExpanded} animate={animate}>
                <AnimatedList
                  items={featured}
                  itemKey={(parameter) => parameter.name}
                  class="featured-entry"
                  animate={animate}
                >
                  {(parameter) => (
                    <Branch
                      name={parameter.name}
                      path={parameter.name}
                      node={{ children: new Map(), parameter }}
                      expansion={expansion}
                      documentId={documentId}
                      onFavorite={onFavorite}
                      busy={busy}
                      onEdit={(item) => {
                        setEditInFeatured(true);
                        onEdit(item);
                      }}
                      onDelete={onDelete}
                      onRename={onRename}
                      onRenameGroup={onRenameGroup}
                      editingName={editInFeatured ? editingName : undefined}
                      editor={editor}
                    />
                  )}
                </AnimatedList>
              </Collapsible>
            </div>
          </Collapsible>
          <div
            class={`parameter-list-header ${moving.preview?.group === '' && !moving.preview.error ? 'parameter-drop-target' : ''}`}
            data-parameter-group=""
          >
            <div class="minor-label">Named parameters</div>
            <button
              ref={searchButton}
              class="icon"
              aria-label={searchOpen ? 'Hide parameter search' : 'Show parameter search'}
              aria-expanded={searchOpen}
              title="Search parameters"
              onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
            >
              <Search size={15} />
            </button>
            {onCleanup && (
              <button
                class="icon"
                aria-label="Clean unused parameters"
                title="Clean unused parameters"
                disabled={busy || !documentId}
                onClick={onCleanup}
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.7"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path d="m19 3-8 9m-4-1 6 6-5 5-6-6 5-5Zm-2 8 4-4m-1 7 4-4" />
                </svg>
              </button>
            )}
            <button
              class="icon"
              aria-label="Expand all groups"
              title="Expand all groups"
              onClick={() => {
                setExpansion({ open: true, states: {} });
                if (!searching) setModelsOpen(true);
              }}
            >
              <ChevronsUpDown size={15} />
            </button>
            <button
              class="icon"
              aria-label="Collapse all groups"
              title="Collapse all groups"
              onClick={() => {
                setExpansion({ open: false, states: {} });
                if (!searching) setModelsOpen(false);
              }}
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
          {!users.children.size && !searching && <p class="helper">No named parameters</p>}
          {(!searching || models.children.size > 0) && (
            <div class="model-parameters">
              <button
                class="featured-heading"
                aria-expanded={modelsExpanded}
                onClick={() =>
                  searching
                    ? expansion.toggle('$models', !modelsExpanded)
                    : setModelsOpen(!modelsOpen)
                }
              >
                <ChevronRight size={14} /> Model parameters
              </button>
              <Collapsible open={modelsExpanded} animate={animate}>
                {renderNodes(models)}
                {!models.children.size && <p class="helper">No model parameters</p>}
              </Collapsible>
            </div>
          )}
        </div>
      </section>
    </RenameContext.Provider>
  );
}
