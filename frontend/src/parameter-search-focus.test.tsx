// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { render } from 'preact';
import { useState } from 'preact/hooks';
import { act } from 'preact/test-utils';
import { EditorView } from '@codemirror/view';
import { ParameterList } from './parameter-list';
import { ExpressionEditor } from './editor';
import type { Parameter } from './bridge';

let host: HTMLDivElement;
const submit = vi.fn();
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 160));
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  submit.mockReset();
  if (!Range.prototype.getClientRects)
    Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  if (!Range.prototype.getBoundingClientRect)
    Range.prototype.getBoundingClientRect = () => new DOMRect();
});
afterEach(() => {
  act(() => render(null, host));
  host.remove();
});
function Harness({ name = 'box' }: { name?: string }) {
  const [editing, setEditing] = useState('');
  const [draft, setDraft] = useState('50');
  const parameters: Parameter[] = [
    { name, expression: '50 mm', value: '50 mm', unit: 'mm', favorite: true },
    { name: 'other', expression: '10 mm', value: '10 mm', unit: 'mm' },
  ];
  return (
    <ParameterList
      parameters={parameters}
      onDelete={() => {}}
      onEdit={(p) => setEditing(p.name)}
      editingName={editing}
      editor={
        editing && (
          <ExpressionEditor
            inline
            autoFocus
            label={`Expression for ${editing}`}
            hint="Expression"
            parameters={parameters}
            currentTarget={editing}
            value={draft}
            onChange={setDraft}
            onSubmit={() => submit(draft)}
          />
        )
      }
    />
  );
}
function click(label: string) {
  const button = host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
  act(() => {
    button.focus();
    button.click();
  });
}
function searchBox() {
  return host.querySelector<HTMLInputElement>('[aria-label="Search parameters"]')!;
}
function content() {
  return host.querySelector<HTMLElement>('.cm-content')!;
}
async function mount(name = 'box', favorite = false) {
  act(() => render(<Harness name={name} />, host));
  if (favorite) {
    const heading = host.querySelector<HTMLButtonElement>('.featured-heading')!;
    act(() => heading.click());
  } else click('Expand all groups');
  const buttons = host.querySelectorAll<HTMLButtonElement>(`[aria-label="Edit value ${name}"]`);
  act(() => {
    buttons[0].focus();
    buttons[0].click();
  });
  await act(settle);
  const editor = EditorView.findFromDOM(content())!;
  expect(document.activeElement).toBe(editor.contentDOM);
  act(() => editor.dispatch({ changes: { from: 0, to: 2, insert: '50 + 0' } }));
  return editor;
}
// Route each key to the actual focused field, then wait beyond Preact's passive effects.
// This catches delayed autofocus stealing subsequent characters, unlike direct query assignment.
async function type(text: string) {
  for (const character of text) {
    await act(async () => {
      const active = document.activeElement as HTMLElement;
      active.dispatchEvent(new KeyboardEvent('keydown', { key: character, bubbles: true }));
      if (active instanceof HTMLInputElement) {
        active.value += character;
        active.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        const view = EditorView.findFromDOM(active)!;
        view.dispatch(view.state.replaceSelection(character));
      }
      await settle();
    });
  }
}
async function enter() {
  await act(async () => {
    document.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    await settle();
  });
}
it.each([
  ['root', 'box', false],
  ['nested', 'box_inner_size', false],
  ['favorite', 'box', true],
] as const)(
  'preserves the %s editor and draft through sequential matching search',
  async (_, name, favorite) => {
    const editor = await mount(name, favorite);
    act(() => editor.dispatch({ selection: { anchor: 1, head: 4 } }));
    const selection = editor.state.selection.main;
    click('Show parameter search');
    await act(settle);
    await type('box');
    expect(searchBox().value).toBe('box');
    expect(document.activeElement).toBe(searchBox());
    expect(content()).toBe(editor.contentDOM);
    expect(editor.state.doc.toString()).toBe('50 + 0');
    expect(editor.state.selection.main).toEqual(selection);
    await enter();
    expect(submit).not.toHaveBeenCalled();
    act(() => {
      searchBox().value = '';
      searchBox().dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(settle);
    expect(content()).toBe(editor.contentDOM);
    expect(document.activeElement).toBe(searchBox());
    click('Close parameter search');
    await act(settle);
    expect(content()).toBe(editor.contentDOM);
    expect(document.activeElement).toBe(host.querySelector('[aria-label="Show parameter search"]'));
  },
);
it.each(['Escape', 'Close parameter search', 'Hide parameter search'])(
  'keeps numeric search out of the draft and restores focus after %s',
  async (close) => {
    await mount('baseline');
    click('Show parameter search');
    await type('523');
    expect(searchBox().value).toBe('523');
    expect(document.activeElement).toBe(searchBox());
    await enter();
    expect(submit).not.toHaveBeenCalled();
    if (close === 'Escape') {
      act(() => {
        searchBox().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      });
    } else click(close);
    await act(settle);
    expect(searchBox()).toBeNull();
    expect(EditorView.findFromDOM(content())!.state.doc.toString()).toBe('50 + 0');
    expect(document.activeElement).toBe(host.querySelector('[aria-label="Show parameter search"]'));
    expect(submit).not.toHaveBeenCalled();
  },
);
it('does not reclaim search focus when a previously excluded editor reappears', async () => {
  await mount();
  click('Show parameter search');
  await type('zzz');
  act(() => {
    searchBox().value = '';
    searchBox().dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(settle);
  expect(document.activeElement).toBe(searchBox());
  expect(EditorView.findFromDOM(content())!.state.doc.toString()).toBe('50 + 0');
  await type('box');
  await enter();
  expect(searchBox().value).toBe('box');
  expect(submit).not.toHaveBeenCalled();
});
