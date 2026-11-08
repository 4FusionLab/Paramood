// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { EditorView } from '@codemirror/view';
import { currentCompletions, startCompletion } from '@codemirror/autocomplete';
import { App } from './main';
let host: HTMLDivElement;
afterEach(() => {
  if (host) act(() => render(null, host));
  document.body.innerHTML = '';
  delete window.adsk;
  window.location.hash = '';
});
function mount(hash: string, sampledPreview = false) {
  window.location.hash = hash;
  const calls: { action: string; payload: Record<string, unknown> }[] = [];
  window.adsk = {
    fusionSendData: vi.fn((_action, raw) => {
      const data = JSON.parse(raw);
      calls.push(data);
      const response =
        data.action === 'state.get'
          ? { documentId: 'doc', documentName: 'Design', parameters: [] }
          : data.action === 'parameters.preview'
            ? sampledPreview
              ? {
                  valid: true,
                  snapshotToken: 'sample-preview',
                  items: [
                    {
                      name: 'roll',
                      expression: 'random()',
                      value: 0.25,
                      unit: '',
                      status: 'New',
                      estimated: true,
                      message:
                        'Sample value. Fusion will evaluate this expression again when applied.',
                    },
                  ],
                }
              : { valid: false, items: [] }
            : data.action === 'calculator.evaluate'
              ? { value: 5, formatted: '5' }
              : {};
      window.fusionJavaScriptHandler!.handle(
        'response',
        JSON.stringify({ requestId: data.requestId, ok: true, documentId: 'doc', data: response }),
      );
    }),
  };
  host = document.createElement('div');
  document.body.appendChild(host);
  act(() => render(<App />, host));
  return calls;
}
describe('separate palette views', () => {
  it('routes a calculation and then an assignment through one editor', async () => {
    const calls = mount('#parameters');
    await vi.waitFor(() => expect(host.textContent).toContain('Design'));
    const editor = EditorView.findFromDOM(host.querySelector<HTMLElement>('.cm-content')!)!;
    expect(host.querySelector('[aria-label="Calculation history"]')).toBeTruthy();
    act(() => editor.dispatch({ changes: { from: 0, insert: '2+3' } }));
    await vi.waitFor(() =>
      expect(
        calls.some(
          (call) => call.action === 'calculator.evaluate' && call.payload.expression === '2+3',
        ),
      ).toBe(true),
    );
    await vi.waitFor(() => expect(host.textContent).toContain('5'));
    expect(calls.some((call) => call.action === 'parameters.preview')).toBe(false);
    act(() =>
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: '9+9' } }),
    );
    expect(host.querySelector('.result-value')?.textContent).not.toBe('5');
    act(() =>
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: 'width=2+3' } }),
    );
    await vi.waitFor(() =>
      expect(
        calls.some(
          (call) => call.action === 'parameters.preview' && call.payload.text === 'width=2+3',
        ),
      ).toBe(true),
    );
  });
  it('refreshes deleted model parameters on editor focus without losing the draft', async () => {
    if (!Range.prototype.getClientRects)
      Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
    if (!Range.prototype.getBoundingClientRect)
      Range.prototype.getBoundingClientRect = () => new DOMRect();
    let items = [{ name: 'box_size', expression: '10 mm', value: 10, unit: 'mm' }];
    let stateRequests = 0;
    window.location.hash = '#parameters';
    window.adsk = {
      fusionSendData: (_action, raw) => {
        const data = JSON.parse(raw);
        if (data.action === 'state.get') stateRequests++;
        const response =
          data.action === 'state.get'
            ? { documentId: 'doc', documentName: 'Design', parameters: [...items] }
            : { value: 0, unit: '', formatted: '0' };
        window.fusionJavaScriptHandler!.handle(
          'response',
          JSON.stringify({
            requestId: data.requestId,
            ok: true,
            documentId: 'doc',
            data: response,
          }),
        );
      },
    };
    host = document.createElement('div');
    document.body.appendChild(host);
    act(() => render(<App />, host));
    await vi.waitFor(() => expect(host.textContent).toContain('Design'));
    const editor = EditorView.findFromDOM(host.querySelector<HTMLElement>('.cm-content')!)!;
    act(() => editor.dispatch({ changes: { from: 0, insert: 'b' }, selection: { anchor: 1 } }));
    startCompletion(editor);
    await vi.waitFor(() =>
      expect(currentCompletions(editor.state).map((c) => c.label)).toContain('box_size'),
    );
    items = [];
    act(() => {
      editor.contentDOM.dispatchEvent(new FocusEvent('focus'));
    });
    await vi.waitFor(() => expect(stateRequests).toBeGreaterThan(1));
    await vi.waitFor(() =>
      expect(currentCompletions(editor.state).map((c) => c.label)).not.toContain('box_size'),
    );
    expect(editor.state.doc.toString()).toBe('b');
  });
  it('does not expose cleanup in the release interface', async () => {
    mount('#parameters');
    await vi.waitFor(() => expect(host.textContent).toContain('Design'));
    expect(host.textContent).not.toContain('Clean unused');
    expect(host.textContent).not.toContain('Cleanup');
  });
  it('parameters view accepts parameter prefill', async () => {
    const calls = mount('#parameters');
    await vi.waitFor(() => expect(host.textContent).toContain('Design'));
    expect(host.querySelector('[aria-label="Parameter definitions"]')).toBeTruthy();
    expect(host.querySelector('header')).toBeNull();
    expect(host.querySelector('.context [aria-label="Refresh model"]')).toBeNull();
    expect(host.querySelector('[aria-label="Calculator expression"]')).toBeNull();
    expect(calls.some((x) => x.action === 'cleanup.open')).toBe(false);
    act(() => {
      window.fusionJavaScriptHandler!.handle(
        'parameters.prefill',
        JSON.stringify({ text: 'r=5', documentId: 'doc', prefillId: 'one' }),
      );
    });
    const editor = EditorView.findFromDOM(host.querySelector<HTMLElement>('.cm-content')!)!;
    await vi.waitFor(() => expect(editor.state.doc.toString()).toBe('r=5'));
    act(() => {
      window.fusionJavaScriptHandler!.handle(
        'parameters.prefill',
        JSON.stringify({ text: 'r=9', documentId: 'other', prefillId: 'wrong' }),
      );
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(editor.state.doc.toString()).toBe('r=5');
    act(() => {
      window.fusionJavaScriptHandler!.handle(
        'parameters.prefill',
        JSON.stringify({ text: 'r=10', documentId: 'doc', prefillId: 'two' }),
      );
    });
    await vi.waitFor(() => expect(host.textContent).toContain('Replace your current input?'));
    expect(editor.state.doc.toString()).toBe('r=5');
    act(() =>
      Array.from(host.querySelectorAll('button'))
        .find((x) => x.textContent?.includes('Keep current input'))!
        .click(),
    );
    act(() => {
      window.fusionJavaScriptHandler!.handle(
        'parameters.prefill',
        JSON.stringify({ text: 'r=10', documentId: 'doc', prefillId: 'two' }),
      );
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(host.textContent).not.toContain('Replace your current input?');
    expect(editor.state.doc.toString()).toBe('r=5');
    act(() => {
      window.fusionJavaScriptHandler!.handle(
        'parameters.prefill',
        JSON.stringify({ text: 'r=12', documentId: 'doc', prefillId: 'three' }),
      );
    });
    await vi.waitFor(() => expect(host.textContent).toContain('Replace your current input?'));
    act(() =>
      Array.from(host.querySelectorAll('button'))
        .find((x) => x.textContent?.includes('Replace input'))!
        .click(),
    );
    await vi.waitFor(() => expect(editor.state.doc.toString()).toBe('r=12'));
    expect(
      calls.filter((x) => x.action === 'parameters.prefill.ack').length,
    ).toBeGreaterThanOrEqual(3);
    window.adsk = {
      fusionSendData: vi.fn((_action, raw) => {
        const data = JSON.parse(raw);
        if (data.action === 'state.get')
          window.fusionJavaScriptHandler!.handle(
            'response',
            JSON.stringify({
              requestId: data.requestId,
              ok: true,
              data: { documentId: 'other', documentName: 'Other design', parameters: [] },
            }),
          );
      }),
    };
    act(() => {
      window.fusionJavaScriptHandler!.handle('state.changed', '{}');
    });
    await vi.waitFor(() => expect(host.textContent).toContain('Other design'));
    await vi.waitFor(() => expect(editor.state.doc.toString()).toBe(''));
  });
  it('restores the matching document draft after switching away and back', async () => {
    mount('#parameters');
    await vi.waitFor(() => expect(host.textContent).toContain('Design'));
    const editor = EditorView.findFromDOM(host.querySelector<HTMLElement>('.cm-content')!)!;
    act(() => editor.dispatch({ changes: { from: 0, insert: 'draft=12' } }));
    function switchTo(documentId: string, draftId: string, documentName: string) {
      window.adsk = {
        fusionSendData: vi.fn((_action, raw) => {
          const request = JSON.parse(raw);
          if (request.action === 'state.get')
            window.fusionJavaScriptHandler!.handle(
              'response',
              JSON.stringify({
                requestId: request.requestId,
                ok: true,
                data: { documentId, draftId, documentName, parameters: [] },
              }),
            );
        }),
      };
      act(() => {
        window.fusionJavaScriptHandler!.handle('state.changed', '{}');
      });
    }
    switchTo('doc-b', 'doc-b', 'Other');
    await vi.waitFor(() => expect(host.textContent).toContain('Other'));
    expect(editor.state.doc.toString()).toBe('');
    switchTo('doc-a-new-token', 'doc', 'Design');
    await vi.waitFor(() => expect(host.textContent).toContain('Design'));
    await vi.waitFor(() => expect(editor.state.doc.toString()).toBe('draft=12'));
  });
  it('a cleanup hash opens the main view instead', async () => {
    mount('#cleanup');
    await vi.waitFor(() => expect(host.textContent).toContain('Design'));
    expect(host.textContent).not.toContain('Analyze parameters');
    expect(host.querySelector('header')).toBeNull();
    expect(host.querySelector('.context [aria-label="Refresh model"]')).toBeNull();
    expect(host.textContent).not.toContain('Deletion is not available yet');
    expect(host.querySelector('.cm-content')).toBeTruthy();
  });
});

it.each([
  ['20', 'width=20 mm'],
  ['+=5', 'width+=5'],
  ['-=2', 'width-=2'],
  ['*=2', 'width*=2'],
  ['/ = 2', 'width/=2'],
])('applies inline edit %s on Enter with a checked snapshot', async (inputText, submitted) => {
  const calls: { action: string; payload: Record<string, unknown> }[] = [];
  window.adsk = {
    fusionSendData: (_action, raw) => {
      const data = JSON.parse(raw);
      calls.push(data);
      const response =
        data.action === 'state.get'
          ? {
              documentId: 'doc',
              documentName: 'Design',
              parameters: [
                { name: 'width', expression: '10 mm', value: '10 mm', unit: 'mm', kind: 'user' },
              ],
            }
          : data.action === 'parameters.preview'
            ? {
                valid: true,
                snapshotToken: 'token',
                items: [{ name: 'width', status: 'Update', value: 20, unit: 'mm' }],
              }
            : {};
      window.fusionJavaScriptHandler!.handle(
        'response',
        JSON.stringify({ requestId: data.requestId, documentId: 'doc', ok: true, data: response }),
      );
    },
  };
  host = document.createElement('div');
  document.body.appendChild(host);
  act(() => render(<App />, host));
  await vi.waitFor(() => expect(host.textContent).toContain('Design'));
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="Parameter list"]')!.click());
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="Edit value width"]')!.click());
  const input = host.querySelector<HTMLElement>('[aria-label="Expression for width"]')!;
  const inline = EditorView.findFromDOM(input)!;
  expect(input.closest('.tree-row')?.textContent).toContain('width');
  expect(inline.state.doc.toString()).toBe('10');
  expect(document.activeElement).toBe(input);
  expect(inline.state.selection.main.from).toBe(0);
  expect(inline.state.selection.main.to).toBe(2);
  expect(input.closest('.tree-row')?.querySelector('.tree-unit')?.textContent).toBe('mm');
  act(() => {
    inline.dispatch({ changes: { from: 0, to: inline.state.doc.length, insert: inputText } });
  });
  expect(host.textContent).not.toContain('Preview');
  act(() => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  await vi.waitFor(() => expect(calls.some((c) => c.action === 'parameters.apply')).toBe(true));
  await vi.waitFor(() =>
    expect(host.querySelector('[aria-label="Expression for width"]')).toBeNull(),
  );
  expect(host.textContent).not.toContain('Parameter updated.');
  expect(calls.find((c) => c.action === 'parameters.preview')?.payload.text).toBe(submitted);
  expect(calls.find((c) => c.action === 'parameters.apply')?.payload).toEqual({
    text: submitted,
    snapshotToken: 'token',
  });
});

it('shows the Fusion error when deleting a parameter is refused', async () => {
  let deleted = false;
  window.adsk = {
    fusionSendData: (_action, raw) => {
      const data = JSON.parse(raw);
      if (data.action === 'parameters.delete') {
        deleted = data.payload.name === 'width' && data.payload.entityToken === 'identity';
        window.fusionJavaScriptHandler!.handle(
          'response',
          JSON.stringify({
            requestId: data.requestId,
            documentId: 'doc',
            ok: false,
            error: { code: 'DELETE_FAILED', message: 'Fusion refused deletion' },
          }),
        );
      } else {
        window.fusionJavaScriptHandler!.handle(
          'response',
          JSON.stringify({
            requestId: data.requestId,
            documentId: 'doc',
            ok: true,
            data: {
              documentId: 'doc',
              documentName: 'Design',
              parameters: [
                {
                  name: 'width',
                  expression: '10 mm',
                  value: '10 mm',
                  unit: 'mm',
                  kind: 'user',
                  entityToken: 'identity',
                },
              ],
            },
          }),
        );
      }
    },
  };
  host = document.createElement('div');
  document.body.appendChild(host);
  act(() => render(<App />, host));
  await vi.waitFor(() => expect(host.textContent).toContain('Design'));
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="Delete width"]')!.click());
  await vi.waitFor(() => expect(host.textContent).toContain('Fusion refused deletion'));
  expect(deleted).toBe(true);
});

it('keeps the editor mounted during an unchanged state notification', async () => {
  let pending: { requestId: string } | undefined;
  let stateCalls = 0;
  window.adsk = {
    fusionSendData: (_action, raw) => {
      const data = JSON.parse(raw);
      if (data.action !== 'state.get') return;
      stateCalls++;
      if (stateCalls > 1) {
        pending = data;
        return;
      }
      window.fusionJavaScriptHandler!.handle(
        'response',
        JSON.stringify({
          requestId: data.requestId,
          ok: true,
          documentId: 'doc',
          data: { documentId: 'doc', documentName: 'Design', parameters: [] },
        }),
      );
    },
  };
  host = document.createElement('div');
  document.body.appendChild(host);
  act(() => render(<App />, host));
  await vi.waitFor(() => expect(host.textContent).toContain('Design'));
  const editor = host.querySelector('.cm-content');
  act(() => {
    window.fusionJavaScriptHandler!.handle('state.changed', '{}');
  });
  await vi.waitFor(() => expect(pending).toBeDefined());
  expect(host.querySelector('.cm-content')).toBe(editor);
  expect(host.textContent).toContain('Design');
  expect(host.textContent).not.toContain('Connecting to Fusion');
  await act(async () => {
    window.fusionJavaScriptHandler!.handle(
      'response',
      JSON.stringify({
        requestId: pending!.requestId,
        ok: true,
        documentId: 'doc',
        data: { documentId: 'doc', documentName: 'Design', parameters: [] },
      }),
    );
  });
  expect(host.querySelector('.cm-content')).toBe(editor);
});

it('updates changed parameters after a background state notification without resetting the editor', async () => {
  let value = '10 mm';
  window.adsk = {
    fusionSendData: (_action, raw) => {
      const data = JSON.parse(raw);
      const response =
        data.action === 'state.get'
          ? {
              documentId: 'doc',
              documentName: 'Design',
              parameters: [{ name: 'width', kind: 'user', expression: value, value, unit: 'mm' }],
            }
          : { value: 0, unit: '', formatted: '0' };
      window.fusionJavaScriptHandler!.handle(
        'response',
        JSON.stringify({ requestId: data.requestId, ok: true, documentId: 'doc', data: response }),
      );
    },
  };
  host = document.createElement('div');
  document.body.appendChild(host);
  act(() => render(<App />, host));
  await vi.waitFor(() => expect(host.textContent).toContain('10'));
  const editor = host.querySelector('.cm-content');
  value = '20 mm';
  act(() => {
    window.fusionJavaScriptHandler!.handle('state.changed', '{}');
  });
  await vi.waitFor(() => expect(host.textContent).toContain('20'));
  expect(host.querySelector('.cm-content')).toBe(editor);
});

it('keeps the model visible while applying an inline change and receiving a Fusion notification', async () => {
  const pending: { requestId: string }[] = [];
  let initial = true;
  window.adsk = {
    fusionSendData: (_action, raw) => {
      const data = JSON.parse(raw);
      if (data.action === 'state.get' && !initial) {
        pending.push(data);
        return;
      }
      let response: unknown = {};
      if (data.action === 'state.get') {
        initial = false;
        response = {
          documentId: 'doc',
          documentName: 'Design',
          parameters: [
            { name: 'width', expression: '10 mm', value: '10 mm', unit: 'mm', kind: 'user' },
          ],
        };
      }
      if (data.action === 'parameters.preview')
        response = {
          valid: true,
          snapshotToken: 'token',
          items: [{ name: 'width', status: 'Update', value: 20, unit: 'mm' }],
        };
      window.fusionJavaScriptHandler!.handle(
        'response',
        JSON.stringify({ requestId: data.requestId, documentId: 'doc', ok: true, data: response }),
      );
      if (data.action === 'parameters.apply')
        window.fusionJavaScriptHandler!.handle('state.changed', '{}');
    },
  };
  host = document.createElement('div');
  document.body.appendChild(host);
  act(() => render(<App />, host));
  await vi.waitFor(() => expect(host.textContent).toContain('Design'));
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="Parameter list"]')!.click());
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="Edit value width"]')!.click());
  const input = host.querySelector<HTMLElement>('[aria-label="Expression for width"]')!;
  const inline = EditorView.findFromDOM(input)!;
  act(() => {
    inline.dispatch({ changes: { from: 0, to: inline.state.doc.length, insert: '20' } });
  });
  act(() => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  await vi.waitFor(() => expect(pending.length).toBeGreaterThan(0));
  expect(host.textContent).toContain('Design');
  expect(host.textContent).toContain('width');
  expect(host.textContent).not.toContain('Connecting to Fusion');
  await act(async () => {
    for (const request of pending)
      window.fusionJavaScriptHandler!.handle(
        'response',
        JSON.stringify({
          requestId: request.requestId,
          documentId: 'doc',
          ok: true,
          data: {
            documentId: 'doc',
            documentName: 'Design',
            parameters: [
              { name: 'width', expression: '20 mm', value: '20 mm', unit: 'mm', kind: 'user' },
            ],
          },
        }),
      );
  });
  await vi.waitFor(() => expect(host.textContent).toContain('20'));
});

it('creates a parameter and links the edited value in one checked transaction', async () => {
  const calls: { action: string; payload: Record<string, unknown> }[] = [];
  window.adsk = {
    fusionSendData: (_action, raw) => {
      const data = JSON.parse(raw);
      calls.push(data);
      const result =
        data.action === 'state.get'
          ? {
              documentId: 'doc',
              documentName: 'Design',
              parameters: [
                { name: 'width', expression: '10 mm', value: '10 mm', unit: 'mm', kind: 'user' },
              ],
            }
          : data.action === 'parameters.preview'
            ? {
                valid: true,
                snapshotToken: 'snapshot',
                items: [
                  { name: 'x', status: 'New', expression: '25 mm' },
                  { name: 'width', status: 'Update', expression: 'x' },
                ],
              }
            : {};
      window.fusionJavaScriptHandler!.handle(
        'response',
        JSON.stringify({ requestId: data.requestId, documentId: 'doc', ok: true, data: result }),
      );
    },
  };
  host = document.createElement('div');
  document.body.appendChild(host);
  act(() => render(<App />, host));
  await vi.waitFor(() => expect(host.textContent).toContain('Design'));
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="Parameter list"]')!.click());
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="Edit value width"]')!.click());
  const content = host.querySelector<HTMLElement>('[aria-label="Expression for width"]')!;
  const view = EditorView.findFromDOM(content)!;
  act(() => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'x=25' } }));
  act(() => {
    content.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
  });
  await vi.waitFor(() => expect(calls.some((c) => c.action === 'parameters.apply')).toBe(true));
  expect(calls.find((c) => c.action === 'parameters.preview')?.payload.text).toBe(
    'x=25 mm;width=x',
  );
  expect(calls.find((c) => c.action === 'parameters.apply')?.payload).toEqual({
    text: 'x=25 mm;width=x',
    snapshotToken: 'snapshot',
    requireTransaction: true,
  });
});

it('creates an unknown bare name from the current precise value and checks it before applying', async () => {
  const calls: { action: string; payload: Record<string, unknown> }[] = [];
  window.adsk = {
    fusionSendData: (_action, raw) => {
      const request = JSON.parse(raw);
      calls.push(request);
      const data =
        request.action === 'state.get'
          ? {
              documentId: 'doc',
              documentName: 'Design',
              parameters: [
                {
                  name: 'width',
                  expression: '10 mm',
                  value: '10 mm',
                  valueExpression: '1.0000000123 cm',
                  unit: 'mm',
                  kind: 'user',
                },
              ],
            }
          : request.action === 'parameters.preview'
            ? {
                valid: true,
                snapshotToken: 'token',
                items: [
                  { name: 'x', status: 'New', expression: '1.0000000123 cm' },
                  { name: 'width', status: 'Update', expression: 'x' },
                ],
              }
            : {};
      window.fusionJavaScriptHandler!.handle(
        'response',
        JSON.stringify({ requestId: request.requestId, documentId: 'doc', ok: true, data }),
      );
    },
  };
  host = document.createElement('div');
  document.body.appendChild(host);
  act(() => render(<App />, host));
  await vi.waitFor(() => expect(host.textContent).toContain('Design'));
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="Parameter list"]')!.click());
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="Edit value width"]')!.click());
  const content = host.querySelector<HTMLElement>('[aria-label="Expression for width"]')!;
  const editor = EditorView.findFromDOM(content)!;
  act(() => editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: 'x' } }));
  act(() => {
    content.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
  });
  await vi.waitFor(() => expect(calls.some((c) => c.action === 'parameters.apply')).toBe(true));
  expect(calls.find((c) => c.action === 'parameters.preview')?.payload).toEqual({
    text: 'x=1.0000000123 cm;width=x',
    sourceName: 'width',
    sourceValueExpression: '1.0000000123 cm',
  });
  expect(calls.find((c) => c.action === 'parameters.apply')?.payload.requireTransaction).toBe(true);
});

it('applies a solved inline equation as one checked transaction', async () => {
  const calls: { action: string; payload: Record<string, unknown> }[] = [];
  window.adsk = {
    fusionSendData: (_action, raw) => {
      const request = JSON.parse(raw);
      calls.push(request);
      const data =
        request.action === 'state.get'
          ? {
              documentId: 'doc',
              documentName: 'Design',
              parameters: [
                {
                  name: 'depth',
                  expression: '10 mm',
                  value: '10 mm',
                  valueExpression: '1.0 cm',
                  unit: 'mm',
                  kind: 'user',
                },
              ],
            }
          : request.action === 'parameters.preview'
            ? {
                valid: true,
                snapshotToken: 'token',
                resolvedText: 'width=-250.0 mm;depth=-width/5',
                newName: 'width',
                items: [
                  { name: 'width', status: 'New', expression: '-250.0 mm' },
                  { name: 'depth', status: 'Update', expression: '-width/5' },
                ],
              }
            : {};
      window.fusionJavaScriptHandler!.handle(
        'response',
        JSON.stringify({ requestId: request.requestId, documentId: 'doc', ok: true, data }),
      );
    },
  };
  host = document.createElement('div');
  document.body.appendChild(host);
  act(() => render(<App />, host));
  await vi.waitFor(() => expect(host.textContent).toContain('Design'));
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="Parameter list"]')!.click());
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="Edit value depth"]')!.click());
  const content = host.querySelector<HTMLElement>('[aria-label="Expression for depth"]')!;
  const editor = EditorView.findFromDOM(content)!;
  act(() =>
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: '-width/5=50' } }),
  );
  act(() => {
    content.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
  });
  await vi.waitFor(() => expect(calls.some((c) => c.action === 'parameters.apply')).toBe(true));
  expect(calls.find((c) => c.action === 'parameters.preview')?.payload.inlineEquation).toEqual({
    target: 'depth',
    expression: '-width/5=50',
  });
  expect(calls.find((c) => c.action === 'parameters.apply')?.payload).toEqual({
    text: 'width=-250.0 mm;depth=-width/5',
    snapshotToken: 'token',
    requireTransaction: true,
  });
});

describe('hybrid palette', () => {
  it('defaults to a parameter list with one universal field and a dismissible result panel', async () => {
    mount('#parameters');
    await vi.waitFor(() => expect(host.textContent).toContain('Design'));
    expect(host.querySelector('[aria-label="Hybrid"]')?.getAttribute('aria-selected')).toBe('true');
    expect(host.querySelector('.view-hybrid .list-pane .parameter-list')).toBeTruthy();
    expect(host.querySelectorAll('[aria-label="Parameter definitions"]')).toHaveLength(1);
    const editor = EditorView.findFromDOM(
      host.querySelector<HTMLElement>('[aria-label="Parameter definitions"]')!,
    )!;
    act(() => editor.dispatch({ changes: { from: 0, insert: '2+3' } }));
    await vi.waitFor(() =>
      expect(host.querySelector('.feedback-sheet .result-value')?.textContent).toBe('5'),
    );
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Close result panel"]')!.click());
    expect(host.querySelector('.feedback-sheet')).toBeNull();
    expect(editor.state.doc.toString()).toBe('2+3');
    act(() => host.querySelector<HTMLButtonElement>('.reopen-result')!.click());
    expect(host.querySelector('.feedback-sheet')).toBeTruthy();
  });
  it('changes model units using the current document snapshot', async () => {
    const calls: { action: string; payload: Record<string, unknown> }[] = [];
    let unit = 'mm';
    window.adsk = {
      fusionSendData: (_action, raw) => {
        const request = JSON.parse(raw);
        calls.push(request);
        if (request.action === 'document.units') unit = request.payload.unit;
        window.fusionJavaScriptHandler!.handle(
          'response',
          JSON.stringify({
            requestId: request.requestId,
            ok: true,
            documentId: 'doc',
            data:
              request.action === 'state.get'
                ? {
                    documentId: 'doc',
                    documentName: 'Design',
                    defaultLengthUnit: unit,
                    unitsSnapshotToken: 'units-snapshot',
                    parameters: [],
                  }
                : {},
          }),
        );
      },
    };
    host = document.createElement('div');
    document.body.appendChild(host);
    act(() => render(<App />, host));
    await vi.waitFor(() => expect(host.querySelector('.model-context .model-unit')).toBeTruthy());
    const select = host.querySelector<HTMLSelectElement>('[aria-label="Model length units"]')!;
    act(() => {
      select.value = 'in';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await vi.waitFor(() =>
      expect(
        calls.some(
          (call) =>
            call.action === 'document.units' &&
            call.payload.unit === 'in' &&
            call.payload.snapshotToken === 'units-snapshot',
        ),
      ).toBe(true),
    );
    await vi.waitFor(() => expect(select.value).toBe('in'));
  });
});

describe('copy result fallback', () => {
  it('copies the actual result without waiting for the embedded Clipboard API', async () => {
    const previous = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const writeText = vi.fn(() => new Promise<void>(() => {}));
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    let copied = '';
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn((command: string) => {
        if (command === 'copy') copied = (document.activeElement as HTMLTextAreaElement).value;
        return true;
      }),
    });
    try {
      mount('#parameters');
      await vi.waitFor(() => expect(host.textContent).toContain('Design'));
      const editor = EditorView.findFromDOM(
        host.querySelector<HTMLElement>('[aria-label="Parameter definitions"]')!,
      )!;
      act(() => editor.dispatch({ changes: { from: 0, insert: '2+3' } }));
      await vi.waitFor(() => expect(host.querySelector('.result-value')?.textContent).toBe('5'));
      act(() =>
        host.querySelector<HTMLButtonElement>('[aria-label="Copy value and unit"]')!.click(),
      );
      await vi.waitFor(() => expect(copied).toBe('5'));
      await vi.waitFor(() => expect(host.textContent).toContain('Copied to clipboard.'));
      expect(writeText).not.toHaveBeenCalled();
    } finally {
      if (previous) Object.defineProperty(navigator, 'clipboard', previous);
      else Reflect.deleteProperty(navigator, 'clipboard');
      Reflect.deleteProperty(document, 'execCommand');
    }
  });
});

it('automatically dismisses a success toast after 3.5 seconds', async () => {
  Object.defineProperty(document, 'execCommand', { configurable: true, value: () => true });
  const previous = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
  try {
    mount('#parameters');
    await vi.waitFor(() => expect(host.textContent).toContain('Design'));
    const editor = EditorView.findFromDOM(
      host.querySelector<HTMLElement>('[aria-label="Parameter definitions"]')!,
    )!;
    act(() => editor.dispatch({ changes: { from: 0, insert: '2+3' } }));
    await vi.waitFor(() => expect(host.querySelector('.result-value')?.textContent).toBe('5'));
    vi.useFakeTimers();
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="Copy value and unit"]')!.click();
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(host.textContent).toContain('Copied to clipboard.');
    expect(host.textContent).not.toContain('Copy number');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3600);
    });
    expect(host.textContent).not.toContain('Copied to clipboard.');
  } finally {
    vi.useRealTimers();
    Reflect.deleteProperty(document, 'execCommand');
    if (previous) Object.defineProperty(navigator, 'clipboard', previous);
    else Reflect.deleteProperty(navigator, 'clipboard');
  }
});

it('waits for complete function calls before native Preview or Calculate requests', async () => {
  const calls = mount('#parameters');
  await vi.waitFor(() => expect(host.textContent).toContain('Design'));
  const editor = EditorView.findFromDOM(host.querySelector<HTMLElement>('.cm-content')!)!;
  for (const text of ['probe=po', 'probe=pow()', 'pow(2;']) {
    act(() => editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: text } }));
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(
      calls.some(
        (call) => call.action === 'parameters.preview' || call.action === 'calculator.evaluate',
      ),
    ).toBe(false);
  }
  act(() =>
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: 'probe=pow(2;3)' },
    }),
  );
  await vi.waitFor(() =>
    expect(calls.some((call) => call.action === 'parameters.preview')).toBe(true),
  );
});

it('shows sampled previews and applies the original random expression', async () => {
  const calls = mount('#parameters', true);
  await vi.waitFor(() => expect(host.textContent).toContain('Design'));
  const editor = EditorView.findFromDOM(host.querySelector<HTMLElement>('.cm-content')!)!;
  act(() => editor.dispatch({ changes: { from: 0, insert: 'roll=random()' } }));
  await vi.waitFor(() => expect(host.textContent).toContain('≈ 0.25'));
  expect(host.querySelector('.preview-note')?.textContent).toContain('Sample value');
  const apply = Array.from(host.querySelectorAll('button')).find((b) =>
    b.textContent?.includes('Apply parameters'),
  )!;
  expect(apply.disabled).toBe(false);
  act(() => apply.click());
  await vi.waitFor(() =>
    expect(
      calls.some(
        (c) =>
          c.action === 'parameters.apply' &&
          c.payload.text === 'roll=random()' &&
          c.payload.snapshotToken === 'sample-preview',
      ),
    ).toBe(true),
  );
});
