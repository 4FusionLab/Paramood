// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { VariantsControl } from './variants';
import type { ModelState } from './bridge';
import { ParameterList } from './parameter-list';

let host: HTMLDivElement;
afterEach(() => {
  if (host) act(() => render(null, host));
  document.body.innerHTML = '';
  vi.restoreAllMocks();
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
  const e = host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
  expect(e, label).toBeTruthy();
  act(() => {
    e.value = value;
    e.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function open() {
  click('Variants: Free');
  click('Edit Compact');
}
function checkbox(label: string) {
  const e = host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
  expect(e, label).toBeTruthy();
  act(() => e.click());
}
async function save() {
  click('Save');
  await act(async () => {
    await Promise.resolve();
  });
}

describe('global variant table', () => {
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
    expect(host.querySelector<HTMLInputElement>('[aria-label="Garden / width"]')!.value).toBe(
      'bad expression',
    );
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
    expect(host.querySelector<HTMLInputElement>('[aria-label="Compact / width"]')!.value).toBe(
      '40 mm',
    );
    click('Reload from model');
    click('Keep editing');
    expect(host.textContent).toContain('draft is preserved');
    click('Reload from model');
    click('Replace draft');
    expect(host.querySelector<HTMLInputElement>('[aria-label="Compact / width"]')!.value).toBe(
      '10 mm',
    );
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
  it('rejects foreign drag data and accepts local drops only within the matching axis', async () => {
    const action = mount({
      ...model,
      variants: [saved, { ...saved, id: 'garden', name: 'Garden' }],
    });
    open();
    const target = host.querySelector('[aria-label="Reorder Garden"]')!.closest('th')!;
    act(() => {
      target.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));
    });
    expect(host.textContent).toContain('All changes saved');
    act(() => {
      host
        .querySelector('[aria-label="Reorder Compact"]')!
        .dispatchEvent(new Event('dragstart', { bubbles: true }));
    });
    act(() => {
      target.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));
    });
    await save();
    expect(action.mock.calls[0][1].variants.map((r: { name: string }) => r.name)).toEqual([
      'Garden',
      'Compact',
    ]);
  });
  it('uses the original apply and Free actions when switching', async () => {
    const action = mount();
    click('Variants: Free');
    click('Compact1 parameter');
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
