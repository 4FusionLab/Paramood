// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { ParameterList } from './parameter-list';
import { parameterMatches, searchParameterTree } from './parameter-search';
import { parameterTree } from './parameter-tree';
import type { Parameter } from './bridge';

const parameters: Parameter[] = [
  { name: 'box', expression: '8 mm', value: '8 mm', unit: 'mm', comment: 'Parent value' },
  {
    name: 'box_inner_ширина',
    expression: 'base * 2',
    value: '20 mm',
    unit: 'mm',
    comment: 'Толщина стенки',
    favorite: true,
  },
  { name: 'tray_depth', expression: '4 mm', value: '4 mm', unit: 'mm' },
  { name: 'd1', expression: 'box_inner_ширина', value: '20 mm', unit: 'mm', kind: 'model' },
];
let host: HTMLDivElement;
afterEach(() => {
  if (host) act(() => render(null, host));
  document.body.innerHTML = '';
});
function setup(extra = {}) {
  host = document.createElement('div');
  document.body.appendChild(host);
  act(() =>
    render(
      <ParameterList
        parameters={parameters}
        onEdit={() => {}}
        onDelete={() => {}}
        onFavorite={() => {}}
        {...extra}
      />,
      host,
    ),
  );
}
function click(label: string) {
  act(() => host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click());
}
function search(query: string) {
  if (!host.querySelector('input[aria-label="Search parameters"]')) click('Show parameter search');
  act(() => {
    const input = host.querySelector<HTMLInputElement>('[aria-label="Search parameters"]')!;
    input.value = query;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
it('matches full native and virtual paths, expressions, and Unicode comments', () => {
  for (const query of ['BOX_INNER_ШИРИНА', 'box.inner.ШИРИНА', 'BASE * 2', 'ТОЛЩИНА', 'стенки'])
    expect(parameterMatches(parameters[1], query)).toBe(true);
  expect(parameterMatches(parameters[1], 'missing')).toBe(false);
  expect(parameterMatches({ ...parameters[1], comment: 'й' }, 'и\u0306')).toBe(true);
  expect(parameterMatches(parameters[1], '   ')).toBe(true);
});
it('keeps the whole ancestor chain without exposing unrelated ancestor values', () => {
  const result = searchParameterTree(parameterTree(parameters), 'толщина');
  expect([...result.children.keys()]).toEqual(['box']);
  expect(result.children.get('box')!.parameter).toBeUndefined();
  expect(result.children.get('box')!.children.get('inner')!.children.get('ширина')!.parameter).toBe(
    parameters[1],
  );
});
it('reveals matching collapsed paths, supports empty results, and restores independent expansions and scroll', () => {
  setup();
  click('Expand box');
  host.scrollTop = 123;
  host.scrollLeft = 17;
  search('толщина');
  expect(host.querySelector('[aria-label="Edit value box_inner_ширина"]')).not.toBeNull();
  expect(host.querySelector('[aria-label="Edit value box"]')).toBeNull();
  expect(host.querySelector('[aria-label="Expand tray"]')).toBeNull();
  host.scrollTop = 0;
  host.scrollLeft = 0;
  search('not found');
  expect(host.textContent).toContain('No matching parameters');
  click('Close parameter search');
  expect(host.querySelector('[aria-label="Collapse box"]')).not.toBeNull();
  expect(host.querySelector('[aria-label="Expand box.inner"]')).not.toBeNull();
  expect(host.querySelector('[aria-label="Expand tray"]')).not.toBeNull();
  expect(host.querySelector('[aria-label="Edit value d1"]')).toBeNull();
  expect(host.scrollTop).toBe(123);
  expect(host.scrollLeft).toBe(17);
});
it('can collapse search results without changing the original model or favorite sections', () => {
  setup();
  search('box');
  expect(host.querySelector('[aria-label="Edit value d1"]')).not.toBeNull();
  const heading = host.querySelector<HTMLButtonElement>('.model-parameters > button')!;
  act(() => heading.click());
  expect(host.querySelector('[aria-label="Edit value d1"]')).toBeNull();
  click('Close parameter search');
  expect(host.querySelector('.model-parameters > button')?.getAttribute('aria-expanded')).toBe(
    'false',
  );
  expect(host.querySelector('.featured-heading')?.getAttribute('aria-expanded')).toBe('false');
});
it('keeps editing, favorites, deletion and native reference copying available in search results', () => {
  const onEdit = vi.fn(),
    onDelete = vi.fn(),
    onFavorite = vi.fn(),
    onCopyReference = vi.fn();
  setup({ onEdit, onDelete, onFavorite, onCopyReference });
  search('толщина');
  click('Edit value box_inner_ширина');
  expect(onEdit).toHaveBeenCalledWith(parameters[1]);
  click('Remove from favorites box_inner_ширина');
  expect(onFavorite).toHaveBeenCalledWith(parameters[1]);
  click('Delete box_inner_ширина');
  expect(onDelete).toHaveBeenCalledWith(parameters[1]);
  const row = host.querySelector('[data-parameter-name="box_inner_ширина"]')!;
  act(() => {
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
  });
  act(() => host.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click());
  expect(onCopyReference).toHaveBeenCalledWith('box_inner_ширина');
});
it('shows dimensional, dimensionless and text units without change controls or disclaimers', () => {
  for (const unit of ['mm', 'deg', 'kg', 'm/s', '', 'Text']) {
    const local = document.createElement('div');
    act(() =>
      render(
        <ParameterList
          parameters={[{ name: 'sample', expression: '1', value: '1', unit }]}
          onEdit={() => {}}
          onDelete={() => {}}
        />,
        local,
      ),
    );
    expect(local.querySelector('.tree-unit')?.tagName).toBe('SPAN');
    expect(local.querySelector('.parameter-units-info')).toBeNull();
    expect(local.querySelector('button.tree-unit')).toBeNull();
    expect(local.querySelector('select[aria-label*="unit"]')).toBeNull();
    act(() => render(null, local));
  }
});

it('starts with search hidden, focuses on opening and restores the tree and trigger on Escape', () => {
  setup();
  expect(host.querySelector('[role="search"]')).toBeNull();
  expect(
    host.querySelector('[aria-label="Show parameter search"]')?.getAttribute('aria-expanded'),
  ).toBe('false');
  click('Expand box');
  search('толщина');
  const input = host.querySelector<HTMLInputElement>('input[aria-label="Search parameters"]')!;
  expect(document.activeElement).toBe(input);
  act(() => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  expect(host.querySelector('[role="search"]')).toBeNull();
  expect(host.querySelector('[aria-label="Collapse box"]')).not.toBeNull();
  expect(host.querySelector('[aria-label="Expand box.inner"]')).not.toBeNull();
  expect(document.activeElement).toBe(host.querySelector('[aria-label="Show parameter search"]'));
  click('Show parameter search');
  expect(host.querySelector<HTMLInputElement>('input[aria-label="Search parameters"]')?.value).toBe(
    '',
  );
  click('Hide parameter search');
  expect(host.querySelector('[role="search"]')).toBeNull();
});
