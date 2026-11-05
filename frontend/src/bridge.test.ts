// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { request } from './bridge';
afterEach(() => {
  delete window.adsk;
});
describe('Fusion bridge correlation', () => {
  it('rejects a response from a different document', async () => {
    window.adsk = {
      fusionSendData: vi.fn((_action, raw) => {
        const { requestId } = JSON.parse(raw);
        window.fusionJavaScriptHandler!.handle(
          'response',
          JSON.stringify({ requestId, ok: true, documentId: 'other', data: {} }),
        );
      }),
    };
    await expect(request('parameters.preview', { text: 'w=1' }, 'original')).rejects.toThrow(
      'active document changed',
    );
  });
  it('matches concurrent responses by request ID, not arrival order', async () => {
    const outgoing: string[] = [];
    window.adsk = {
      fusionSendData: vi.fn((_action, raw) => {
        outgoing.push(JSON.parse(raw).requestId);
      }),
    };
    const first = request<{ value: number }>('calculator.evaluate', {}, 'doc');
    const second = request<{ value: number }>('calculator.evaluate', {}, 'doc');
    window.fusionJavaScriptHandler!.handle(
      'response',
      JSON.stringify({ requestId: outgoing[1], documentId: 'doc', ok: true, data: { value: 2 } }),
    );
    window.fusionJavaScriptHandler!.handle(
      'response',
      JSON.stringify({ requestId: outgoing[0], documentId: 'doc', ok: true, data: { value: 1 } }),
    );
    expect(await first).toEqual({ value: 1 });
    expect(await second).toEqual({ value: 2 });
  });
});

describe('Fusion bridge readiness', () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  it('waits for delayed injection before sending the request', async () => {
    vi.useFakeTimers();
    const result = request<{ value: number }>('state.get');
    await vi.advanceTimersByTimeAsync(300);
    window.adsk = {
      fusionSendData: vi.fn((_action, raw) => {
        const { requestId } = JSON.parse(raw);
        window.fusionJavaScriptHandler!.handle(
          'response',
          JSON.stringify({ requestId, ok: true, data: { value: 7 } }),
        );
      }),
    };
    await vi.advanceTimersByTimeAsync(50);
    await expect(result).resolves.toEqual({ value: 7 });
    expect(window.adsk.fusionSendData).toHaveBeenCalledOnce();
  });
  it('reports a clear error when the bridge never arrives', async () => {
    vi.useFakeTimers();
    const result = request('state.get');
    const expectation = expect(result).rejects.toThrow('Could not connect to Autodesk Fusion');
    await vi.advanceTimersByTimeAsync(5000);
    await expectation;
  });
});
