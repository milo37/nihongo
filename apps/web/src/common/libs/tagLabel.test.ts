import { getTagLabelInLocale } from '@common/libs/tagLabel'

const named = { id: 'tag-1', label: '조사', labelJa: '助詞' }
const koreanOnly = { id: 'tag-2', label: '경어' }
const blankJapanese = { id: 'tag-3', label: '수량사', labelJa: '  ' }

describe('getTagLabelInLocale', () => {
  it('gives no Korean name on a Japanese screen', () => {
    expect(getTagLabelInLocale(named, 'ja')).toBe('助詞')
    expect(getTagLabelInLocale(koreanOnly, 'ja')).toBeNull()
    expect(getTagLabelInLocale(blankJapanese, 'ja')).toBeNull()
    expect(getTagLabelInLocale(koreanOnly, 'ko')).toBe('경어')
  })
})
