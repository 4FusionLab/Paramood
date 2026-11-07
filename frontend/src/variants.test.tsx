// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { EditorView } from '@codemirror/view';
import { currentCompletions, startCompletion } from '@codemirror/autocomplete';
import { VariantsControl } from './variants';
import type { ModelState } from './bridge';

let host: HTMLDivElement;
afterEach(() => {
  if (host) act(() => render(null, host));
  document.body.innerHTML = '';
});
const parameter = {
  name: 'width',
  expression: '10 mm',
  unit: 'mm',
  value: '10 mm',
  entityToken: 'width-token',
};
const model: ModelState = {
  documentId: 'model',
  parameters: [
    parameter,
    { ...parameter, name: 'height', entityToken: 'height-token' },
    { ...parameter, name: 'driven', driven: true },
  ],
  variants: [],
  variantsToken: 'storage',
  variantSnapshotToken: 'snapshot',
  activeVariantId: null,
};
function mount(state = model, onAction = vi.fn().mockResolvedValue(true), disabled = false) {
  if (!Range.prototype.getClientRects)
    Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  if (!Range.prototype.getBoundingClientRect)
    Range.prototype.getBoundingClientRect = () => new DOMRect();
  host = document.createElement('div');
  document.body.appendChild(host);
  act(() =>
    render(<VariantsControl model={state} disabled={disabled} onAction={onAction} />, host),
  );
  return onAction;
}
function click(label: string) {
  const button = Array.from(host.querySelectorAll('button')).find(
    (item) => item.getAttribute('aria-label') === label || item.textContent?.trim() === label,
  );
  expect(button, label).toBeTruthy();
  act(() => button!.click());
}
function input(label: string, value: string) {
  const element = host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
  act(() => {
    if (element.matches('.cm-content')) {
      const editor = EditorView.findFromDOM(element)!;
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: value },
        selection: { anchor: value.length },
      });
    } else {
      element.value = value;
      element.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
}
function name(value: string) {
  const element = host.querySelector<HTMLInputElement>('#variant-name')!;
  act(() => {
    element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function create() {
  click('Variants: Free');
  click('Create variant');
}
const saved = {
  id: 'compact',
  name: 'Compact',
  parameters: [
    { name: 'width', entityToken: 'width-token', expression: '10 mm', unit: 'mm', value: 1 },
  ],
};

describe('variants workflow', () => {
  it('starts in Free and exposes a useful empty state', () => {
    mount();
    click('Variants: Free');
    expect(host.textContent).toContain('Save parameter values');
    expect(host.textContent).toContain('Create variant');
  });
  it('creates a variant from selected parameters and values with captured document tokens', async () => {
    const action = mount();
    create();
    name('Compact');
    expect(host.querySelector('[aria-label="Include driven"]')).toBeNull();
    click('Save & apply');
    expect(action).not.toHaveBeenCalled();
    act(() => host.querySelector<HTMLInputElement>('[aria-label="Include width"]')!.click());
    input('Value for width', '25 mm');
    click('Save & apply');
    await vi.waitFor(() =>
      expect(action).toHaveBeenCalledWith(
        'variants.save',
        expect.objectContaining({
          name: 'Compact',
          variantsToken: 'storage',
          snapshotToken: 'snapshot',
          parameters: [
            expect.objectContaining({
              name: 'width',
              expression: '25 mm',
              entityToken: 'width-token',
            }),
          ],
        }),
      ),
    );
    await vi.waitFor(() => expect(host.querySelector('[role="dialog"]')).toBeNull());
  });
  it('removes membership without sending a model deletion', async () => {
    const action = mount({ ...model, variants: [saved] });
    click('Variants: Free');
    click('Edit Compact');
    act(() => host.querySelector<HTMLInputElement>('[aria-label="Include width"]')!.click());
    act(() => host.querySelector<HTMLInputElement>('[aria-label="Include height"]')!.click());
    click('Save & apply');
    await vi.waitFor(() =>
      expect(action).toHaveBeenCalledWith(
        'variants.save',
        expect.objectContaining({ parameters: [expect.objectContaining({ name: 'height' })] }),
      ),
    );
  });
  it('filters parameters while preserving selected values', () => {
    mount();
    create();
    act(() => host.querySelector<HTMLInputElement>('[aria-label="Include width"]')!.click());
    input('Value for width', '30 mm');
    input('Find parameters for variant', 'height');
    expect(host.querySelector('[aria-label="Include width"]')).toBeNull();
    input('Find parameters for variant', '');
    expect(host.querySelector<HTMLInputElement>('[aria-label="Value for width"]')!.value).toBe(
      '30 mm',
    );
  });
  it('switches and returns to Free without resetting parameter values', async () => {
    const action = mount({ ...model, variants: [saved], activeVariantId: saved.id });
    click('Variants: Compact');
    click('FreeEdit without updating a variant');
    await vi.waitFor(() =>
      expect(action).toHaveBeenCalledWith(
        'variants.free',
        expect.objectContaining({ snapshotToken: 'snapshot' }),
      ),
    );
  });
  it('disables duplicate names and missing parameters but lets users repair membership', () => {
    mount({
      ...model,
      variants: [
        saved,
        {
          ...saved,
          id: 'missing',
          name: 'Missing',
          parameters: [{ ...saved.parameters[0], missing: true }],
        },
      ],
    });
    create();
    name('compact');
    expect(host.textContent).toContain('already exists');
    click('Cancel');
    click('Variants: Free');
    click('Edit Missing');
    expect(host.textContent).toContain('Missing from model');
    act(() => host.querySelector<HTMLInputElement>('[aria-label="Include width"]')!.click());
    expect(host.textContent).not.toContain('Missing from model');
  });
  it('retains draft when the backend rejects a save', async () => {
    const action = mount(model, vi.fn().mockResolvedValue(false));
    create();
    name('Compact');
    act(() => host.querySelector<HTMLInputElement>('[aria-label="Include width"]')!.click());
    input('Value for width', 'bad expression');
    click('Save & apply');
    await vi.waitFor(() => expect(action).toHaveBeenCalled());
    expect(host.querySelector<HTMLInputElement>('[aria-label="Value for width"]')!.value).toBe(
      'bad expression',
    );
    expect(host.querySelector('[role="dialog"]')).toBeTruthy();
  });
  it('confirms deleting a variant while preserving the model', async () => {
    const action = mount({ ...model, variants: [saved] });
    click('Variants: Free');
    click('Edit Compact');
    click('Delete variant');
    expect(action).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Model parameters will stay');
    click('Delete variant');
    await vi.waitFor(() =>
      expect(action).toHaveBeenCalledWith(
        'variants.delete',
        expect.objectContaining({ id: saved.id }),
      ),
    );
  });
  it('supports Escape, focus restoration and a trapped dialog tab order', async () => {
    mount();
    create();
    await vi.waitFor(() => expect(document.activeElement?.id).toBe('variant-name'));
    const dialog = host.querySelector<HTMLElement>('[role="dialog"]')!;
    const close = dialog.querySelector<HTMLButtonElement>('[aria-label="Close variant editor"]')!;
    act(() => {
      close.focus();
      close.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }),
      );
    });
    expect(document.activeElement?.textContent).toBe('Cancel');
    act(() => {
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Variants: Free');
  });
  it('disables variants when storage cannot be safely read', () => {
    mount({ ...model, variantsError: 'Cannot read saved variants.' });
    expect(host.querySelector<HTMLButtonElement>('.variant-trigger')!.disabled).toBe(true);
  });
});

describe('variant parameter hierarchy', () => {
  it('selects a parent value and child independently without losing either on collapse', () => {
    mount({
      ...model,
      parameters: [
        { ...parameter, name: 'post', unit: '', expression: '4', value: '4', entityToken: 'post' },
        { ...parameter, name: 'post_height', entityToken: 'post-height' },
      ],
    });
    create();
    act(() => host.querySelector<HTMLInputElement>('[aria-label="Include post"]')!.click());
    input('Value for post', '6');
    expect(host.querySelector('[aria-label="Include post_height"]')).toBeTruthy();
    act(() => host.querySelector<HTMLInputElement>('[aria-label="Include post_height"]')!.click());
    input('Value for post_height', '120 mm');
    click('Collapse post');
    expect(host.querySelector<HTMLInputElement>('[aria-label="Value for post"]')!.value).toBe('6');
    act(() => host.querySelector<HTMLInputElement>('[aria-label="Include post"]')!.click());
    click('Expand post');
    expect(
      host.querySelector<HTMLInputElement>('[aria-label="Include post_height"]')!.checked,
    ).toBe(true);
    expect(
      host.querySelector<HTMLInputElement>('[aria-label="Value for post_height"]')!.value,
    ).toBe('120 mm');
    expect(host.querySelector<HTMLInputElement>('[aria-label="Include post"]')!.checked).toBe(
      false,
    );
  });
  const treeModel: ModelState = {
    ...model,
    parameters: [
      { ...parameter, name: 'box_inner_width', entityToken: 'inner' },
      { ...parameter, name: 'box_height', entityToken: 'height' },
      { ...parameter, name: 'd10', entityToken: 'd10', kind: 'model' },
    ],
  };
  it('uses nested underscore groups and a separate Model parameters section', () => {
    mount(treeModel);
    create();
    expect(host.querySelector('[aria-label="Include box_inner_width"]')).toBeNull();
    click('Expand box');
    click('Expand box.inner');
    expect(host.querySelector('[aria-label="Include box_inner_width"]')).toBeTruthy();
    expect(host.querySelector('[aria-label="Include d10"]')).toBeNull();
    click('Model parameters');
    expect(host.querySelector('[aria-label="Include d10"]')).toBeTruthy();
    click('Collapse all groups');
    expect(host.querySelector('[aria-label="Include box_inner_width"]')).toBeNull();
    click('Expand all groups');
    expect(host.querySelector('[aria-label="Include box_inner_width"]')).toBeTruthy();
  });
  it('opens matching ancestors during search and preserves selection after clearing it', () => {
    mount(treeModel);
    create();
    input('Find parameters for variant', 'inner_width');
    expect(host.querySelector('[aria-label="Include box_inner_width"]')).toBeTruthy();
    expect(host.querySelector('[aria-label="Include box_height"]')).toBeNull();
    expect(host.textContent).toContain('box');
    act(() => {
      host.querySelector<HTMLInputElement>('[aria-label="Include box_inner_width"]')!.click();
    });
    input('Value for box_inner_width', '15 mm');
    input('Find parameters for variant', '');
    expect(
      host.querySelector<HTMLInputElement>('[aria-label="Value for box_inner_width"]')!.value,
    ).toBe('15 mm');
  });
});

describe('smart variant search', () => {
  const searchModel: ModelState = {
    ...model,
    parameters: [
      { ...parameter, name: 'box_width', entityToken: 'box-width' },
      { ...parameter, name: 'box_height', entityToken: 'box-height' },
    ],
  };
  it('selects and assigns a dotted path immediately without applying to Fusion', async () => {
    const action = mount(searchModel);
    create();
    input('Find parameters for variant', 'box.width=30');
    expect(host.querySelector<HTMLInputElement>('[aria-label="Include box_width"]')!.checked).toBe(
      true,
    );
    expect(host.querySelector<HTMLInputElement>('[aria-label="Value for box_width"]')!.value).toBe(
      '30 mm',
    );
    expect(action).not.toHaveBeenCalled();
    input('Find parameters for variant', 'box.width=40');
    expect(host.querySelector<HTMLInputElement>('[aria-label="Value for box_width"]')!.value).toBe(
      '40 mm',
    );
    expect(host.textContent).toContain('1 selected');
    input('Find parameters for variant', '');
    expect(host.querySelector<HTMLInputElement>('[aria-label="Value for box_width"]')!.value).toBe(
      '40 mm',
    );
    name('Smart');
    click('Save & apply');
    await vi.waitFor(() =>
      expect(action).toHaveBeenCalledWith(
        'variants.save',
        expect.objectContaining({
          parameters: [expect.objectContaining({ name: 'box_width', expression: '40 mm' })],
        }),
      ),
    );
  });
  it('offers hierarchy IntelliSense in the search and compiles formula references', async () => {
    mount(searchModel);
    create();
    input('Find parameters for variant', 'box.');
    const editor = EditorView.findFromDOM(
      host.querySelector<HTMLElement>('[aria-label="Find parameters for variant"]')!,
    )!;
    act(() => {
      startCompletion(editor);
    });
    await vi.waitFor(() =>
      expect(currentCompletions(editor.state).map((item) => item.label)).toContain('width'),
    );
    input('Find parameters for variant', 'box.width=box.height/2');
    expect(host.querySelector<HTMLInputElement>('[aria-label="Value for box_width"]')!.value).toBe(
      'box_height/2',
    );
    input('Find parameters for variant', 'unknown=20');
    expect(host.textContent).toContain('Choose an existing editable parameter');
  });
  it('shows variant search only above five saved variants', () => {
    const variants = Array.from({ length: 5 }, (_, index) => ({
      ...saved,
      id: String(index),
      name: `Size ${index}`,
    }));
    mount({ ...model, variants });
    click('Variants: Free');
    expect(host.querySelector('[aria-label="Find variant"]')).toBeNull();
    act(() =>
      render(
        <VariantsControl
          model={{ ...model, variants: [...variants, { ...saved, id: 'six' }] }}
          disabled={false}
          onAction={vi.fn()}
        />,
        host,
      ),
    );
    expect(host.querySelector('[aria-label="Find variant"]')).toBeTruthy();
  });
});
