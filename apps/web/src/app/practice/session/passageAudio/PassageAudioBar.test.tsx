import { createRef } from 'react'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PassageAudioRef } from '@nihongo/contracts/question/passage-audio'
import type { StudyQuestionView } from '@app/practice/adapters/studySessionView'
import { PracticeQuestionCard } from '@app/practice/session/components/PracticeQuestionCard'
import { I18nProvider } from '@nihongo/browser/provider/I18nProvider'
import { ToastProvider } from '@nihongo/browser/common/components/Toast'
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
    <ToastProvider>
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
    </ToastProvider>
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

describe('passage read-aloud failure (#1246)', () => {
  beforeEach(() => {
    writeUiLocalePreference('ko')
    clearStorageCache()
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  const setup = () =>
    userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) })
  const listen = () => screen.getByRole('button', { name: '듣기' })
  const warning = () =>
    within(screen.getByRole('region', { name: '알림' })).queryAllByText(
      '음성을 불러오지 못했어요'
    )

  it('a file that will not load warns once, keeps [듣기] waiting, then retries', async () => {
    const user = setup()
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play')
    render(card(AUDIO))
    await user.click(listen())
    const first = play.mock.contexts[0] as HTMLMediaElement
    // 404 or the network gone: the element reports an error.
    act(() => {
      first.dispatchEvent(new Event('error'))
    })
    expect(screen.queryByRole('slider')).toBeNull()
    expect(listen()).toHaveAttribute('aria-disabled', 'true')
    expect(listen()).toHaveAttribute('aria-expanded', 'false')
    expect(warning()).toHaveLength(1)

    // Pressing while it waits does nothing and warns no more.
    await user.click(listen())
    expect(screen.queryByRole('slider')).toBeNull()
    expect(warning()).toHaveLength(1)
    expect(play).toHaveBeenCalledTimes(1)

    act(() => {
      vi.advanceTimersByTime(10_000)
    })
    expect(listen()).not.toHaveAttribute('aria-disabled')
    // The retry loads the file again and plays.
    await user.click(listen())
    expect(play).toHaveBeenCalledTimes(2)
    expect(play.mock.contexts[1]).not.toBe(first)
    expect(screen.getByRole('slider')).toBeInTheDocument()
  })

  it('a refused play fails the same way, and waits longer the second time', async () => {
    const user = setup()
    const play = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockRejectedValue(new DOMException('no source', 'NotSupportedError'))
    render(card(AUDIO))
    await user.click(listen())
    expect(await screen.findByText('음성을 불러오지 못했어요')).toBeVisible()
    expect(listen()).toHaveAttribute('aria-disabled', 'true')

    act(() => {
      vi.advanceTimersByTime(10_000)
    })
    await user.click(listen())
    await vi.waitFor(() =>
      expect(listen()).toHaveAttribute('aria-disabled', 'true')
    )
    act(() => {
      vi.advanceTimersByTime(10_000)
    })
    // The second wait is 30 seconds.
    expect(listen()).toHaveAttribute('aria-disabled', 'true')
    act(() => {
      vi.advanceTimersByTime(20_000)
    })
    expect(listen()).not.toHaveAttribute('aria-disabled')
    expect(play).toHaveBeenCalledTimes(2)
  })

  it('a failure while playing closes the bar', async () => {
    const user = setup()
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play')
    render(card(AUDIO))
    await user.click(listen())
    const audio = play.mock.contexts[0] as HTMLMediaElement
    expect(screen.getByRole('button', { name: '멈춤' })).toBeInTheDocument()
    act(() => {
      audio.dispatchEvent(new Event('error'))
    })
    expect(screen.queryByRole('slider')).toBeNull()
    expect(listen()).toHaveAttribute('aria-disabled', 'true')
    expect(warning()).toHaveLength(1)
  })

  it('a play the browser holds back (autoplay rules) is not a failure', async () => {
    const user = setup()
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(
      new DOMException('needs a tap', 'NotAllowedError')
    )
    render(card(AUDIO))
    await user.click(screen.getByRole('button', { name: '듣기' }))
    expect(screen.getByRole('slider')).toBeInTheDocument()
    expect(screen.queryByText('음성을 불러오지 못했어요')).toBeNull()
  })
})
