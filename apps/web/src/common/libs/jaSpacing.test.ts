import { isJaSpaced, jaTextProps } from '@common/libs/jaSpacing'

describe('isJaSpaced (JLP-864)', () => {
  it('treats Japanese with spaces between words as spaced', () => {
    expect(isJaSpaced('かんこくから 来ました。いまは 大学で')).toBe(true)
  })

  it('keeps unspaced Japanese and the full-width fill-in blank unspaced', () => {
    expect(
      isJaSpaced('読み終わらなかった場合は、（　）、ほかの人が予約している。')
    ).toBe(false)
    expect(isJaSpaced(' 前後だけ空白 ')).toBe(false)
    expect(isJaSpaced('')).toBe(false)
    expect(isJaSpaced(null)).toBe(false)
  })

  it('marks only spaced text for the keep-words rule', () => {
    expect(jaTextProps('日本の えいが')).toEqual({
      lang: 'ja',
      'data-ja-spaced': true
    })
    expect(jaTextProps('日本の映画')).toEqual({ lang: 'ja' })
  })
})
