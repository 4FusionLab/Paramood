import { describe, expect, it } from 'vitest';
import { canApplyPreview } from './guards';
describe('preview safety', () => {
  it('rejects an old response after the user edits or switches documents', () => {
    const preview = { valid: true, text: 'width=15', documentId: 'first', snapshotToken: 'v1' };
    expect(canApplyPreview(preview, 'width=15', 'first')).toBe(true);
    expect(canApplyPreview({ ...preview, snapshotToken: '' }, 'width=15', 'first')).toBe(false);
    expect(canApplyPreview(preview, 'width=20', 'first')).toBe(false);
    expect(canApplyPreview(preview, 'width=15', 'second')).toBe(false);
    expect(canApplyPreview(preview, 'width=15', null)).toBe(false);
  });
});
