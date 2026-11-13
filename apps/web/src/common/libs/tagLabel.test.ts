import { getTagLabel, getTagLabelInLocale } from '@common/libs/tagLabel'

const named = { id: 'tag-1', label: '조사', labelJa: '助詞' }
const koreanOnly = { id: 'tag-2', label: '경어' }
const blankJapanese = { id: 'tag-3', label: '수량사', labelJa: '  ' }

describe('getTagLabel', () => {
  it('uses the Japanese name on a Japanese screen and the Korean one otherwise', () => {
    expect(getTagLabel(named, 'ja')).toBe('助詞')
    expect(getTagLabel(named, 'ko')).toBe('조사')
  })

  it('falls back to the Korean name when there is no Japanese one', () => {
    expect(getTagLabel(koreanOnly, 'ja')).toBe('경어')
    expect(getTagLabel({ ...named, labelJa: null }, 'ja')).toBe('조사')
    expect(getTagLabel(blankJapanese, 'ja')).toBe('수량사')
  })
})

describe('getTagLabelInLocale', () => {
  it('gives no Korean name on a Japanese screen', () => {
    expect(getTagLabelInLocale(named, 'ja')).toBe('助詞')
    expect(getTagLabelInLocale(koreanOnly, 'ja')).toBeNull()
    expect(getTagLabelInLocale(blankJapanese, 'ja')).toBeNull()
    expect(getTagLabelInLocale(koreanOnly, 'ko')).toBe('경어')
  })
})
