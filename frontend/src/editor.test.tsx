// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { useState } from 'preact/hooks';
import { EditorView } from '@codemirror/view';
import {
  CompletionContext,
  completionStatus,
  currentCompletions,
  startCompletion,
} from '@codemirror/autocomplete';
import { completions, ExpressionEditor } from './editor';
import { EditorState } from '@codemirror/state';

let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  if (!Range.prototype.getClientRects)
    Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  if (!Range.prototype.getBoundingClientRect)
    Range.prototype.getBoundingClientRect = () => new DOMRect();
});
afterEach(() => {
  act(() => render(null, host));
  host.remove();
});
function mount(opts: { disabled?: boolean; text?: string; singleLine?: boolean } = {}) {
  const onSubmit = vi.fn(),
    onChange = vi.fn();
  act(() =>
    render(
      <ExpressionEditor
        value={opts.text ?? 'w=1'}
        onChange={onChange}
        onSubmit={onSubmit}
        parameters={[{ name: 'height', expression: '10 mm', value: 10, unit: 'mm' }]}
        batch
        disabled={opts.disabled}
        singleLine={opts.singleLine}
        label="Test expression"
        hint="Example"
      />,
      host,
    ),
  );
  const content = host.querySelector('.cm-content') as HTMLElement;
  const view = EditorView.findFromDOM(content)!;
  return { view, content, onSubmit, onChange };
}
function key(content: HTMLElement, key: string, shiftKey = false) {
  content.dispatchEvent(
    new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }),
  );
}
describe('ExpressionEditor keyboard interaction', () => {
  it('keeps the smart-search editor on one line, including pasted text', () => {
    const { view } = mount({ singleLine: true, text: 'width=30' });
    act(() =>
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: 'width=30\nheight=20' },
      }),
    );
    expect(view.state.doc.toString()).toBe('width=30');
  });
  it('disabled editor is not editable and Enter cannot submit', () => {
    const { view, content, onSubmit } = mount({ disabled: true });
    expect(view.state.readOnly).toBe(true);
    expect(content.getAttribute('contenteditable')).toBe('false');
    key(content, 'Enter');
    expect(onSubmit).not.toHaveBeenCalled();
  });
  it('Enter submits and Shift+Enter inserts a newline', () => {
    const { view, content, onSubmit } = mount();
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    key(content, 'Enter');
    expect(onSubmit).toHaveBeenCalledTimes(1);
    key(content, 'Enter', true);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(view.state.doc.toString()).toBe('w=1\n');
  });
  it('keeps a sequence of rapid edits in a controlled editor', () => {
    function Controlled() {
      const [value, setValue] = useState('');
      return (
        <ExpressionEditor
          value={value}
          onChange={setValue}
          parameters={[]}
          batch
          label="Controlled"
          hint="Example"
        />
      );
    }
    act(() => render(<Controlled />, host));
    const editor = EditorView.findFromDOM(host.querySelector<HTMLElement>('.cm-content')!)!;
    for (const character of 'pm_probe=15') {
      act(() => editor.dispatch({ changes: { from: editor.state.doc.length, insert: character } }));
    }
    expect(editor.state.doc.toString()).toBe('pm_probe=15');
  });
  it('applies an external value before a subsequent edit', () => {
    const editorElement = (value: string) => (
      <ExpressionEditor
        value={value}
        onChange={() => {}}
        parameters={[]}
        label="External value"
        hint="Example"
      />
    );
    act(() => render(editorElement(''), host));
    const editor = EditorView.findFromDOM(host.querySelector<HTMLElement>('.cm-content')!)!;
    render(editorElement('привет'), host);
    editor.dispatch({ changes: { from: editor.state.doc.length, insert: '123' } });
    act(() => {});
    expect(editor.state.doc.toString()).toBe('привет123');
  });
  it('Enter accepts an active suggestion without submitting', async () => {
    const { view, content, onSubmit } = mount({ text: 'w=hei' });
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    startCompletion(view);
    await vi.waitFor(() => expect(completionStatus(view.state)).toBe('active'), { timeout: 2000 });
    await new Promise((resolve) => setTimeout(resolve, 150));
    key(content, 'Enter');
    expect(view.state.doc.toString()).toBe('w=height');
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('hierarchical parameter completion', () => {
  const parameters = [
    { name: 'box_size', expression: '10 mm', value: 10, unit: 'mm' },
    { name: 'box_inner_size', expression: '5 mm', value: 5, unit: 'mm' },
    { name: 'box_inner', expression: '2 mm', value: 2, unit: 'mm' },
    { name: 'box__unsafe', expression: '1 mm', value: 1, unit: 'mm' },
    { name: 'box_3d_width', expression: '1 mm', value: 1, unit: 'mm' },
  ];
  function suggest(text: string) {
    const state = EditorState.create({ doc: text });
    return completions(new CompletionContext(state, text.length, false), parameters, false)!;
  }
  it('offers object ahead of ordinary flat parameters', () => {
    const options = suggest('b').options;
    expect(options.find((o) => o.label === 'box')?.boost).toBeGreaterThan(0);
    expect(options.some((o) => o.label === 'box_size')).toBe(true);
    expect(options.some((o) => o.label === 'box__unsafe')).toBe(true);
  });
  it('recognizes a dotted parameter in syntax highlighting', () => {
    act(() =>
      render(
        <ExpressionEditor
          value="box.inner.size + 1"
          onChange={() => {}}
          parameters={parameters}
          label="Hierarchy"
          hint="Example"
        />,
        host,
      ),
    );
    expect(host.querySelector('.token-parameter')?.textContent).toBe('box.inner.size');
  });
  it('ranks an object ahead of a flat parameter in the actual popup', async () => {
    act(() =>
      render(
        <ExpressionEditor
          value="b"
          onChange={() => {}}
          parameters={parameters}
          label="Hierarchy"
          hint="Example"
        />,
        host,
      ),
    );
    const view = EditorView.findFromDOM(host.querySelector<HTMLElement>('.cm-content')!)!;
    view.dispatch({ selection: { anchor: 1 } });
    startCompletion(view);
    await vi.waitFor(() => expect(completionStatus(view.state)).toBe('active'), { timeout: 3000 });
    const labels = currentCompletions(view.state).map((c) => c.label);
    expect(labels.indexOf('box')).toBeLessThan(labels.indexOf('box_size'));
    expect(labels.indexOf('box')).toBeGreaterThanOrEqual(0);
  });
  it('matches object paths case insensitively and inserts the canonical path', async () => {
    act(() =>
      render(
        <ExpressionEditor
          value="BOX."
          onChange={() => {}}
          parameters={parameters}
          label="Hierarchy"
          hint="Example"
        />,
        host,
      ),
    );
    const content = host.querySelector<HTMLElement>('.cm-content')!;
    const view = EditorView.findFromDOM(content)!;
    view.dispatch({ selection: { anchor: 4 } });
    startCompletion(view);
    await vi.waitFor(() => expect(completionStatus(view.state)).toBe('active'), { timeout: 3000 });
    await new Promise((resolve) => setTimeout(resolve, 150));
    key(content, 'Enter');
    expect(view.state.doc.toString()).toBe('box.3d.');
  });
  it('continues completion automatically after accepting nested objects', async () => {
    const items = [{ name: 'box_inner_size', expression: '5 mm', value: 5, unit: 'mm' }];
    act(() =>
      render(
        <ExpressionEditor
          value="b"
          onChange={() => {}}
          parameters={items}
          label="Hierarchy"
          hint="Example"
        />,
        host,
      ),
    );
    const content = host.querySelector<HTMLElement>('.cm-content')!;
    const view = EditorView.findFromDOM(content)!;
    view.dispatch({ selection: { anchor: 1 } });
    startCompletion(view);
    await vi.waitFor(() =>
      expect(currentCompletions(view.state).map((c) => c.label)).toContain('box'),
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
    key(content, 'Enter');
    await vi.waitFor(() => expect(view.state.doc.toString()).toBe('box.'));
    await vi.waitFor(() =>
      expect(currentCompletions(view.state).map((c) => c.label)).toContain('inner'),
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
    key(content, 'Enter');
    await vi.waitFor(() => expect(view.state.doc.toString()).toBe('box.inner.'));
    await vi.waitFor(() =>
      expect(currentCompletions(view.state).map((c) => c.label)).toContain('size'),
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
    key(content, 'Enter');
    expect(view.state.doc.toString()).toBe('box.inner.size');
  });
  it('does not duplicate a dot already after the selected object', async () => {
    const items = [{ name: 'box_inner_size', expression: '5 mm', value: 5, unit: 'mm' }];
    act(() =>
      render(
        <ExpressionEditor
          value="b."
          onChange={() => {}}
          parameters={items}
          label="Hierarchy"
          hint="Example"
        />,
        host,
      ),
    );
    const content = host.querySelector<HTMLElement>('.cm-content')!;
    const view = EditorView.findFromDOM(content)!;
    view.dispatch({ selection: { anchor: 1 } });
    startCompletion(view);
    await vi.waitFor(() =>
      expect(currentCompletions(view.state).map((c) => c.label)).toContain('box'),
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
    key(content, 'Enter');
    expect(view.state.doc.toString()).toBe('box.');
    expect(view.state.selection.main.head).toBe(4);
    await vi.waitFor(() =>
      expect(currentCompletions(view.state).map((c) => c.label)).toContain('inner'),
    );
  });
  it('opens the popup automatically after typing a dot', async () => {
    act(() =>
      render(
        <ExpressionEditor
          value="box"
          onChange={() => {}}
          parameters={parameters}
          label="Hierarchy"
          hint="Example"
        />,
        host,
      ),
    );
    const view = EditorView.findFromDOM(host.querySelector<HTMLElement>('.cm-content')!)!;
    view.dispatch({ changes: { from: 3, insert: '.' }, selection: { anchor: 4 } });
    await vi.waitFor(() => expect(completionStatus(view.state)).toBe('active'), { timeout: 3000 });
    expect(currentCompletions(view.state).map((c) => c.label)).toContain('size');
  });
  it('suggests a dotted parameter declared earlier in the current batch', () => {
    const text = 'box.inner.size=5;l=box.inner.';
    const state = EditorState.create({ doc: text });
    const result = completions(new CompletionContext(state, text.length, false), [], true);
    expect(result?.options.map((option) => option.label)).toContain('size');
    const rootText = 'box.inner.size=5;l=b';
    const root = EditorState.create({ doc: rootText });
    const options = completions(new CompletionContext(root, rootText.length, false), [], true);
    expect(options?.options.map((option) => option.label)).toContain('box');
    expect(options?.options.map((option) => option.label)).toContain('box_inner_size');
  });
  it('offers earlier batch objects on the left side of a later assignment', () => {
    const text = 'box.inner.size=25; box.=box.inner.size*2';
    const pos = text.indexOf('box.=') + 4;
    const state = EditorState.create({ doc: text });
    const result = completions(new CompletionContext(state, pos, false), [], true);
    expect(result?.options.map((option) => option.label)).toContain('inner');
  });
  it('does not suggest the parameter currently being defined', () => {
    const text = 'box.inner.size=25; box.inner.length=box.inner.';
    const state = EditorState.create({ doc: text });
    const result = completions(new CompletionContext(state, text.length, false), [], true);
    expect(result?.options.map((option) => option.label)).toContain('size');
    expect(result?.options.map((option) => option.label)).not.toContain('length');
  });
  it('excludes a new parameter and its empty virtual objects', () => {
    const only: typeof parameters = [];
    const text = 'box.inner.size=box.';
    const state = EditorState.create({ doc: text });
    const result = completions(new CompletionContext(state, text.length, false), only, true);
    expect(result?.options.map((option) => option.label)).not.toContain('inner');
    const flat = 'box_inner_size=box';
    const state2 = EditorState.create({ doc: flat });
    const root = completions(new CompletionContext(state2, flat.length, false), only, true);
    expect(root?.options.map((option) => option.label)).not.toContain('box_inner_size');
    expect(root?.options.map((option) => option.label)).not.toContain('box');
  });
  it('keeps the existing parameter available when redefining it', () => {
    const text = 'box.inner.size=box.inner.';
    const state = EditorState.create({ doc: text });
    const result = completions(new CompletionContext(state, text.length, false), parameters, true);
    expect(result?.options.map((option) => option.label)).toContain('size');
  });
  it('offers this only for the expression of an existing parameter', () => {
    const existing = 'box.inner.size=this';
    const current = EditorState.create({ doc: existing });
    const result = completions(
      new CompletionContext(current, existing.length, false),
      parameters,
      true,
    );
    expect(result?.options.map((option) => option.label)).toContain('this');
    const created = 'box.inner.new=this';
    const fresh = EditorState.create({ doc: created });
    const freshResult = completions(
      new CompletionContext(fresh, created.length, false),
      parameters,
      true,
    );
    expect(freshResult?.options.map((option) => option.label)).not.toContain('this');
  });
  it('offers this while editing an existing parameter inline', () => {
    const state = EditorState.create({ doc: 'th' });
    const result = completions(
      new CompletionContext(state, 2, false),
      parameters,
      false,
      'box_inner_size',
    );
    expect(result?.options.map((option) => option.label)).toContain('this');
  });
  it('offers this and the parameter itself after an earlier batch declaration', () => {
    const text = 'box.inner.size=25; box.inner.size=box.inner.';
    const state = EditorState.create({ doc: text });
    const result = completions(new CompletionContext(state, text.length, false), [], true);
    expect(result?.options.map((option) => option.label)).toContain('size');
    const shorthand = 'box.inner.size=25; box.inner.size=th';
    const other = EditorState.create({ doc: shorthand });
    const keywords = completions(new CompletionContext(other, shorthand.length, false), [], true);
    expect(keywords?.options.map((option) => option.label)).toContain('this');
  });
  it('recognizes this as the existing parameter value in an update', () => {
    act(() =>
      render(
        <ExpressionEditor
          value="box.inner.size=this*2"
          onChange={() => {}}
          parameters={parameters}
          batch
          label="Hierarchy"
          hint="Example"
        />,
        host,
      ),
    );
    const tokens = Array.from(host.querySelectorAll('.token-parameter')).map(
      (token) => token.textContent,
    );
    expect(tokens).toContain('this');
  });
  it('still offers a parameter name when editing the assignment target', () => {
    const text = 'box.inner.size=box.inner.size*2';
    const pos = text.indexOf('=');
    const state = EditorState.create({ doc: text });
    const result = completions(new CompletionContext(state, pos, false), parameters, true);
    expect(result?.options.map((option) => option.label)).toContain('size');
  });
  it('drops deleted parameters from an open popup without changing the draft', async () => {
    const editorElement = (items: typeof parameters) => (
      <ExpressionEditor
        value="box"
        onChange={() => {}}
        parameters={items}
        label="Hierarchy"
        hint="Example"
      />
    );
    act(() => render(editorElement(parameters), host));
    const view = EditorView.findFromDOM(host.querySelector<HTMLElement>('.cm-content')!)!;
    view.dispatch({ selection: { anchor: 3 } });
    startCompletion(view);
    await vi.waitFor(() =>
      expect(currentCompletions(view.state).map((item) => item.label)).toContain('box_size'),
    );
    act(() => render(editorElement([]), host));
    await vi.waitFor(() =>
      expect(currentCompletions(view.state).map((item) => item.label)).not.toContain('box_size'),
    );
    expect(view.state.doc.toString()).toBe('box');
  });
  it('offers only the next path segment after a dot, including object and parameter collisions', () => {
    const options = suggest('box.').options;
    expect(options.filter((o) => o.label === 'inner')).toHaveLength(2);
    expect(options.some((o) => o.label === 'size')).toBe(true);
    expect(options.some((o) => o.label === 'box_size')).toBe(false);
    expect(suggest('box.inner.').options.map((o) => o.label)).toEqual(['size']);
    expect(suggest('box.3d.').options.map((o) => o.label)).toEqual(['width']);
  });
});

describe('model dimension completion', () => {
  const parameters = [
    { name: 'd1', expression: '10 mm', value: 10, unit: 'mm', kind: 'model' as const },
    { name: 'd25', expression: '20 mm', value: 20, unit: 'mm', kind: 'model' as const },
    { name: 'depth', expression: '30 mm', value: 30, unit: 'mm', kind: 'user' as const },
  ];
  it('offers dN only for the exact d prefix on either side of an assignment', () => {
    for (const text of ['d', 'width=d', 'D', 'width=D']) {
      const result = completions(
        new CompletionContext(EditorState.create({ doc: text }), text.length, false),
        parameters,
        true,
      );
      expect(result?.options.map((option) => option.label)).toEqual(
        expect.arrayContaining(['d1', 'd25']),
      );
    }
    for (const text of ['de', 'width=de', 'd1', 'width=d1', '', 'width=']) {
      const result = completions(
        new CompletionContext(EditorState.create({ doc: text }), text.length, true),
        parameters,
        true,
      );
      expect(result?.options.map((option) => option.label) ?? []).not.toEqual(
        expect.arrayContaining(['d1']),
      );
      expect(result?.options.map((option) => option.label) ?? []).not.toEqual(
        expect.arrayContaining(['d25']),
      );
    }
    for (const text of ['25', 'width=25']) {
      expect(
        completions(
          new CompletionContext(EditorState.create({ doc: text }), text.length, true),
          parameters,
          true,
        ),
      ).toBeNull();
    }
    const result = completions(
      new CompletionContext(EditorState.create({ doc: 'de' }), 2, false),
      parameters,
      true,
    );
    expect(result?.options.map((option) => option.label)).toContain('depth');
  });
  it.each(['e', '1'])('removes dimensions from the live popup when d gains %s', async (suffix) => {
    act(() =>
      render(
        <ExpressionEditor
          value="d"
          onChange={() => {}}
          parameters={parameters}
          batch
          label="Expression"
          hint="Example"
        />,
        host,
      ),
    );
    const view = EditorView.findFromDOM(host.querySelector<HTMLElement>('.cm-content')!)!;
    view.dispatch({ selection: { anchor: 1 } });
    startCompletion(view);
    await vi.waitFor(() =>
      expect(currentCompletions(view.state).map((c) => c.label)).toContain('d1'),
    );
    view.dispatch({
      changes: { from: 1, insert: suffix },
      selection: { anchor: 2 },
      userEvent: 'input.type',
    });
    await vi.waitFor(() => {
      const labels = currentCompletions(view.state).map((c) => c.label);
      expect(labels).not.toContain('d1');
      if (suffix === 'e') expect(labels).toContain('depth');
      else expect(completionStatus(view.state)).not.toBe('pending');
    });
    expect(currentCompletions(view.state).map((c) => c.label)).not.toContain('d25');
  });
});

it('completes Cyrillic hierarchical parameter names', () => {
  const text = 'корпус.ш';
  const state = EditorState.create({ doc: text });
  const result = completions(
    new CompletionContext(state, text.length, false),
    [{ name: 'корпус_ширина', expression: '10 mm', value: 10, unit: 'mm' }],
    false,
  );
  expect(result?.options.map((option) => option.label)).toContain('ширина');
});
