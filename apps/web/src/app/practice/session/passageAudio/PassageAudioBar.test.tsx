import { createRef } from 'react'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PassageAudioRef } from '@nihongo/contracts/question/passage-audio'
import type { StudyQuestionView } from '@app/practice/adapters/studySessionView'
import { PracticeQuestionCard } from '@app/practice/session/components/PracticeQuestionCard'
import { I18nProvider } from '@nihongo/browser/provider/I18nProvider'
import { writeUiLocalePreference } from '@nihongo/browser/libs/localeStorage'
import { clearStorageCache } from '@nihongo/browser/libs/storage'

const AUDIO: PassageAudioRef = { key: 'a'.repeat(64), durationMs: 53_000 }

const question = (passageAudio: PassageAudioRef | null): StudyQuestionView => ({
  id: 'q1',
  sessionQuestionId: null,
  questionVersionId: null,
  ordinal: 1,
  level: 'N5',
  subject: 'READING',
  questionType: 'SHORT_READING',
  passage: '今日は雨です。',
  passageFurigana: null,
  passageAudio,
  questionText: '天気は何ですか。',
  options: ['a', 'b', 'c', 'd'].map((id, index) => ({
    id,
    label: (['1', '2', '3', '4'] as const)[index]!,
    text: id
  })),
  difficulty: 'EASY',
  tags: []
})

const card = (audio: PassageAudioRef | null) => (
  <I18nProvider>
    <PracticeQuestionCard
      actions={null}
      bookmarkStatus={null}
      headingRef={createRef()}
      isOptionsDisabled={false}
      onSelectOption={() => undefined}
      question={question(audio)}
      questionNumber={1}
      saveStatus={null}
      selectedOptionId={undefined}
    />
  </I18nProvider>
)

// jsdom has no media playback: play and pause flip `paused` and fire events.
const paused = new WeakMap<HTMLMediaElement, boolean>()
beforeAll(() => {
  Object.defineProperty(HTMLMediaElement.prototype, 'paused', {
    configurable: true,
    get(this: HTMLMediaElement) {
      return paused.get(this) ?? true
    }
  })
  HTMLMediaElement.prototype.play = function play(this: HTMLMediaElement) {
    paused.set(this, false)
    this.dispatchEvent(new Event('play'))
    return Promise.resolve()
  }
  HTMLMediaElement.prototype.pause = function pause(this: HTMLMediaElement) {
    paused.set(this, true)
    this.dispatchEvent(new Event('pause'))
  }
  HTMLMediaElement.prototype.load = () => undefined
})

describe('passage read-aloud bar (#1183)', () => {
  beforeEach(() => {
    writeUiLocalePreference('ko')
    clearStorageCache()
  })

  it('has no [듣기] when the passage has no audio', () => {
    render(card(null))
    expect(screen.queryByRole('button', { name: '듣기' })).toBeNull()
  })

  it('opens playing, pauses, and closes', async () => {
    const user = userEvent.setup()
    render(card(AUDIO))
    const listen = screen.getByRole('button', { name: '듣기' })
    expect(listen).toHaveAttribute('aria-expanded', 'false')

    await user.click(listen)
    const close = screen.getByRole('button', { name: '닫기' })
    expect(close).toHaveAttribute('aria-expanded', 'true')
    const slider = screen.getByRole('slider', { name: '재생 위치' })
    expect(slider).toHaveAttribute('aria-valuetext', '0:00')
    // The question's length shows before the timings file arrives.
    expect(slider).toHaveAttribute('aria-valuemax', '53')
    expect(close).toHaveAttribute(
      'aria-controls',
      slider.closest('.study-audio-row')?.id
    )

    await user.click(screen.getByRole('button', { name: '멈춤' }))
    expect(screen.getByRole('button', { name: '재생' })).toBeInTheDocument()

    await user.click(close)
    expect(screen.queryByRole('slider')).toBeNull()
    expect(screen.getByRole('button', { name: '듣기' })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
  })

  it('steps the speed and names it', async () => {
    const user = userEvent.setup()
    render(card(AUDIO))
    await user.click(screen.getByRole('button', { name: '듣기' }))
    const row = screen.getByRole('slider').closest('.study-audio-row')!
    await user.click(
      within(row as HTMLElement).getByRole('button', { name: '속도 1배' })
    )
    expect(
      screen.getByRole('button', { name: '속도 1.25배' })
    ).toHaveTextContent('1.25×')
    expect(screen.getByRole('button', { name: '처음부터' })).toBeInTheDocument()
  })

  it('plays from the start only once the jump back has landed', async () => {
    const user = userEvent.setup()
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play')
    render(card(AUDIO))
    await user.click(screen.getByRole('button', { name: '듣기' }))
    const audio = play.mock.contexts[0] as HTMLMediaElement
    await user.click(screen.getByRole('button', { name: '멈춤' }))
    play.mockClear()

    // WebKit may play from the old spot if play() follows the jump at once.
    await user.click(screen.getByRole('button', { name: '처음부터' }))
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuetext', '0:00')
    expect(play).not.toHaveBeenCalled()

    act(() => {
      audio.dispatchEvent(new Event('seeked'))
    })
    expect(play).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '멈춤' })).toBeInTheDocument()
    play.mockRestore()
  })
})
