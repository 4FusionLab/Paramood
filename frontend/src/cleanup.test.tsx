// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { App } from './main';
import type { CleanupItem } from './bridge';
import { keptDependencyOwner, updateCleanupSelection } from './cleanup-selection';

let host: HTMLDivElement;
afterEach(() => {
  if (host) act(() => render(null, host));
  document.body.innerHTML = '';
  delete window.adsk;
  window.location.hash = '';
});
const candidate = (name: string, dependencies: string[] = []): CleanupItem => ({
  name,
  dependencies,
  expression: dependencies[0] ?? '10 mm',
  value: 10,
  unit: 'mm',
  selected: true,
  protected: false,
  favorite: false,
  reason: 'Unused parameter',
});
const items = [
  { ...candidate('base'), value: '20.00 mm' },
  candidate('half', ['base']),
  candidate('spare'),
];
function mount(options: { rejectDelete?: boolean; pendingAnalyze?: boolean } = {}) {
  window.location.hash = '#cleanup';
  let documentId = 'doc';
  const calls: {
    action: string;
    payload: Record<string, unknown>;
    requestId: string;
    documentId?: string;
  }[] = [];
  const respond = (data: (typeof calls)[number], response: unknown, responseDoc = documentId) => {
    window.fusionJavaScriptHandler!.handle(
      'response',
      JSON.stringify({
        requestId: data.requestId,
        documentId: responseDoc,
        ok: true,
        data: response,
      }),
    );
  };
  window.adsk = {
    fusionSendData: vi.fn((_action, raw) => {
      const data = JSON.parse(raw) as (typeof calls)[number];
      calls.push(data);
      if (data.action === 'state.get')
        respond(data, { documentId, documentName: documentId, parameters: [] });
      else if (data.action === 'cleanup.analyze') {
        if (!options.pendingAnalyze) respond(data, { items, snapshot: 'snapshot-' + documentId });
      } else if (options.rejectDelete && data.action === 'cleanup.delete') {
        window.fusionJavaScriptHandler!.handle(
          'response',
          JSON.stringify({
            requestId: data.requestId,
            documentId,
            ok: false,
            error: { code: 'CONFLICT', message: 'Preview changed. Analyze again.' },
          }),
        );
      } else respond(data, {});
    }),
  };
  host = document.createElement('div');
  document.body.appendChild(host);
  act(() => render(<App />, host));
  return {
    calls,
    respond,
    switchDocument(id: string) {
      documentId = id;
      act(() => {
        window.fusionJavaScriptHandler!.handle('state.changed', '{}');
      });
    },
  };
}
function button(text: string) {
  return Array.from(host.querySelectorAll('button')).find(
    (element) => element.textContent === text,
  )!;
}
function check(name: string) {
  const element = host.querySelector<HTMLInputElement>(`[aria-label="Delete ${name}"]`)!;
  act(() => element.click());
}
it('keeps transitive inputs when a candidate is excluded, including cycles', () => {
  const original = [
    candidate('a', ['b']),
    candidate('b', ['c']),
    candidate('c', ['a']),
    candidate('free'),
  ];
  const result = updateCleanupSelection(original, 'a', false);
  expect(result.filter((item) => item.selected).map((item) => item.name)).toEqual(['free']);
  expect(original.every((item) => item.selected)).toBe(true);
  expect(keptDependencyOwner(result, 'c')).toBe('a');
});
it('analyzes on entry without deleting and sends only checked candidates with its snapshot after confirmation', async () => {
  const { calls } = mount();
  await vi.waitFor(() => expect(host.textContent).toContain('3 selected'));
  expect(calls.filter((call) => call.action === 'cleanup.analyze')).toHaveLength(1);
  expect(host.querySelector('main')!.classList.contains('hybrid-palette')).toBe(false);
  const baseText = host.querySelector('[aria-label="Delete base"]')!.closest('label')!.textContent;
  expect(baseText).toContain('20.00 mm');
  expect(baseText).not.toContain('20.00 mm mm');
  check('half');
  expect(host.textContent).toContain('1 selected');
  expect(host.querySelector<HTMLInputElement>('[aria-label="Delete base"]')!.disabled).toBe(true);
  expect(host.textContent).toContain('Required by kept parameter half');
  expect(calls.some((call) => call.action === 'cleanup.delete')).toBe(false);
  act(() => button('Delete selected…').click());
  expect(calls.some((call) => call.action === 'cleanup.delete')).toBe(false);
  act(() => button('Delete parameters').click());
  await vi.waitFor(() => expect(calls.some((call) => call.action === 'cleanup.delete')).toBe(true));
  expect(calls.find((call) => call.action === 'cleanup.delete')).toMatchObject({
    documentId: 'doc',
    payload: { names: ['spare'], snapshot: 'snapshot-doc' },
  });
});
it('selects and deselects all candidates without changing the model', async () => {
  const { calls } = mount();
  await vi.waitFor(() => expect(host.textContent).toContain('3 selected'));
  act(() => button('Deselect all').click());
  expect(host.textContent).toContain('0 selected');
  expect(button('Delete selected…').disabled).toBe(true);
  act(() => button('Select all').click());
  expect(host.textContent).toContain('3 selected');
  expect(calls.some((call) => call.action === 'cleanup.delete')).toBe(false);
});
it('discards a rejected preview and requires a fresh analysis', async () => {
  const { calls } = mount({ rejectDelete: true });
  await vi.waitFor(() => expect(host.textContent).toContain('3 selected'));
  act(() => button('Delete selected…').click());
  act(() => button('Delete parameters').click());
  await vi.waitFor(() => expect(host.textContent).toContain('Preview changed. Analyze again.'));
  expect(host.querySelector('[aria-label="Delete spare"]')).toBeNull();
  expect(calls.filter((call) => call.action === 'cleanup.analyze')).toHaveLength(1);
  act(() => button('Refresh preview').click());
  await vi.waitFor(() => expect(host.textContent).toContain('3 selected'));
});
it('ignores delayed analysis for a different document and analyzes the new document', async () => {
  const { calls, respond, switchDocument } = mount({ pendingAnalyze: true });
  await vi.waitFor(() =>
    expect(calls.filter((call) => call.action === 'cleanup.analyze')).toHaveLength(1),
  );
  const old = calls.find((call) => call.action === 'cleanup.analyze')!;
  switchDocument('next');
  await vi.waitFor(() => expect(host.textContent).toContain('next'));
  await act(async () => respond(old, { items: [candidate('old-only')], snapshot: 'old' }, 'doc'));
  await vi.waitFor(() =>
    expect(calls.filter((call) => call.action === 'cleanup.analyze')).toHaveLength(2),
  );
  expect(host.textContent).not.toContain('old-only');
  const current = calls.filter((call) => call.action === 'cleanup.analyze')[1];
  await act(async () =>
    respond(current, { items: [candidate('new-only')], snapshot: 'new' }, 'next'),
  );
  await vi.waitFor(() => expect(host.textContent).toContain('new-only'));
  expect(host.textContent).not.toContain('old-only');
});
