import { useState } from 'preact/hooks';
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown } from 'lucide-preact';
import type { VariantParameter } from './bridge';
import { parameterTree, sortedParameterChildren, type ParameterNode } from './parameter-tree';

type Row = VariantParameter & { kind?: 'user' | 'model' };
type Props = {
  parameters: Row[];
  selected: VariantParameter[];
  disabled: boolean;
  filtered: boolean;
  onChange: (parameters: VariantParameter[]) => void;
  selectionOnly?: boolean;
};

export function VariantParameterTree({
  parameters,
  selected,
  disabled,
  filtered,
  onChange,
  selectionOnly = false,
}: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [allOpen, setAllOpen] = useState<boolean | undefined>(undefined);
  const selectedNames = new Set(selected.map((parameter) => parameter.name));
  const named = parameterTree(
    parameters.filter((parameter) => parameter.kind !== 'model' || !/^d\d+$/i.test(parameter.name)),
  );
  const models = parameterTree(
    parameters.filter((parameter) => parameter.kind === 'model' && /^d\d+$/i.test(parameter.name)),
  );
  function hasSelected(node: ParameterNode<Row>): boolean {
    return (
      (!!node.parameter && selectedNames.has(node.parameter.name)) ||
      Array.from(node.children.values()).some(hasSelected)
    );
  }
  function toggle(path: string, open: boolean) {
    setExpanded((previous) => ({ ...previous, [path]: !open }));
  }
  function branch(name: string, node: ParameterNode<Row>, path: string) {
    const parameter = node.parameter;
    const entry = selected.find((item) => item.name === parameter?.name);
    const open = filtered || (expanded[path] ?? allOpen ?? hasSelected(node));
    return (
      <div class="variant-tree-node" key={path}>
        <div class={`variant-parameter ${entry ? 'selected' : ''}`}>
          <div class="variant-tree-name">
            {node.children.size > 0 ? (
              <button
                class="icon tree-toggle"
                aria-label={`${open ? 'Collapse' : 'Expand'} ${path}`}
                aria-expanded={open}
                onClick={() => toggle(path, open)}
              >
                {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
            ) : (
              <span class="tree-spacer" />
            )}
            {parameter ? (
              <label class="variant-parameter-toggle">
                <input
                  type="checkbox"
                  checked={!!entry}
                  disabled={disabled || (parameter.missing && !entry)}
                  aria-label={`Include ${parameter.name}`}
                  onChange={(event) =>
                    onChange(
                      event.currentTarget.checked
                        ? [...selected, parameter]
                        : selected.filter((item) => item.name !== parameter.name),
                    )
                  }
                />
                <span title={parameter.name}>{name}</span>
              </label>
            ) : (
              <button class="variant-group-name" onClick={() => toggle(path, open)} title={path}>
                {name}
              </button>
            )}
          </div>
          {parameter &&
            (parameter.missing ? (
              <span class="error">Missing from model</span>
            ) : entry && !selectionOnly ? (
              <input
                class="variant-expression"
                aria-label={`Value for ${parameter.name}`}
                spellcheck={false}
                value={entry.expression}
                disabled={disabled}
                onInput={(event) =>
                  onChange(
                    selected.map((item) =>
                      item.name === parameter.name
                        ? { ...item, expression: event.currentTarget.value }
                        : item,
                    ),
                  )
                }
              />
            ) : (
              <span class="variant-current-value" title={parameter.expression}>
                {parameter.unit === 'Text' ? parameter.value : parameter.expression}
              </span>
            ))}
        </div>
        {open && node.children.size > 0 && (
          <div class="variant-tree-children">
            {sortedParameterChildren(node, { by: 'name', descending: false }).map(
              ([child, value]) => branch(child, value, `${path}.${child}`),
            )}
          </div>
        )}
      </div>
    );
  }
  const modelsOpen = filtered || (expanded['$models'] ?? allOpen ?? hasSelected(models));
  return (
    <>
      <div class="variant-tree-toolbar">
        <span class="minor-label">Named parameters</span>
        <button
          class="icon"
          aria-label="Expand all groups"
          title="Expand all groups"
          onClick={() => {
            setAllOpen(true);
            setExpanded({});
          }}
        >
          <ChevronsUpDown size={14} />
        </button>
        <button
          class="icon"
          aria-label="Collapse all groups"
          title="Collapse all groups"
          onClick={() => {
            setAllOpen(false);
            setExpanded({});
          }}
        >
          <ChevronsDownUp size={14} />
        </button>
      </div>
      {sortedParameterChildren(named, { by: 'name', descending: false }).map(([name, node]) =>
        branch(name, node, name),
      )}
      {models.children.size > 0 && (
        <div class="model-parameters">
          <button
            class="featured-heading"
            aria-expanded={modelsOpen}
            onClick={() => toggle('$models', modelsOpen)}
          >
            {modelsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Model parameters
          </button>
          {modelsOpen &&
            sortedParameterChildren(models).map(([name, node]) => branch(name, node, name))}
        </div>
      )}
    </>
  );
}
