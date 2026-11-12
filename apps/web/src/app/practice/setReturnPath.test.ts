import { getSetReturnPath } from '@app/practice/setReturnPath'

describe('getSetReturnPath (JLP-856)', () => {
  it('returns wrong-note and bookmark sets to their list', () => {
    expect(getSetReturnPath('DAILY_REVIEW')).toBe('/wrong-notes')
    expect(getSetReturnPath('WRONG_NOTE')).toBe('/wrong-notes')
    expect(getSetReturnPath('BOOKMARK')).toBe('/bookmarks')
  })

  it('keeps random and weakness sets without a list', () => {
    expect(getSetReturnPath('RANDOM')).toBeNull()
    expect(getSetReturnPath('WEAKNESS')).toBeNull()
  })
})
