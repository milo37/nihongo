import { formatAudioTime } from '@app/practice/session/passageAudio/passageAudioFormat'
import {
  nextAudioRate,
  wordAt
} from '@app/practice/session/passageAudio/passageAudioTime'

describe('passage audio time (#1183)', () => {
  it('shows minutes and two-digit seconds, rounded down', () => {
    expect(formatAudioTime(0)).toBe('0:00')
    expect(formatAudioTime(12_999)).toBe('0:12')
    expect(formatAudioTime(53_000)).toBe('0:53')
    expect(formatAudioTime(125_400)).toBe('2:05')
  })

  it('finds the last word that has started', () => {
    const words = [
      { time: 100, start: 0, length: 2 },
      { time: 400, start: 2, length: 1 },
      { time: 900, start: 3, length: 3 }
    ]
    expect(wordAt(words, 0)).toBeNull()
    expect(wordAt(words, 100)).toBe(words[0])
    expect(wordAt(words, 899)).toBe(words[1])
    expect(wordAt(words, 5000)).toBe(words[2])
    expect(wordAt([], 500)).toBeNull()
  })

  it('steps the speed 1 → 1.25 → 0.75 → 1', () => {
    expect(nextAudioRate(1)).toBe(1.25)
    expect(nextAudioRate(1.25)).toBe(0.75)
    expect(nextAudioRate(0.75)).toBe(1)
  })
})
