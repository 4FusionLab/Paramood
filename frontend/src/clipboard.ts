/** Copy during the click gesture in Fusion's embedded browser.
 * Its Clipboard API can remain pending indefinitely; never start it there or race
 * it against a fallback, since a late write could overwrite a newer clipboard.
 */
export async function copyText(value: string): Promise<void> {
  if (
    !window.adsk?.fusionSendData &&
    location.protocol !== 'file:' &&
    navigator.clipboard?.writeText
  ) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Use the current user gesture to copy through the editable document.
    }
  }
  const focused = document.activeElement;
  const inputSelection =
    focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement
      ? {
          start: focused.selectionStart,
          end: focused.selectionEnd,
          direction: focused.selectionDirection,
        }
      : undefined;
  const selection = document.getSelection();
  const ranges = selection
    ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange())
    : [];
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.readOnly = true;
  textarea.setAttribute('aria-hidden', 'true');
  textarea.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0';
  document.body.appendChild(textarea);
  try {
    textarea.focus({ preventScroll: true });
    textarea.select();
    if (!document.execCommand?.('copy'))
      throw new Error('Clipboard is unavailable. Select the result and copy it with the keyboard.');
  } finally {
    textarea.remove();
    if (focused instanceof HTMLElement) focused.focus({ preventScroll: true });
    if (
      inputSelection &&
      (focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement) &&
      inputSelection.start !== null &&
      inputSelection.end !== null
    )
      focused.setSelectionRange(
        inputSelection.start,
        inputSelection.end,
        inputSelection.direction ?? undefined,
      );
    if (selection) {
      selection.removeAllRanges();
      for (const range of ranges) selection.addRange(range);
    }
  }
}
