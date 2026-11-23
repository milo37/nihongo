import { paragraphMark } from '@app/practice/session/passageAudio/paragraphMark'
import { passageParagraphs } from '@app/practice/session/passageParagraphs'

const markedText = (passage: string, start: number, length: number) =>
  passageParagraphs(passage).map((paragraph) => {
    const mark = paragraphMark(paragraph, { time: 0, start, length })
    return mark ? paragraph.text.slice(mark.from, mark.to) : null
  })

describe('paragraphMark (#1183)', () => {
  it('moves the passage word into its paragraph', () => {
    expect(markedText('四月に\n  花見。', 6, 2)).toEqual([null, '花見'])
  })

  it('counts a letter outside the BMP as one code point', () => {
    expect(markedText('𠮟る先生', 2, 2)).toEqual(['先生'])
  })

  it('splits a word that runs over a line break', () => {
    expect(markedText('雨だ\n晴れ', 1, 3)).toEqual(['だ', '晴'])
  })

  it('marks nothing without a word', () => {
    const [paragraph] = passageParagraphs('雨')
    expect(paragraphMark(paragraph!, null)).toBeUndefined()
  })
})
