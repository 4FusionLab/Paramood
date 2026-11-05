import { useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { ChevronDown, ChevronRight, Link2, X, DraftingCompass, Shapes } from 'lucide-preact';
import type { Parameter } from './bridge';

export function expressionWithoutUnit(parameter: Parameter): string {
  const match = parameter.expression
    .trim()
    .match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*([A-Za-z]+)$/);
  return match && match[2] === parameter.unit ? match[1] : parameter.expression;
}
function displayValue(parameter: Parameter): string {
  const text = String(parameter.value);
  const suffix = parameter.unit ? ` ${parameter.unit}` : '';
  return suffix && text.endsWith(suffix) ? text.slice(0, -suffix.length) : text;
}
type Node = { children: Map<string, Node>; parameter?: Parameter };
function tree(parameters: Parameter[]): Node {
  const root: Node = { children: new Map() };
  for (const parameter of parameters) {
    const parts = /^[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+$/.test(parameter.name)
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
function Branch({
  name,
  node,
  path,
  onEdit,
  onDelete,
  editingName,
  editor,
}: {
  name: string;
  node: Node;
  path: string;
  onEdit: (parameter: Parameter) => void;
  onDelete: (parameter: Parameter) => void;
  editingName?: string;
  editor?: ComponentChildren;
}) {
  const [open, setOpen] = useState(true);
  const parameter = node.parameter;
  return (
    <div class="tree-node">
      <div class="tree-row">
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
        <span class="tree-name" title={parameter?.name || path}>
          {name}
        </span>
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
            ) : (
              <button
                class="tree-value"
                title="Edit expression"
                aria-label={`Edit value ${parameter.name}`}
                onClick={() => onEdit(parameter)}
              >
                {displayValue(parameter)}
              </button>
            )}
            <span class="tree-unit">{parameter.unit}</span>
            <button
              class="icon"
              aria-label={`Delete ${parameter.name}`}
              title="Delete parameter"
              onClick={() => onDelete(parameter)}
            >
              <X size={13} />
            </button>
          </>
        )}
      </div>
      {open && node.children.size > 0 && (
        <div class="tree-children">
          {Array.from(node.children, ([child, value]) => (
            <Branch
              key={child}
              name={child}
              node={value}
              path={`${path}.${child}`}
              onEdit={onEdit}
              onDelete={onDelete}
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
  editingName,
  editor,
}: {
  parameters: Parameter[];
  onEdit: (parameter: Parameter) => void;
  onDelete: (parameter: Parameter) => void;
  editingName?: string;
  editor?: ComponentChildren;
}) {
  const users = tree(parameters.filter((p) => p.kind !== 'model' || !/^d\d+$/i.test(p.name)));
  const models = tree(parameters.filter((p) => p.kind === 'model' && /^d\d+$/i.test(p.name)));
  const renderNodes = (root: Node) =>
    Array.from(root.children, ([name, node]) => (
      <Branch
        key={name}
        name={name}
        path={name}
        node={node}
        onEdit={onEdit}
        onDelete={onDelete}
        editingName={editingName}
        editor={editor}
      />
    ));
  return (
    <section class="parameter-list" aria-label="Parameters list">
      <div class="section-body">
        <div class="minor-label">Named parameters</div>
        {renderNodes(users)}
        {!users.children.size && <p class="helper">No named parameters</p>}
        <div class="model-parameters">
          <div class="minor-label">Model parameters</div>
          {renderNodes(models)}
          {!models.children.size && <p class="helper">No model parameters</p>}
        </div>
      </div>
    </section>
  );
}
