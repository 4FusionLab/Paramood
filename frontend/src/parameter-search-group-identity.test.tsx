// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { App } from './main';
import type { Parameter } from './bridge';
import { parameterTree } from './parameter-tree';
import { searchParameterTree } from './parameter-search';

let host: HTMLDivElement;
const parameters: Parameter[] = [
  { name: 'box', comment: 'needle', favorite: true },
  { name: 'box_width', expression: 'box * 2' },
  { name: 'box_inner_depth' },
  { name: 'tray_height', comment: 'needle box * 2' },
  { name: 'leaf', comment: 'needle' },
].map((item) => ({
  expression: '10 mm',
  unit: 'mm',
  value: 10,
  entityToken: item.name,
  ...item,
}));
type Call = { action: string; payload: Record<string, unknown>; documentId: string };
afterEach(() => {
  if (host) act(() => render(null, host));
  document.body.innerHTML = '';
  delete window.adsk;
  window.location.hash = '';
  vi.restoreAllMocks();
});
async function mount(items = parameters) {
  if (!('onpointerdown' in HTMLElement.prototype))
    Object.defineProperty(HTMLElement.prototype, 'onpointerdown', {
      configurable: true,
      value: null,
    });
  window.location.hash = '#parameters';
  const calls: Call[] = [];
  window.adsk = {
    fusionSendData: (_action, raw) => {
      const data = JSON.parse(raw);
      calls.push(data);
      window.fusionJavaScriptHandler!.handle(
        'response',
        JSON.stringify({
          requestId: data.requestId,
          ok: true,
          documentId: 'doc',
          data:
            data.action === 'state.get'
              ? { documentId: 'doc', documentName: 'Search scope', parameters: items }
              : {},
        }),
      );
    },
  };
  host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => render(<App />, host));
  await vi.waitFor(() => expect(host.textContent).toContain('Search scope'));
  return calls;
}
function button(label: string, root: ParentNode = host) {
  const result = root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  expect(result, label).not.toBeNull();
  return result!;
}
function search(query = 'needle') {
  act(() => button('Show parameter search').click());
  act(() => {
    const input = host.querySelector<HTMLInputElement>('[aria-label="Search parameters"]')!;
    input.value = query;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function rename(label: string, name: string, root: ParentNode = host) {
  act(() => button(label, root).click());
  act(() => {
    const input = host.querySelector<HTMLInputElement>('input.tree-name')!;
    input.value = name;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    host
      .querySelector('input.tree-name')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
}
function pointer(type: string, x = 50) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: x,
    clientY: 50,
  });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  Object.defineProperty(event, 'isPrimary', { value: true });
  return event;
}
async function drag(source: Element, target: Element) {
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => target });
  act(() => {
    source.dispatchEvent(pointer('pointerdown', 10));
  });
  act(() => {
    window.dispatchEvent(pointer('pointermove'));
  });
  await act(async () => {
    window.dispatchEvent(pointer('pointerup'));
  });
}
function mutations(calls: Call[]) {
  return calls.filter((call) => call.action.startsWith('parameters.rename'));
}
function snapshot(items: Parameter[]) {
  return items.map(({ name, entityToken, expression, unit }) => ({
    name,
    entityToken,
    expression,
    unit,
  }));
}
function expectGroup(calls: Call[], group: string, newGroup: string, members: Parameter[]) {
  expect(mutations(calls)).toEqual([
    expect.objectContaining({
      action: 'parameters.renameGroup',
      documentId: 'doc',
      payload: { group, newGroup, parameters: snapshot(members) },
    }),
  ]);
}

it('preserves structural identity without reintroducing hidden values or children', () => {
  const full = parameterTree(parameters);
  expect(searchParameterTree(full, ' ')).toBe(full);
  const projected = searchParameterTree(full, 'needle');
  const box = projected.children.get('box')!;
  expect(box.isGroup).toBe(true);
  expect(box.children.size).toBe(0);
  expect(box.parameter).toBe(parameters[0]);
  const ancestor = searchParameterTree(full, 'box * 2').children.get('box')!;
  expect(ancestor.isGroup).toBe(true);
  expect(ancestor.parameter).toBeUndefined();
  expect([...ancestor.children.keys()]).toEqual(['width']);
  expect(projected.children.get('leaf')!.isGroup).not.toBe(true);
  expect(searchParameterTree(full, 'missing').children.size).toBe(0);
});

it('sends group rename with every original member when only its own value matches', async () => {
  const calls = await mount();
  search();
  expect(host.querySelector('[aria-label="Edit value box_width"]')).toBeNull();
  expect(
    button('Rename group box').closest('.tree-row')?.getAttribute('data-parameter-group'),
  ).toBe('box');
  await rename('Rename group box', 'case');
  expectGroup(calls, 'box', 'case', parameters.slice(0, 3));
});

it('sends group rename with hidden own value and hidden siblings from an ancestor context', async () => {
  const calls = await mount();
  search('box * 2');
  expect(host.querySelector('[aria-label="Edit value box"]')).toBeNull();
  expect(host.querySelector('[aria-label="Edit value box_inner_depth"]')).toBeNull();
  await rename('Rename group box', 'case');
  expectGroup(calls, 'box', 'case', parameters.slice(0, 3));
});

it.each(['needle', 'box * 2'])('drags the full group when filtered by %s', async (query) => {
  const calls = await mount();
  search(query);
  await drag(button('Rename group box'), host.querySelector('[data-parameter-group="tray"]')!);
  expectGroup(calls, 'box', 'tray_box', parameters.slice(0, 3));
});

it('moves a filtered nested Unicode group to the root with all hidden members', async () => {
  const items = parameters.map((p) => ({ ...p, name: p.name.replace('box', 'корпус_ящик') }));
  const calls = await mount(items);
  search();
  expect(host.querySelector('[aria-label="Edit value корпус_ящик_width"]')).toBeNull();
  await drag(button('Rename group корпус.ящик'), host.querySelector('.parameter-list-header')!);
  expectGroup(calls, 'корпус_ящик', 'ящик', items.slice(0, 3));
});

it('keeps Favorites duplicates single-parameter operations while the tree row stays grouped', async () => {
  const calls = await mount();
  search();
  const favorites = host.querySelector('.featured-parameters')!;
  expect(
    button('Rename box', favorites).closest('.tree-row')?.hasAttribute('data-parameter-group'),
  ).toBe(false);
  expect(button('Rename group box')).toBeTruthy();
  await rename('Rename box', 'favoriteBox', favorites);
  expect(mutations(calls)).toEqual([
    expect.objectContaining({
      action: 'parameters.rename',
      payload: expect.objectContaining({ name: 'box', newName: 'favoriteBox' }),
    }),
  ]);
});

it('drags a Favorite duplicate as a single parameter', async () => {
  const calls = await mount();
  search();
  await drag(
    button('Rename box', host.querySelector('.featured-parameters')!),
    host.querySelector('[data-parameter-group="tray"]')!,
  );
  expect(mutations(calls)).toEqual([
    expect.objectContaining({
      action: 'parameters.rename',
      payload: expect.objectContaining({ name: 'box', newName: 'tray_box' }),
    }),
  ]);
});

it('keeps a matching leaf rename single', async () => {
  const calls = await mount();
  search();
  await rename('Rename leaf', 'newLeaf');
  expect(mutations(calls)).toEqual([
    expect.objectContaining({
      action: 'parameters.rename',
      payload: expect.objectContaining({ name: 'leaf', newName: 'newLeaf' }),
    }),
  ]);
});

it('rejects dragging a filtered group if a hidden member is driven', async () => {
  const calls = await mount(
    parameters.map((p) => (p.name === 'box_width' ? { ...p, driven: true } : p)),
  );
  search();
  await drag(button('Rename group box'), host.querySelector('[data-parameter-group="tray"]')!);
  expect(mutations(calls)).toEqual([]);
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    'Every parameter in this group must be editable',
  );
});
