// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { EditorView } from '@codemirror/view';
import { App } from './main';
import type { ModelState } from './bridge';

let host: HTMLDivElement;
afterEach(() => {
  act(() => render(null, host));
  host.remove();
  delete window.adsk;
});

function simulateFusion(initial: ModelState) {
  let active = initial;
  let readError = '';
  const calls: { action: string; documentId?: string }[] = [];
  window.adsk = {
    fusionSendData: (_type, raw) => {
      const request = JSON.parse(raw);
      calls.push(request);
      if (request.action === 'document.switchToParametric') {
        active = { ...active, isDirect: false, defaultLengthUnit: 'mm' };
      }
      const state = request.action === 'state.get';
      window.fusionJavaScriptHandler!.handle(
        'response',
        JSON.stringify({
          requestId: request.requestId,
          ok: !state || !readError,
          error: state && readError ? { code: 'OPERATION_FAILED', message: readError } : undefined,
          data: state ? active : {},
        }),
      );
    },
  };
  host = document.createElement('div');
  document.body.appendChild(host);
  act(() => render(<App />, host));
  return {
    calls,
    activate(model: ModelState, error = '') {
      active = model;
      readError = error;
      act(() => {
        window.fusionJavaScriptHandler!.handle('state.changed', '{}');
      });
    },
  };
}

const feeder = { documentId: 'feeder', draftId: 'draft', documentName: 'Feeder', parameters: [] };
const directExport = {
  documentId: 'export',
  documentName: 'Export document',
  isDirect: true,
  parameters: [],
};

it('shows a neutral action on a Direct export and restores the original draft on return', async () => {
  const fusion = simulateFusion(feeder);
  await vi.waitFor(() => expect(host.textContent).toContain('Feeder'));
  const editor = EditorView.findFromDOM(host.querySelector<HTMLElement>('.cm-content')!)!;
  act(() => editor.dispatch({ changes: { from: 0, insert: 'width=12' } }));

  fusion.activate(directExport);
  await vi.waitFor(() => expect(host.textContent).toContain('Export document'));
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.textContent).toContain('Switch To Parametric');

  fusion.activate({ ...feeder, documentId: 'feeder-returned' });
  await vi.waitFor(() => expect(host.textContent).toContain('Feeder'));
  expect(host.textContent).not.toContain('Switch To Parametric');
  expect(editor.state.doc.toString()).toBe('width=12');
  expect(fusion.calls.some((call) => call.action === 'document.switchToParametric')).toBe(false);
});

it('switches the active Direct design only after clicking the toast button', async () => {
  const fusion = simulateFusion(directExport);
  const switchButton = () =>
    Array.from(host.querySelectorAll('button')).find(
      (b) => b.textContent === 'Switch To Parametric',
    );
  await vi.waitFor(() => expect(switchButton()).toBeTruthy());
  act(() => switchButton()!.click());
  await vi.waitFor(() => expect(switchButton()).toBeUndefined());
  expect(fusion.calls).toContainEqual(
    expect.objectContaining({ action: 'document.switchToParametric', documentId: 'export' }),
  );
  expect(host.querySelector('[aria-label="Model length units"]')).toBeTruthy();
});

it('clears a state read error on a successful refresh of the same draft', async () => {
  const fusion = simulateFusion(feeder);
  await vi.waitFor(() => expect(host.textContent).toContain('Feeder'));

  fusion.activate(feeder, 'Fusion state read failed');
  await vi.waitFor(() =>
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Fusion state read failed'),
  );

  fusion.activate({ ...feeder, documentId: 'feeder-returned' });
  await vi.waitFor(() => expect(host.textContent).toContain('Feeder'));
  expect(host.querySelector('[role="alert"]')).toBeNull();
});
