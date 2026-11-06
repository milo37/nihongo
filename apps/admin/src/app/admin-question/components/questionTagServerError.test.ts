import { getTagServerErrorKey } from '@app/admin-question/components/questionTagServerError'

const apiError = (fieldErrors?: Record<string, string[]>): Error =>
  Object.assign(new Error('VALIDATION_ERROR'), {
    code: 'VALIDATION_ERROR',
    ...(fieldErrors ? { fieldErrors } : {})
  })

describe('getTagServerErrorKey', () => {
  it('names the subject mismatch the server reports on tagNames', () => {
    expect(
      getTagServerErrorKey(
        apiError({ tagNames: ['태그 과목이 문제 과목과 같아야 합니다.'] })
      )
    ).toBe('editor.tagPicker.subjectMismatch')
  })

  it('falls back to the field message for other tag rejections', () => {
    expect(
      getTagServerErrorKey(
        apiError({ tagNames: ['모든 태그는 태그 목록에 있어야 합니다.'] })
      )
    ).toBe('errors.fieldInvalid')
  })

  it('ignores errors without a tag field error', () => {
    expect(getTagServerErrorKey(apiError())).toBeNull()
    expect(getTagServerErrorKey(apiError({ questionText: ['x'] }))).toBeNull()
    expect(getTagServerErrorKey(null)).toBeNull()
  })
})
