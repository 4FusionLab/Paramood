// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from './clipboard';
const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
afterEach(() => {
  if (original) Object.defineProperty(navigator, 'clipboard', original);
  else Reflect.deleteProperty(navigator, 'clipboard');
  Reflect.deleteProperty(document, 'execCommand');
  document.body.innerHTML = '';
});
describe('clipboard fallback', () => {
  it('writes the exact formatted value with the modern API', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    await copyText('30 mm');
    expect(writeText).toHaveBeenCalledWith('30 mm');
  });
  it('falls back when access is denied and restores the focused editor', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('Denied')) },
    });
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    let actual = '';
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        actual = (document.activeElement as HTMLTextAreaElement).value;
        return true;
      }),
    });
    await copyText('30 mm');
    expect(actual).toBe('30 mm');
    expect(document.activeElement).toBe(input);
    expect(document.querySelector('textarea')).toBeNull();
  });
  it('reports failure rather than showing false success if both paths fail', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: () => false });
    await expect(copyText('30 mm')).rejects.toThrow('Clipboard is unavailable');
    expect(document.querySelector('textarea')).toBeNull();
  });
});

describe('Fusion clipboard', () => {
  afterEach(() => {
    delete window.adsk;
  });
  it('copies synchronously without starting a potentially pending WebView write', async () => {
    const writeText = vi.fn(() => new Promise<void>(() => {}));
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    window.adsk = { fusionSendData: vi.fn() };
    const input = document.createElement('textarea');
    input.value = '25 mm+5 mm';
    document.body.appendChild(input);
    input.focus();
    input.setSelectionRange(2, 7, 'backward');
    const exec = vi.fn(() => {
      expect((document.activeElement as HTMLTextAreaElement).value).toBe('30.00 mm');
      return true;
    });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: exec });
    const copying = copyText('30.00 mm');
    expect(exec).toHaveBeenCalledWith('copy');
    expect(writeText).not.toHaveBeenCalled();
    await copying;
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd, input.selectionDirection]).toEqual([
      2,
      7,
      'backward',
    ]);
    expect(document.querySelectorAll('textarea')).toHaveLength(1);
  });
  it('restores a contenteditable selection even when copy throws', async () => {
    window.adsk = { fusionSendData: vi.fn() };
    const editor = document.createElement('div');
    editor.contentEditable = 'true';
    editor.tabIndex = 0;
    editor.textContent = '25 mm+5 mm';
    document.body.appendChild(editor);
    editor.focus();
    const range = document.createRange();
    range.setStart(editor.firstChild!, 2);
    range.setEnd(editor.firstChild!, 6);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(range);
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: () => {
        throw new Error('Copy denied');
      },
    });
    await expect(copyText('30.00 mm')).rejects.toThrow('Copy denied');
    expect(document.activeElement).toBe(editor);
    const restored = document.getSelection()!.getRangeAt(0);
    expect(restored.startContainer).toBe(editor.firstChild);
    expect([restored.startOffset, restored.endOffset]).toEqual([2, 6]);
    expect(document.querySelector('textarea')).toBeNull();
  });
  it('reports an embedded-browser refusal without trying the asynchronous API', async () => {
    window.adsk = { fusionSendData: vi.fn() };
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: () => false });
    await expect(copyText('30.00 mm')).rejects.toThrow('Clipboard is unavailable');
    expect(writeText).not.toHaveBeenCalled();
  });
});

it('uses synchronous copying for a local palette before the Fusion bridge is injected', async () => {
  const writeText = vi.fn(() => new Promise<void>(() => {}));
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  const exec = vi.fn(() => true);
  Object.defineProperty(document, 'execCommand', { configurable: true, value: exec });
  vi.stubGlobal('location', new URL('file:///Paramood/frontend/dist/index.html'));
  try {
    await copyText('30.00 mm');
    expect(exec).toHaveBeenCalledWith('copy');
    expect(writeText).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});
