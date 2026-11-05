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
function mount(hash: string) {
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
            ? { valid: false, items: [] }
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
    expect(host.querySelector('.context [aria-label="Refresh model"]')).toBeTruthy();
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
    expect(host.querySelector('.context [aria-label="Refresh model"]')).toBeTruthy();
    expect(host.textContent).not.toContain('Deletion is not available yet');
    expect(host.querySelector('.cm-content')).toBeTruthy();
  });
});
