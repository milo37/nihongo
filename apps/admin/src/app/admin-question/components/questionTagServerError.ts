// The server rejects a mismatched tag with this tagNames field error (JLP-733).
const SUBJECT_MISMATCH_FIELD_ERROR = '태그 과목이 문제 과목과 같아야 합니다.'

/** Admin text key for a save rejected because of its tags, or null. */
export const getTagServerErrorKey = (
  error: unknown
): 'editor.tagPicker.subjectMismatch' | 'errors.fieldInvalid' | null => {
  const fieldErrors =
    error instanceof Error && 'fieldErrors' in error
      ? (error.fieldErrors as Partial<Record<string, readonly string[]>>)
      : undefined
  const messages = fieldErrors?.tagNames
  if (!messages?.length) return null
  return messages.includes(SUBJECT_MISMATCH_FIELD_ERROR)
    ? 'editor.tagPicker.subjectMismatch'
    : 'errors.fieldInvalid'
}
