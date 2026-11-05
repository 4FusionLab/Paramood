/** Only a preview computed for the current input and active document can authorize a change. */
export function canApplyPreview(
  preview: { valid: boolean; text: string; documentId: string; snapshotToken: string } | null,
  text: string,
  documentId: string | null,
): boolean {
  return (
    !!preview &&
    preview.valid &&
    typeof preview.snapshotToken === 'string' &&
    preview.snapshotToken.length > 0 &&
    !!documentId &&
    preview.documentId === documentId &&
    preview.text === text
  );
}
