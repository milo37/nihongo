import { getTagServerErrorKey } from '@app/admin-question/components/questionTagServerError'

const apiError = (
  fieldErrors?: Record<string, string[]>,
  code = 'VALIDATION_ERROR'
): Error =>
  Object.assign(new Error(code), {
    code,
    ...(fieldErrors ? { fieldErrors } : {})
  })

describe('getTagServerErrorKey', () => {
  it('names the subject mismatch by its error code', () => {
    expect(
      getTagServerErrorKey(
        apiError(
          { tagNames: ['태그 과목이 문제 과목과 같아야 합니다.'] },
          'TAG_SUBJECT_MISMATCH'
        )
      )
    ).toBe('editor.tagPicker.subjectMismatch')
    expect(
      getTagServerErrorKey(apiError(undefined, 'TAG_SUBJECT_MISMATCH'))
    ).toBe('editor.tagPicker.subjectMismatch')
  })

  it('falls back to the field message for other tag rejections', () => {
    expect(
      getTagServerErrorKey(
        apiError({ tagNames: ['모든 태그는 태그 목록에 있어야 합니다.'] })
      )
    ).toBe('errors.fieldInvalid')
    // The sentence alone no longer decides the mismatch.
    expect(
      getTagServerErrorKey(
        apiError({ tagNames: ['태그 과목이 문제 과목과 같아야 합니다.'] })
      )
    ).toBe('errors.fieldInvalid')
  })

  it('ignores errors without a tag field error', () => {
    expect(getTagServerErrorKey(apiError())).toBeNull()
    expect(getTagServerErrorKey(apiError({ questionText: ['x'] }))).toBeNull()
    expect(getTagServerErrorKey(null)).toBeNull()
  })
})
