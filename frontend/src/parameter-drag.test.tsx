// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { ParameterList } from './parameter-list';
import { nameInParameterGroup } from './parameter-tree';
import type { Parameter } from './bridge';

let host: HTMLDivElement;
afterEach(() => {
  if (host) act(() => render(null, host));
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

const parameters: Parameter[] = ['width', 'box_height', 'tray_depth'].map((name) => ({
  name,
  entityToken: name,
  expression: '10 mm',
  value: 10,
  unit: 'mm',
}));
function mount(items = parameters, busy = false) {
  if (!('onpointerdown' in HTMLElement.prototype))
    Object.defineProperty(HTMLElement.prototype, 'onpointerdown', {
      configurable: true,
      value: null,
    });
  host = document.createElement('div');
  document.body.appendChild(host);
  const rename = vi.fn().mockResolvedValue(true);
  const update = (next: Parameter[]) =>
    act(() =>
      render(
        <ParameterList
          parameters={next}
          busy={busy}
          onRename={rename}
          onEdit={() => {}}
          onDelete={() => {}}
        />,
        host,
      ),
    );
  update(items);
  return { rename, update };
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
function start(source: Element, target: Element | null) {
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => target });
  act(() => {
    source.dispatchEvent(pointer('pointerdown', 10));
  });
  act(() => {
    window.dispatchEvent(pointer('pointermove'));
  });
}

it('builds native names for groups, nested paths, Cyrillic and the root', () => {
  expect(nameInParameterGroup('box_width', 'tray.inner')).toBe('tray_inner_width');
  expect(nameInParameterGroup('box_width', '')).toBe('width');
  expect(nameInParameterGroup('размер', 'корпус')).toBe('корпус_размер');
  expect(() => nameInParameterGroup('_width', 'tray')).toThrow();
  expect(() => nameInParameterGroup('box_2', '')).toThrow();
});

it('moves by the name, previews the new name and suppresses rename-click after dragging', async () => {
  const { rename } = mount();
  const source = host.querySelector<HTMLElement>('[aria-label="Rename width"]')!;
  start(source, host.querySelector('[data-parameter-group="box"]'));
  expect(host.querySelector('.parameter-drop-target')?.getAttribute('data-parameter-group')).toBe(
    'box',
  );
  expect(host.querySelector('[role="status"]')?.textContent).toBe('width → box_width');
  await act(async () => {
    window.dispatchEvent(pointer('pointerup'));
  });
  expect(rename).toHaveBeenCalledWith(parameters[0], 'box_width');
  act(() => source.click());
  expect(host.querySelector('input.tree-name')).toBeNull();
});

it('moves a nested parameter back to Named parameters', async () => {
  const { rename } = mount();
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="Expand box"]')!.click());
  start(
    host.querySelector('[aria-label="Rename box_height"]')!,
    host.querySelector('.parameter-list-header'),
  );
  await act(async () => {
    window.dispatchEvent(pointer('pointerup'));
  });
  expect(rename).toHaveBeenCalledWith(parameters[1], 'height');
});

it('rejects collisions without invoking the rename bridge', () => {
  const { rename } = mount([
    ...parameters,
    { ...parameters[0], name: 'box_width', entityToken: 'collision' },
  ]);
  start(
    host.querySelector('[aria-label="Rename width"]')!,
    host.querySelector('[data-parameter-group="box"]'),
  );
  act(() => {
    window.dispatchEvent(pointer('pointerup'));
  });
  expect(rename).not.toHaveBeenCalled();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('box_width already exists');
});

it.each(['Escape', 'pointercancel', 'outside', 'snapshot'])('cancels a move on %s', (cancel) => {
  const { rename, update } = mount();
  start(
    host.querySelector('[aria-label="Rename width"]')!,
    host.querySelector('[data-parameter-group="box"]'),
  );
  act(() => {
    if (cancel === 'Escape') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    else if (cancel === 'pointercancel') window.dispatchEvent(pointer('pointercancel'));
    else if (cancel === 'outside')
      Object.defineProperty(document, 'elementFromPoint', {
        configurable: true,
        value: () => null,
      });
  });
  if (cancel === 'snapshot')
    update(parameters.map((parameter) => ({ ...parameter, entityToken: 'new-document-token' })));
  act(() => {
    window.dispatchEvent(pointer('pointerup'));
  });
  expect(rename).not.toHaveBeenCalled();
  expect(host.querySelector('.parameter-drop-target')).toBeNull();
});

it('keeps ordinary name clicks and value interaction separate from dragging', () => {
  const { rename } = mount();
  start(
    host.querySelector('[aria-label="Edit value width"]')!,
    host.querySelector('[data-parameter-group="box"]'),
  );
  act(() => {
    window.dispatchEvent(pointer('pointerup'));
  });
  expect(rename).not.toHaveBeenCalled();
  const source = host.querySelector<HTMLButtonElement>('[aria-label="Rename width"]')!;
  act(() => {
    source.dispatchEvent(pointer('pointerdown', 10));
    window.dispatchEvent(pointer('pointerup', 10));
    source.click();
  });
  expect(host.querySelector('input.tree-name')).not.toBeNull();
});

it('rejects a case-insensitive collision with another native parameter name', () => {
  const { rename } = mount([
    ...parameters,
    { ...parameters[0], name: 'BOX_WIDTH', entityToken: 'collision' },
  ]);
  start(
    host.querySelector('[aria-label="Rename width"]')!,
    host.querySelector('[data-parameter-group="box"]'),
  );
  act(() => {
    window.dispatchEvent(pointer('pointerup'));
  });
  expect(rename).not.toHaveBeenCalled();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('already exists');
});

it('rejects an exiting inert group as a drop destination', () => {
  const { rename } = mount();
  const target = host.querySelector<HTMLElement>('[data-parameter-group="box"]')!;
  target.closest('.parameter-entry')!.setAttribute('inert', '');
  start(host.querySelector('[aria-label="Rename width"]')!, target);
  act(() => {
    window.dispatchEvent(pointer('pointerup'));
  });
  expect(rename).not.toHaveBeenCalled();
});

it.each(['busy', 'editing'])('cancels an active move when %s begins', (state) => {
  const { rename } = mount();
  start(
    host.querySelector('[aria-label="Rename width"]')!,
    host.querySelector('[data-parameter-group="box"]'),
  );
  act(() =>
    render(
      <ParameterList
        parameters={parameters}
        busy={state === 'busy'}
        editor={state === 'editing' ? <input /> : undefined}
        onRename={rename}
        onEdit={() => {}}
        onDelete={() => {}}
      />,
      host,
    ),
  );
  act(() => {
    window.dispatchEvent(pointer('pointerup'));
  });
  expect(rename).not.toHaveBeenCalled();
  expect(host.querySelector('.parameter-drop-target')).toBeNull();
});
