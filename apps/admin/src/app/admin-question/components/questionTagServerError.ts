/** Admin text key for a save rejected because of its tags, or null. */
export const getTagServerErrorKey = (
  error: unknown
): 'editor.tagPicker.subjectMismatch' | 'errors.fieldInvalid' | null => {
  if (!(error instanceof Error)) return null
  // The server names a tag from another subject with this code (JLP-733).
  if ('code' in error && error.code === 'TAG_SUBJECT_MISMATCH')
    return 'editor.tagPicker.subjectMismatch'
  const fieldErrors =
    'fieldErrors' in error
      ? (error.fieldErrors as Partial<Record<string, readonly string[]>>)
      : undefined
  return fieldErrors?.tagNames?.length ? 'errors.fieldInvalid' : null
}
