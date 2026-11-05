// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { EditorView } from '@codemirror/view';
import { App } from './main';

afterEach(() => {
  delete window.adsk;
  document.body.innerHTML = '';
});
describe('out-of-order previews', () => {
  it('never displays or authorizes an older preview after the input changes', async () => {
    if (!Range.prototype.getClientRects)
      Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
    if (!Range.prototype.getBoundingClientRect)
      Range.prototype.getBoundingClientRect = () => new DOMRect();
    const pending: { requestId: string; payload: { text: string } }[] = [];
    const applyRequests: { payload: { text: string; snapshotToken: string } }[] = [];
    let stateRequests = 0;
    window.adsk = {
      fusionSendData: vi.fn((_action, raw) => {
        const data = JSON.parse(raw);
        if (data.action === 'state.get') {
          const respond = () =>
            window.fusionJavaScriptHandler!.handle(
              'response',
              JSON.stringify({
                requestId: data.requestId,
                ok: true,
                data: {
                  documentId: 'doc',
                  documentName: 'Test',
                  defaultLengthUnit: 'mm',
                  parameters: [],
                },
              }),
            );
          if (++stateRequests === 1) respond();
          else setTimeout(respond, 100);
        }
        if (data.action === 'parameters.preview') pending.push(data);
        if (data.action === 'parameters.apply') {
          applyRequests.push(data);
          window.fusionJavaScriptHandler!.handle(
            'response',
            JSON.stringify({
              requestId: data.requestId,
              documentId: 'doc',
              ok: false,
              error: { code: 'STALE_PREVIEW', message: 'The design has changed.' },
            }),
          );
          window.fusionJavaScriptHandler!.handle('state.changed', '{}');
        }
      }),
    };
    const host = document.createElement('div');
    document.body.appendChild(host);
    act(() => render(<App />, host));
    await vi.waitFor(() => expect(host.textContent).toContain('Test'));
    const content = host.querySelector<HTMLElement>('.cm-content')!;
    const editor = EditorView.findFromDOM(content)!;
    act(() => editor.dispatch({ changes: { from: 0, insert: 'w=1' } }));
    await vi.waitFor(() => expect(pending.length).toBe(1), { timeout: 2000 });
    act(() => editor.dispatch({ changes: { from: 2, to: 3, insert: '2' } }));
    await vi.waitFor(() => expect(pending.length).toBe(2), { timeout: 2000 });
    const respond = (i: number, value: number) =>
      window.fusionJavaScriptHandler!.handle(
        'response',
        JSON.stringify({
          requestId: pending[i].requestId,
          documentId: 'doc',
          ok: true,
          data: {
            valid: true,
            snapshotToken: `snapshot-${i}`,
            items: [
              { name: 'w', expression: pending[i].payload.text, value, unit: 'mm', status: 'New' },
            ],
          },
        }),
      );
    act(() => {
      respond(1, 2);
    });
    await vi.waitFor(() => expect(host.textContent).toContain('2 mm'));
    act(() => {
      respond(0, 1);
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(host.textContent).toContain('2 mm');
    expect(host.textContent).not.toContain('1 mm');
    const apply = Array.from(host.querySelectorAll('button')).find((x) =>
      x.textContent?.includes('Apply parameters'),
    )!;
    expect(apply.disabled).toBe(false);
    act(() => apply.click());
    await vi.waitFor(() => expect(applyRequests).toHaveLength(1));
    expect(applyRequests[0].payload).toEqual({ text: 'w=2', snapshotToken: 'snapshot-1' });
    await vi.waitFor(() => expect(host.textContent).toContain('Review the refreshed preview'));
    act(() => {
      window.fusionJavaScriptHandler!.handle('state.changed', '{}');
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(host.textContent).toContain('Review the refreshed preview');
    await vi.waitFor(() => expect(pending.length).toBe(3), { timeout: 2000 });
    expect(apply.disabled).toBe(true);
    act(() => render(null, host));
  });
});
