import { isJaSpaced, jaLineSegments, jaTextProps } from '@common/libs/jaSpacing'

describe('isJaSpaced (JLP-864, JLP-868)', () => {
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

  it('ignores spaces next to numbers and symbols in a notice', () => {
    expect(
      isJaSpaced(
        '① 料理教室　毎週土曜日 10:00〜12:00　1回 1,000円（材料費込み）'
      )
    ).toBe(false)
  })

  it('keeps a notice with only a spaced heading unspaced', () => {
    expect(
      isJaSpaced(
        'ひかり市 市民講座「地域の歴史を歩く」受講者募集\n' +
          'ひかり市では、地域の歴史や文化について学ぶ市民講座を開きます。' +
          '講座では、市内に残る古い建物や記録を手がかりに、町の成り立ちを考えます。' +
          '毎回、講師による説明のあとに、参加者同士で話し合う時間を設けています。'
      )
    ).toBe(false)
  })

  it('keeps word-order items spaced around the blanks', () => {
    expect(
      isJaSpaced(
        '彼の演奏には、＿＿ ★ ＿＿ ＿＿ 力があった。　★に入るものはどれですか。'
      )
    ).toBe(true)
    expect(isJaSpaced('この部屋は ＿＿ ＿＿ ★ ＿＿ いい。')).toBe(true)
  })

  it('switches to unspaced once word spaces are removed (JLP-867)', () => {
    expect(isJaSpaced('日本の 会社で 働きたいと 思って います。')).toBe(true)
    expect(isJaSpaced('日本の会社で働きたいと思っています。')).toBe(false)
  })

  it('marks only spaced text for the keep-words rule', () => {
    expect(jaTextProps('日本の えいが')).toEqual({
      lang: 'ja',
      'data-ja-spaced': true
    })
    expect(jaTextProps('日本の映画')).toEqual({ lang: 'ja' })
  })
})

describe('jaLineSegments (JLP-865)', () => {
  it('holds brackets and marks with their neighbours', () => {
    expect(jaLineSegments('ざっしを「よみました」。「よみました」を')).toEqual([
      'ざっしを',
      '「よ',
      'みまし',
      'た」。',
      '',
      '「よ',
      'みまし',
      'た」',
      'を'
    ])
  })

  it('holds a fill-in blank with the 。 after it', () => {
    expect(jaLineSegments('水を 飲む（　）。前より')).toEqual([
      '水を 飲む',
      '（　）。',
      '前より'
    ])
  })

  it('holds ー and a full-width space after a mark', () => {
    expect(jaLineSegments('タクシーで 行く。\u3000★に入る')).toEqual([
      'タク',
      'シー',
      'で 行',
      'く。\u3000',
      '★に入る'
    ])
  })

  it('leaves text without marks whole', () => {
    expect(jaLineSegments('日本の 映画')).toEqual(['日本の 映画'])
  })
})
