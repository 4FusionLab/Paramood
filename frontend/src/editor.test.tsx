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
import { undo } from '@codemirror/commands';
import { unitCompletionFrom } from '../../src/expression-language';

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
  vi.restoreAllMocks();
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
  it.each(['d.max.', 'box.inner.size.', 'корпус.ширина.', 'a=1; d.max.', 'a=1\nd.max.'])(
    'replaces the final path dot with an assignment in %s',
    (text) => {
      const { view, content, onChange } = mount({ text });
      view.dispatch({ selection: { anchor: text.length } });
      act(() => key(content, '='));
      expect(view.state.doc.toString()).toBe(text.slice(0, -1) + '=');
      expect(view.state.selection.main.head).toBe(text.length);
      expect(onChange).toHaveBeenLastCalledWith(text.slice(0, -1) + '=');
      act(() => {
        undo(view);
      });
      expect(view.state.doc.toString()).toBe(text);
    },
  );
  it.each(['width=d.max.', '3.', 'width=3.', 'd..', 'label="d.max.', 'max(d.max.'])(
    'does not intercept equals outside an assignment target: %s',
    (text) => {
      const { view, content } = mount({ text });
      view.dispatch({ selection: { anchor: text.length } });
      const event = new KeyboardEvent('keydown', { key: '=', bubbles: true, cancelable: true });
      act(() => {
        content.dispatchEvent(event);
      });
      expect(event.defaultPrevented).toBe(false);
      expect(view.state.doc.toString()).toBe(text);
    },
  );
  it.each([
    { text: 'd.max', from: 5, to: 5, insert: '=', cursor: 6 },
    { text: 'a.b', from: 2, to: 3, insert: '', cursor: 2 },
  ])('resets a stale native caret when editing $text', ({ text, from, to, insert, cursor }) => {
    const { view } = mount({ text });
    view.focus();
    view.dispatch({ selection: { anchor: text.length } });
    const selection = document.getSelection()!;
    // Fusion can report the right DOM selection while still displaying the old native caret.
    // Model that separate visible position: only resetting the native selection redraws it.
    let visibleCaret = text.length;
    let cleared = false;
    const clear = selection.removeAllRanges.bind(selection);
    const set = selection.setBaseAndExtent.bind(selection);
    vi.spyOn(selection, 'removeAllRanges').mockImplementation(() => {
      cleared = true;
      clear();
    });
    vi.spyOn(selection, 'setBaseAndExtent').mockImplementation(
      (anchor, offset, head, headOffset) => {
        set(anchor, offset, head, headOffset);
        if (cleared) visibleCaret = view.posAtDOM(head, headOffset);
      },
    );
    act(() => view.dispatch({ changes: { from, to, insert }, selection: { anchor: cursor } }));
    expect(view.posAtDOM(selection.focusNode!, selection.focusOffset)).toBe(cursor);
    expect(visibleCaret).toBe(cursor);
    expect(selection.isCollapsed).toBe(true);
  });

  it('keeps backward selections and does not take focus from another field', () => {
    const { view } = mount({ text: 'a.b' });
    view.focus();
    act(() =>
      view.dispatch({ changes: { from: 3, insert: '=1' }, selection: { anchor: 5, head: 2 } }),
    );
    const selection = document.getSelection()!;
    expect(view.posAtDOM(selection.anchorNode!, selection.anchorOffset)).toBe(5);
    expect(view.posAtDOM(selection.focusNode!, selection.focusOffset)).toBe(2);
    const input = document.createElement('input');
    host.appendChild(input);
    input.focus();
    const reset = vi.spyOn(selection, 'removeAllRanges');
    act(() => view.dispatch({ changes: { from: 5, insert: '0' } }));
    expect(document.activeElement).toBe(input);
    expect(reset).not.toHaveBeenCalled();
  });

  it('does not reset the native selection during IME composition', () => {
    const { view } = mount({ text: 'a.b' });
    view.focus();
    vi.spyOn(view, 'composing', 'get').mockReturnValue(true);
    const reset = vi.spyOn(document.getSelection()!, 'removeAllRanges');
    act(() => view.dispatch({ changes: { from: 3, insert: 'c' } }));
    expect(reset).not.toHaveBeenCalled();
  });

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
      const result = completions(
        new CompletionContext(EditorState.create({ doc: text }), text.length, true),
        parameters,
        true,
      );
      expect(result?.options.some((option) => option.type === 'variable')).not.toBe(true);
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

import { fusionFunctions, fusionConstants } from '../../src/expression-catalog';
import { expressionSignatureHelp } from './expression-codemirror';

describe('Fusion builtin editor integration', () => {
  it.each(['mm', '10m', 'probe=mm', 'probe=10 m', 'probe="10 mm', 'box.mm'])(
    'shares unit context with the reusable adapter: %s',
    (text) => {
      expect(unitCompletionFrom(text, text.length) !== null).toBe(
        text.includes('10') && !text.includes('"'),
      );
    },
  );
  it.each(['mm', 'probe=mm', 'probe=2+mm', 'probe=max(mm', 'width12mm', '1e'])(
    'does not suggest units without a preceding value: %s',
    (text) => {
      const result = completions(
        new CompletionContext(EditorState.create({ doc: text }), text.length, true),
        [],
        false,
      );
      expect(result?.options.some((c) => c.detail === 'Fusion unit')).not.toBe(true);
    },
  );
  it.each(['10 ', '10 m', '10m', '.5 m', '1e-3 m', 'probe=10 m', '(2+3) m'])(
    'suggests units after a numeric value: %s',
    (text) => {
      const result = completions(
        new CompletionContext(EditorState.create({ doc: text }), text.length, false),
        [],
        text.includes('='),
      );
      expect(result?.options.find((c) => c.label === 'mm')?.detail).toBe('Fusion unit');
      expect(result?.options.some((c) => c.type === 'function')).not.toBe(true);
      expect(text.slice(0, result!.from) + 'mm').toBe(text.replace(/m?$/, 'mm'));
    },
  );
  it.each(fusionFunctions)(
    'completes, inserts and highlights $name from the shared catalog',
    (fn) => {
      const text = `probe=${fn.name.slice(0, 2)}`;
      const { view } = mount({ text });
      const result = completions(new CompletionContext(view.state, text.length, true), [], true)!;
      const completion = result.options.find((c) => c.label === fn.name)!;
      expect(completion.detail).toBe(fn.signature);
      expect(completion.info).toContain(fn.description);
      expect(typeof completion.apply).toBe('function');
      const apply = completion.apply;
      if (typeof apply === 'function') act(() => apply(view, completion, result.from, text.length));
      expect(view.state.doc.toString()).toBe(`probe=${fn.name}()`);
      expect(view.state.selection.main.head).toBe(`probe=${fn.name}(`.length);
      expect(host.querySelector('.token-function')?.textContent).toBe(fn.name);
      const tooltip = view.state.field(expressionSignatureHelp)[0];
      expect(tooltip.create(view).dom.textContent).toContain(fn.description);
      expect(tooltip.create(view).dom.textContent).toContain(fn.example);
    },
  );
  it.each(fusionConstants)(
    'completes and highlights $name without making it an inline parameter',
    (constant) => {
      const text = `probe=${constant.name}`;
      const { view } = mount({ text });
      const result = completions(new CompletionContext(view.state, text.length, true), [], true)!;
      const option = result.options.find((c) => c.label === constant.name)!;
      expect(option.type).toBe('constant');
      expect(option.info).toContain(constant.description);
      expect(host.querySelector('.token-constant')?.textContent).toBe(constant.name);
    },
  );
  it.each(['pow(2; 3)', 'pow (2; 3)'])('reuses the existing parenthesis in %s', (input) => {
    const { view } = mount({ text: `probe=${input}` });
    const from = 6,
      to = 9;
    const result = completions(new CompletionContext(view.state, to, true), [], true)!;
    const completion = result.options.find((c) => c.label === 'pow')!;
    const apply = completion.apply;
    if (typeof apply === 'function') act(() => apply(view, completion, from, to));
    expect(view.state.doc.toString()).toBe(`probe=${input}`);
    expect(view.state.selection.main.head).toBe(view.state.doc.toString().indexOf('(') + 1);
  });
  it('keeps expression context after a semicolon inside a nested batch call', () => {
    const text = 'probe=pow(2; ma';
    const options = completions(
      new CompletionContext(EditorState.create({ doc: text }), text.length, false),
      [],
      true,
    )!;
    expect(options.options.map((c) => c.label)).toContain('max');
  });
  it.each(['po', 'probe=po'])(
    'suppresses builtins in assignment targets and strings: %s',
    (text) => {
      const pos = text.indexOf('=') < 0 ? text.length : 2;
      const options = completions(
        new CompletionContext(EditorState.create({ doc: text }), pos, true),
        [],
        true,
      );
      expect(options?.options.some((c) => c.type === 'function')).toBe(false);
      const quoted = 'probe="pow';
      expect(
        completions(
          new CompletionContext(EditorState.create({ doc: quoted }), quoted.length, true),
          [],
          true,
        ),
      ).toBeNull();
    },
  );
  it('updates nested signature help and active arguments when the cursor moves', () => {
    const text = 'probe=pow(2; max(3; 4))';
    const { view } = mount({ text });
    const tooltipAt = (pos: number) => {
      act(() => view.dispatch({ selection: { anchor: pos } }));
      return view.state.field(expressionSignatureHelp)[0]?.create(view).dom;
    };
    let dom = tooltipAt(text.indexOf('4'))!;
    expect(dom.querySelector('.expression-signature-label')?.textContent).toBe(
      'max(first; second)',
    );
    expect(dom.querySelector('strong')?.textContent).toBe('second');
    dom = tooltipAt(text.length - 1)!;
    expect(dom.querySelector('strong')?.textContent).toBe('exponent');
    expect(tooltipAt(text.length)).toBeUndefined();
  });
  it('marks confirmed diagnostic ranges and preserves scientific notation', () => {
    mount({ text: 'probe=pow(2, 3) + 1e-3' });
    expect(
      Array.from(host.querySelectorAll('.token-error')).some((token) =>
        token.getAttribute('title')?.includes('semicolon'),
      ),
    ).toBe(true);
    expect(Array.from(host.querySelectorAll('.token-number')).map((n) => n.textContent)).toContain(
      '1e-3',
    );
  });
});
