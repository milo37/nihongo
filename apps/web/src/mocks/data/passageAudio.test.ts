import { passageAudioRefSchema } from '@nihongo/contracts/question/passage-audio'
import {
  mockPassageAudio,
  mockPassageAudioMarks
} from '@mocks/data/passageAudio'
import { mockFuriganaPassages } from '@mocks/data/passageFurigana'

describe('mock passage audio (#1183)', () => {
  it('gives each reviewed passage a contract-shaped key with its timings', () => {
    const [passage] = mockFuriganaPassages()
    const audio = passageAudioRefSchema.parse(mockPassageAudio(passage!))
    expect(mockPassageAudioMarks(audio.key)?.durationMs).toBe(audio.durationMs)
  })

  it('has none for other passages', () => {
    expect(mockPassageAudio('音声のない文章です。')).toBeNull()
    expect(mockPassageAudio(null)).toBeNull()
  })
})
