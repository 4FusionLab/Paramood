// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'preact';
import { EditorView } from '@codemirror/view';
import { currentCompletions, startCompletion } from '@codemirror/autocomplete';
import { act } from 'preact/test-utils';
import { VariantsControl } from './variants';
import type { ModelState } from './bridge';
import { ParameterList } from './parameter-list';

let host: HTMLDivElement;
afterEach(() => {
  if (host) act(() => render(null, host));
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).animate;
  delete window.adsk;
});
const parameter = {
  name: 'width',
  expression: '10 mm',
  unit: 'mm',
  value: '10 mm',
  entityToken: 'width-token',
  configured: true,
};
const saved = {
  id: 'compact',
  name: 'Compact',
  parameters: [{ ...parameter, value: 1 }],
  features: [{ name: 'Cut', entityToken: 'cut', enabled: true }],
};
const model: ModelState = {
  documentId: 'model',
  parameters: [
    parameter,
    { ...parameter, name: 'height', entityToken: 'height-token', configured: false },
    { ...parameter, name: 'driven', driven: true },
  ],
  variants: [saved],
  variantColumns: [
    { kind: 'parameter', name: 'width', entityToken: 'width-token', unit: 'mm' },
    { kind: 'feature', name: 'Cut', entityToken: 'cut' },
  ],
  timelineFeatures: [{ name: 'Cut', entityToken: 'cut', enabled: true }],
  variantsToken: 'storage',
  variantSnapshotToken: 'snapshot',
  activeVariantId: null,
};
function mount(state = model, onAction = vi.fn().mockResolvedValue(true)) {
  // jsdom has no pointer event properties; Preact otherwise preserves an unsupported event's case.
  if (!('onpointerdown' in HTMLElement.prototype))
    Object.defineProperty(HTMLElement.prototype, 'onpointerdown', {
      configurable: true,
      value: null,
    });
  if (!Range.prototype.getClientRects)
    Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  if (!Range.prototype.getBoundingClientRect)
    Range.prototype.getBoundingClientRect = () => new DOMRect();
  if (!window.adsk)
    window.adsk = {
      fusionSendData: (_action, raw) => {
        const message = JSON.parse(raw),
          text = message.payload.text as string;
        window.fusionJavaScriptHandler!.handle(
          'response',
          JSON.stringify({
            requestId: message.requestId,
            ok: true,
            documentId: state.documentId,
            data: { expression: text?.slice(text.indexOf('=') + 1).trim(), newParameters: [] },
          }),
        );
      },
    };
  host = document.createElement('div');
  document.body.appendChild(host);
  act(() => render(<VariantsControl model={state} disabled={false} onAction={onAction} />, host));
  return onAction;
}
function click(label: string) {
  const b = Array.from(host.querySelectorAll('button')).find(
    (b) => b.getAttribute('aria-label') === label || b.textContent?.trim() === label,
  );
  expect(b, label).toBeTruthy();
  act(() => b!.click());
}
function input(label: string, value: string) {
  let e = host.querySelector<HTMLElement>(`[aria-label="${label}"]`)!;
  expect(e, label).toBeTruthy();
  if (e.matches('button.variant-cell-value')) {
    act(() => e.click());
    e = host.querySelector<HTMLElement>(`[aria-label="${label}"]`)!;
  }
  act(() => {
    if (e.matches('.cm-content')) {
      const view = EditorView.findFromDOM(e)!;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
        selection: { anchor: value.length },
      });
    } else {
      const field = e as HTMLInputElement;
      field.value = value;
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
}
function cellValue(label: string) {
  const e = host.querySelector<HTMLElement>(`[aria-label="${label}"]`)!;
  return e.matches('.cm-content') ? EditorView.findFromDOM(e)!.state.doc.toString() : e.textContent;
}

function open() {
  click('Variants: Free');
  click('Edit variants');
}
function checkbox(label: string) {
  const e = host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
  expect(e, label).toBeTruthy();
  act(() => e.click());
}
async function save() {
  click('Save');
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('global variant table', () => {
  it('opens a fresh table when reopened before the discarded draft finishes fading', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    Object.defineProperty(HTMLElement.prototype, 'animate', {
      configurable: true,
      value: vi.fn(() => ({ onfinish: null, cancel: vi.fn() })),
    });
    mount();
    open();
    click('Duplicate Compact');
    click('Cancel');
    click('Discard changes');
    expect(host.querySelector('.motion-presence[inert] [role="dialog"]')).toBeTruthy();
    open();
    expect(host.querySelectorAll('tr[data-variant-id]')).toHaveLength(1);
    expect(host.textContent).not.toContain('Discard unsaved table');
    expect(host.textContent).not.toContain('Unsaved changes');
  });
  it('does not let a delayed save completion close a newly opened table', async () => {
    let finishSave!: (ok: boolean) => void;
    const action = mount(
      model,
      vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            finishSave = resolve;
          }),
      ),
    );
    open();
    click('Duplicate Compact');
    click('Save');
    await act(async () => {});
    expect(action).toHaveBeenCalledOnce();
    click('Cancel');
    click('Discard changes');
    open();
    await act(async () => finishSave(true));
    expect(host.querySelector('[role="dialog"]')).toBeTruthy();
  });
  it('does not send a deferred cell Save after the table has been discarded', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addListener() {}, removeListener() {} }));
    Object.defineProperty(HTMLElement.prototype, 'animate', {
      configurable: true,
      value: vi.fn(() => ({ onfinish: null, cancel: vi.fn() })),
    });
    let respond!: () => void;
    window.adsk = {
      fusionSendData: (_action, raw) => {
        const message = JSON.parse(raw);
        respond = () =>
          window.fusionJavaScriptHandler!.handle(
            'response',
            JSON.stringify({
              requestId: message.requestId,
              ok: true,
              documentId: 'model',
              data: { expression: '40 mm', newParameters: [] },
            }),
          );
      },
    };
    const action = mount();
    open();
    input('Compact / width', '40 mm');
    click('Save');
    await act(async () => {});
    expect(respond).toBeTypeOf('function');
    click('Cancel');
    click('Discard changes');
    await act(async () => respond());
    expect(action).not.toHaveBeenCalled();
    open();
    expect(cellValue('Compact / width')).toBe('10 mm');
  });
  it('shows shared counts and one table editor entry in the switcher header', () => {
    mount();
    click('Variants: Free');
    const heading = host.querySelector('.variant-menu-heading')!;
    expect(heading.textContent).toContain('1 parameter · 1 feature');
    expect(heading.querySelector('[aria-label="Edit variants"]')).toBeTruthy();
    const options = host.querySelector('.variant-options')!;
    expect(options.querySelector('.icon')).toBeNull();
    expect(options.textContent).not.toContain('parameter');
    click('Edit variants');
    expect(host.querySelector('[role="dialog"]')).toBeTruthy();
  });
  it('uses shared IntelliSense, this and function completions inside a table cell', async () => {
    mount();
    open();
    input('Compact / width', '');
    const view = EditorView.findFromDOM(host.querySelector<HTMLElement>('.cm-content')!)!;
    act(() => {
      startCompletion(view);
    });
    await vi.waitFor(() =>
      expect(currentCompletions(view.state).map((c) => c.label)).toContain('this'),
    );
    expect(currentCompletions(view.state).map((c) => c.label)).toContain('random');
    input('Compact / width', 'sin(30 deg)');
    expect(host.querySelector('.token-function')?.textContent).toBe('sin');
    expect(host.querySelector('.variant-table-scroll .cm-tooltip')).toBeNull();
  });
  it('keeps newly linked global parameters in the draft and sends them only on Save', async () => {
    window.adsk = {
      fusionSendData: (_action, raw) => {
        const message = JSON.parse(raw);
        window.fusionJavaScriptHandler!.handle(
          'response',
          JSON.stringify({
            requestId: message.requestId,
            ok: true,
            documentId: 'model',
            data: {
              expression: 'beam',
              newParameters: [{ name: 'beam', expression: '25 mm', unit: 'mm', value: 25 }],
            },
          }),
        );
      },
    };
    const action = mount();
    open();
    input('Compact / width', 'beam=25');
    await save();
    expect(action.mock.calls[0][1].newParameters).toEqual([
      { name: 'beam', expression: '25 mm', unit: 'mm' },
    ]);
    expect(action.mock.calls[0][1].columns.map((c: { name: string }) => c.name)).toEqual([
      'width',
      'Cut',
    ]);
    expect(action.mock.calls[0][1].variants[0].parameters[0].expression).toBe('beam');
  });
  it('duplicates the committed cell draft without losing the action during editor blur', async () => {
    mount();
    open();
    input('Compact / width', '35 mm');
    click('Duplicate Compact');
    await vi.waitFor(() => expect(host.querySelector('[aria-label="Variant name"]')).toBeTruthy());
    expect(cellValue('Compact / width')).toBe('35 mm');
    expect(cellValue('Compact copy / width')).toBe('35 mm');
  });
  it('keeps variants as rows at any width and appends Add variant as the last row', () => {
    mount();
    open();
    expect(host.querySelector('thead th')?.textContent).toBe('Variant');
    expect(host.querySelector('tbody tr:last-child')?.textContent).toContain('Add variant');
    click('Add variant');
    input('Variant name', 'Garden');
    expect(
      host.querySelector('[aria-label="Garden / width"]')?.closest('tr')?.querySelector('th'),
    ).toBeTruthy();
    expect(host.querySelector('tbody tr:last-child')?.textContent).toContain('Add variant');
  });
  it('renames in place and confirms deletion next to the row without writing before Save', async () => {
    const action = mount();
    open();
    click('Rename Compact');
    input('Variant name', 'Garden');
    click('Delete Garden');
    expect(host.textContent).toContain('Model parameters and features will stay');
    click('Keep variant');
    expect(host.querySelector('[aria-label="Garden / width"]')).toBeTruthy();
    click('Delete Garden');
    click('Delete variant');
    expect(action).not.toHaveBeenCalled();
    expect(host.querySelector('[aria-label="Garden / width"]')).toBeNull();
    await save();
    expect(action.mock.calls[0][1].variants).toEqual([]);
  });
  it('adds picked timeline features to every draft row only while picking the same document', async () => {
    window.adsk = {
      fusionSendData: (_action, raw) => {
        const request = JSON.parse(raw);
        window.fusionJavaScriptHandler!.handle(
          'response',
          JSON.stringify({
            requestId: request.requestId,
            ok: true,
            documentId: 'model',
            data: { documentId: 'model', features: [] },
          }),
        );
      },
    };
    const action = mount();
    open();
    click('Configure · 2');
    click('Pick from timeline');
    await vi.waitFor(() => expect(host.textContent).toContain('Done picking'));
    const emit = (documentId: string, name = 'Fillet') =>
      act(() => {
        window.fusionJavaScriptHandler!.handle(
          'variants.selection',
          JSON.stringify({ documentId, features: [{ name, entityToken: name, enabled: false }] }),
        );
      });
    emit('other');
    expect(host.querySelector('[aria-label="Compact / Fillet enabled"]')).toBeNull();
    emit('model');
    emit('model');
    expect(host.querySelectorAll('[aria-label="Compact / Fillet enabled"]')).toHaveLength(1);
    expect(
      host.querySelector<HTMLInputElement>('[aria-label="Compact / Fillet enabled"]')!.checked,
    ).toBe(false);
    click('Done picking');
    emit('model', 'Extrude');
    expect(host.querySelector('[aria-label="Compact / Extrude enabled"]')).toBeNull();
    expect(action).not.toHaveBeenCalled();
    await save();
    expect(action.mock.calls[0][1].columns).toHaveLength(3);
  });
  it('saves all rows without applying or changing the switcher contract', async () => {
    const action = mount();
    open();
    input('Compact / width', '25 mm');
    await save();
    expect(action).toHaveBeenCalledWith(
      'variants.table.save',
      expect.objectContaining({
        variantsToken: 'storage',
        snapshotToken: 'snapshot',
        columns: model.variantColumns,
        variants: [
          expect.objectContaining({
            id: 'compact',
            parameters: [expect.objectContaining({ expression: '25 mm' })],
          }),
        ],
      }),
    );
    expect(action).not.toHaveBeenCalledWith('variants.apply', expect.anything());
  });
  it('selects the parameter set globally and initializes every row from current values', async () => {
    const action = mount({
      ...model,
      variants: [saved, { ...saved, id: 'garden', name: 'Garden' }],
    });
    open();
    click('Configure · 2');
    expect(host.querySelector('[aria-label="Include driven"]')).toBeNull();
    checkbox('Include height');
    await save();
    const payload = action.mock.calls[0][1];
    expect(payload.columns.map((c: { name: string }) => c.name)).toEqual([
      'width',
      'Cut',
      'height',
    ]);
    expect(
      payload.variants.every((r: { parameters: { name: string }[] }) =>
        r.parameters.some((p) => p.name === 'height'),
      ),
    ).toBe(true);
  });
  it('treats a checked feature as enabled and unchecked as suppressed', async () => {
    const action = mount();
    open();
    expect(
      host.querySelector<HTMLInputElement>('[aria-label="Compact / Cut enabled"]')!.checked,
    ).toBe(true);
    checkbox('Compact / Cut enabled');
    await save();
    expect(action.mock.calls[0][1].variants[0].features[0].enabled).toBe(false);
  });
  it('removes a member from every row without deleting anything from the model', async () => {
    const action = mount();
    open();
    click('Configure · 2');
    checkbox('Include width');
    await save();
    expect(action.mock.calls[0][1].columns.map((c: { kind: string }) => c.kind)).toEqual([
      'feature',
    ]);
    expect(action.mock.calls[0][1].variants[0].parameters).toEqual([]);
  });
  it('creates and duplicates rows with editable names and no per-variant membership selector', async () => {
    const action = mount();
    click('Variants: Free');
    click('Create variant');
    input('Variant name', 'Garden');
    expect(host.querySelector('[aria-label="Garden / width"]')).toBeTruthy();
    click('Duplicate Garden');
    input('Variant name', 'Patio');
    await save();
    expect(action).toHaveBeenCalledTimes(1);
    expect(action.mock.calls[0][1].variants.map((r: { name: string }) => r.name)).toEqual([
      'Compact',
      'Garden',
      'Patio',
    ]);
  });
  it('blocks duplicate names and preserves a rejected draft', async () => {
    const action = mount(model, vi.fn().mockResolvedValue(false));
    open();
    click('Duplicate Compact');
    input('Variant name', 'Compact');
    expect(host.textContent).toContain('names must be unique');
    expect(host.querySelector<HTMLButtonElement>('.variant-dialog-footer .primary')!.disabled).toBe(
      true,
    );
    input('Variant name', 'Garden');
    input('Garden / width', 'bad expression');
    await save();
    expect(action).toHaveBeenCalled();
    expect(cellValue('Garden / width')).toBe('bad expression');
  });
  it('requires explicit discard before closing a dirty table', () => {
    mount();
    open();
    input('Compact / width', '40 mm');
    click('Cancel');
    expect(host.textContent).toContain('Discard unsaved table');
    click('Keep editing');
    expect(host.querySelector('[role="dialog"]')).toBeTruthy();
    click('Cancel');
    click('Discard changes');
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });
  it('preserves the draft across stale model refreshes until the user confirms replacement', () => {
    const action = mount();
    open();
    input('Compact / width', '40 mm');
    act(() =>
      render(
        <VariantsControl
          model={{ ...model, variantSnapshotToken: 'new' }}
          disabled={false}
          onAction={action}
        />,
        host,
      ),
    );
    expect(cellValue('Compact / width')).toBe('40 mm');
    click('Reload from model');
    click('Keep editing');
    expect(host.textContent).toContain('draft is preserved');
    click('Reload from model');
    click('Replace draft');
    expect(cellValue('Compact / width')).toBe('10 mm');
  });
  it('reorders both axes with keyboard handles and keeps cell identities intact', async () => {
    const action = mount({
      ...model,
      variants: [saved, { ...saved, id: 'garden', name: 'Garden' }],
    });
    open();
    for (const name of ['Compact', 'width']) {
      const handle = host.querySelector(`[aria-label="Reorder ${name}"]`)!;
      act(() => {
        handle.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true }),
        );
      });
    }
    await save();
    const payload = action.mock.calls[0][1];
    expect(payload.variants.map((r: { name: string }) => r.name)).toEqual(['Garden', 'Compact']);
    expect(payload.columns.map((c: { name: string }) => c.name)).toEqual(['Cut', 'width']);
    expect(payload.variants[0].parameters[0].entityToken).toBe('width-token');
  });
  it('reorders rows and columns with pointer gestures when native HTML drag events are unavailable', async () => {
    const action = mount({
      ...model,
      variants: [saved, { ...saved, id: 'garden', name: 'Garden' }],
    });
    open();
    const pointer = (type: string, x: number, y: number) =>
      new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
    for (const [source, destination] of [
      ['Compact', 'Garden'],
      ['width', 'Cut'],
    ]) {
      const handle = host.querySelector(`[aria-label="Reorder ${source}"]`)!;
      const target = host.querySelector(`[aria-label="Reorder ${destination}"]`)!;
      Object.defineProperty(document, 'elementFromPoint', {
        configurable: true,
        value: () => target,
      });
      act(() => {
        handle.dispatchEvent(pointer('pointerdown', 20, 20));
      });
      act(() => {
        window.dispatchEvent(pointer('pointermove', 60, 60));
      });
      if (source === 'width') {
        const highlighted = host.querySelectorAll('.table-column-drop-target');
        expect(highlighted).toHaveLength(3);
        expect(highlighted[0].tagName).toBe('TH');
        expect(highlighted[1].classList.contains('variant-feature-cell')).toBe(true);
        expect(highlighted[2].classList.contains('variant-last-row-cell')).toBe(true);
      }
      act(() => {
        window.dispatchEvent(pointer('pointerup', 60, 60));
      });
      expect(host.querySelector('.table-column-drop-target')).toBeNull();
    }
    expect(host.querySelector('[data-reorder-rows="0"]')?.textContent).toContain('Garden');
    await save();
    expect(action).toHaveBeenCalledTimes(1);
    expect(action.mock.calls[0][1].variants.map((r: { name: string }) => r.name)).toEqual([
      'Garden',
      'Compact',
    ]);
    expect(action.mock.calls[0][1].columns.map((c: { name: string }) => c.name)).toEqual([
      'Cut',
      'width',
    ]);
    expect(action.mock.calls[0][1].variants[0].parameters[0].entityToken).toBe('width-token');
  });
  it('cancels pointer reorder on Escape, pointer cancellation, or release outside the table', () => {
    mount({ ...model, variants: [saved, { ...saved, id: 'garden', name: 'Garden' }] });
    open();
    const pointer = (type: string, x: number) =>
      new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: 20 });
    const handle = host.querySelector('[aria-label="Reorder Compact"]')!;
    const target = host.querySelector('[aria-label="Reorder Garden"]')!;
    for (const cancel of ['Escape', 'pointercancel', 'outside']) {
      Object.defineProperty(document, 'elementFromPoint', {
        configurable: true,
        value: () => target,
      });
      act(() => {
        handle.dispatchEvent(pointer('pointerdown', 20));
      });
      act(() => {
        window.dispatchEvent(pointer('pointermove', 60));
      });
      act(() => {
        if (cancel === 'outside')
          Object.defineProperty(document, 'elementFromPoint', {
            configurable: true,
            value: () => null,
          });
        else if (cancel === 'Escape')
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        else window.dispatchEvent(pointer('pointercancel', 60));
        window.dispatchEvent(pointer('pointerup', 60));
      });
      expect(host.querySelector('[data-reorder-rows="0"]')?.textContent).toContain('Compact');
      expect(host.textContent).toContain('All changes saved');
      expect(host.querySelector('.table-drop-target')).toBeNull();
      expect(host.querySelector('[role="dialog"]')).toBeTruthy();
    }
  });
  it('ignores foreign HTML drops without changing the draft', () => {
    mount({ ...model, variants: [saved, { ...saved, id: 'garden', name: 'Garden' }] });
    open();
    const target = host.querySelector('[aria-label="Reorder Garden"]')!.closest('th')!;
    act(() => {
      target.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));
    });
    expect(host.textContent).toContain('All changes saved');
  });
  it('uses the original apply and Free actions when switching', async () => {
    const action = mount();
    click('Variants: Free');
    click('Compact');
    await vi.waitFor(() =>
      expect(action).toHaveBeenCalledWith(
        'variants.apply',
        expect.objectContaining({ id: 'compact' }),
      ),
    );
  });
  it('closes the draft when the active document changes', () => {
    const action = mount();
    open();
    input('Compact / width', '40 mm');
    act(() =>
      render(
        <VariantsControl
          model={{ ...model, documentId: 'other' }}
          disabled={false}
          onAction={action}
        />,
        host,
      ),
    );
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(action).not.toHaveBeenCalled();
  });
  it('marks configured parameters in the common list independently of the active variant', () => {
    host = document.createElement('div');
    act(() =>
      render(
        <ParameterList parameters={model.parameters} onEdit={() => {}} onDelete={() => {}} />,
        host,
      ),
    );
    expect(host.querySelector('[aria-label="width: controlled by variants"]')).toBeTruthy();
    expect(host.querySelector('[aria-label="height: controlled by variants"]')).toBeNull();
  });
});
