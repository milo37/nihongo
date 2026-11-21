import { paragraphRuby } from '@app/practice/session/passageFurigana'
import { passageParagraphs } from '@app/practice/session/passageParagraphs'

const rubyOf = (
  passage: string,
  segments: Array<{ start: number; length: number; reading: string }>
) =>
  passageParagraphs(passage).map((paragraph) =>
    paragraphRuby(paragraph, segments).map(
      ({ from, to, reading }) => `${paragraph.text.slice(from, to)}|${reading}`
    )
  )

describe('paragraphRuby (#1182)', () => {
  it('moves passage code points into each paragraph', () => {
    expect(
      rubyOf('四月に\n\n  花見。', [
        { start: 0, length: 2, reading: 'しがつ' },
        { start: 7, length: 2, reading: 'はなみ' }
      ])
    ).toEqual([['四月|しがつ'], ['花見|はなみ']])
  })

  it('counts a letter outside the BMP as one code point', () => {
    expect(
      rubyOf('𠮟る先生', [
        { start: 0, length: 1, reading: 'しか' },
        { start: 2, length: 2, reading: 'せんせい' }
      ])
    ).toEqual([['𠮟|しか', '先生|せんせい']])
  })

  it('keeps full-width digits and neighbouring groups apart', () => {
    expect(
      rubyOf('４月の三十日', [
        { start: 0, length: 2, reading: 'しがつ' },
        { start: 3, length: 1, reading: 'さん' },
        { start: 4, length: 1, reading: 'じゅう' },
        { start: 5, length: 1, reading: 'にち' }
      ])
    ).toEqual([['４月|しがつ', '三|さん', '十|じゅう', '日|にち']])
  })

  it('drops a group over a cut space, past the end or over the last one', () => {
    expect(
      rubyOf(' 雨。\n空', [
        { start: 0, length: 2, reading: 'あめ' },
        { start: 1, length: 1, reading: 'あめ' },
        { start: 1, length: 1, reading: 'あめ' },
        { start: 4, length: 3, reading: 'そら' },
        { start: 4, length: 1, reading: 'そら' }
      ])
    ).toEqual([['雨|あめ'], ['空|そら']])
  })
})
