import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReactElement, RefObject } from 'react'
import type { FuriganaSegment } from '@nihongo/contracts/question/get-question'
import type { PassageAudioRef } from '@nihongo/contracts/question/passage-audio'
import { paragraphRuby } from '@app/practice/session/passageFurigana'
import { passageParagraphs } from '@app/practice/session/passageParagraphs'
import { setFurigana, useFurigana } from '@app/practice/session/useFurigana'
import type { QuestionPush } from '@app/practice/session/components/PracticeQuestionCard'
import { PassageAudioBar } from '@app/practice/session/passageAudio/PassageAudioBar'
import { PlayIcon } from '@app/practice/session/passageAudio/passageAudioIcons'
import { paragraphMark } from '@app/practice/session/passageAudio/paragraphMark'
import { usePassageAudio } from '@app/practice/session/passageAudio/usePassageAudio'
import { SheetTail } from '@common/components/manuscript/ManuscriptSheet'
import { JaText } from '@common/components/JaText'
import { jaTextProps } from '@common/libs/jaSpacing'
import { SamePassageNote } from '@app/practice/components/SamePassageNote'
import { useToast } from '@nihongo/browser/common/components/Toast'

/**
 * Passage: as tall as its text; sticky beside the question on wide screens.
 * JLP-865 r2: no box, so it shares the question's left line; one head row
 * (the tail mark is the only red) and one block per source line.
 */
export const QuestionPassage = ({
  furigana,
  isDecorative,
  isSamePassage,
  passage,
  passageAudio,
  passageRef,
  push
}: {
  furigana: readonly FuriganaSegment[] | null | undefined
  isDecorative: boolean
  /** #986: the question before has this passage; fold it to three lines. */
  isSamePassage: boolean
  passage: string
  /** #1183: the read-aloud file; null hides [듣기]. */
  passageAudio: PassageAudioRef | null
  passageRef: RefObject<HTMLElement | null>
  push: QuestionPush | undefined
}): ReactElement => {
  const { t } = useTranslation('practice')
  const isFuriganaOn = useFurigana()
  // #1182: [] (no kanji) and null (not reviewed yet) both have no readings.
  const hasFurigana = Boolean(furigana?.length)
  const textId = useId()
  // #986: folded until opened; the card remounts this per question, so the
  // next same-passage question folds again.
  const [isOpened, setOpened] = useState(false)
  const isSame = isSamePassage && !isDecorative
  const isFolded = isSame && !isOpened
  // A passage that fits in three lines has nothing to open.
  const [isClipped, setClipped] = useState(true)
  const textRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const text = textRef.current
    if (!isFolded || !text || typeof ResizeObserver === 'undefined') return
    const measure = (): void => {
      if (text.clientHeight > 0)
        setClipped(text.scrollHeight > text.clientHeight + 1)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(text)
    return () => observer.disconnect()
  }, [isFolded, isFuriganaOn])
  const { addToast } = useToast()
  // #1246: one warning per failure; [듣기] stays and waits, then retries.
  const audio = usePassageAudio(isDecorative ? null : passageAudio, () =>
    addToast({
      key: 'passage-audio-failed',
      title: t('session.question.audio.failedTitle'),
      description: t('session.question.audio.failedDescription'),
      variant: 'warning'
    })
  )
  const audioRowId = useId()
  const hasAudio = Boolean(passageAudio) && !isDecorative
  const revealRef = useRef(false)
  // #1183: after a drag or key move, show the reading word once if it is off
  // screen (or under the fixed action bar). No follow while it plays.
  useEffect(() => {
    if (!revealRef.current) return
    revealRef.current = false
    const word = passageRef.current?.querySelector('.study-read-mark')
    if (!word) return
    const box = word.getBoundingClientRect()
    const seen = document.elementFromPoint(
      box.left + box.width / 2,
      box.top + box.height / 2
    )
    if (seen && word.contains(seen)) return
    const reduceMotion = window.matchMedia?.(
      '(prefers-reduced-motion: reduce)'
    ).matches
    word.scrollIntoView({
      behavior: reduceMotion ? 'auto' : 'smooth',
      block: 'center'
    })
  })
  return (
    <article
      ref={passageRef}
      aria-label={isDecorative ? undefined : t('session.question.passageLabel')}
      role={isDecorative ? 'presentation' : undefined}
      className="study-push scroll-mt-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand lg:sticky lg:top-6 lg:max-h-[calc(100vh-140px)] lg:overflow-y-auto"
      data-push={push}
      tabIndex={isDecorative ? undefined : 0}
    >
      <p className="study-passage-head">
        <SheetTail side="left" />
        {t('session.question.passageLabel')}
        {hasAudio ? (
          <button
            aria-controls={audio.isOpen ? audioRowId : undefined}
            aria-disabled={audio.isWaiting || undefined}
            aria-expanded={audio.isOpen}
            className="study-audio-toggle"
            type="button"
            onClick={
              audio.isOpen
                ? audio.close
                : () => {
                    // Waiting after a failure: the press does nothing and
                    // no second warning appears.
                    if (audio.isWaiting) return
                    // #986: the reading word must be visible, so a folded
                    // passage opens with the bar and stays open after it.
                    setOpened(true)
                    audio.open()
                  }
            }
          >
            <span>
              {audio.isOpen ? null : <PlayIcon />}
              {t(
                audio.isOpen
                  ? 'session.question.audio.close'
                  : 'session.question.audio.listen'
              )}
            </span>
          </button>
        ) : null}
        <button
          aria-label={t('session.question.furiganaLabel')}
          aria-pressed={hasFurigana && isFuriganaOn}
          className="study-furigana-toggle"
          disabled={!hasFurigana}
          type="button"
          onClick={() => setFurigana(!isFuriganaOn)}
        >
          <span aria-hidden="true" className="study-furigana-box" />
          {/* Only the word is Japanese; the name is read in the UI language. */}
          <span lang="ja">ふりがな</span>
        </button>
      </p>
      {hasAudio && audio.isOpen ? (
        <PassageAudioBar
          audio={audio}
          id={audioRowId}
          onSeekEnd={() => {
            revealRef.current = true
          }}
        />
      ) : null}
      {isFuriganaOn && !hasFurigana ? (
        <p className="study-furigana-none">
          {t('session.question.furiganaNone')}
        </p>
      ) : null}
      {isSame ? (
        <SamePassageNote
          text={t('session.question.samePassage')}
          tone="practice"
        />
      ) : null}
      <div
        ref={textRef}
        id={textId}
        className="study-passage-text tracking-[0.02em] text-ink"
        data-folded={isFolded || undefined}
        {...jaTextProps(passage)}
      >
        {passageParagraphs(passage).map((paragraph, index) => (
          <p
            key={`${index}-${paragraph.text}`}
            data-indent={paragraph.indent || undefined}
          >
            <JaText
              mark={paragraphMark(paragraph, audio.word)}
              ruby={
                isFuriganaOn && furigana
                  ? paragraphRuby(paragraph, furigana)
                  : undefined
              }
              text={paragraph.text}
            />
          </p>
        ))}
      </div>
      {isFolded && isClipped ? (
        <button
          aria-controls={textId}
          aria-expanded={false}
          className="study-passage-open"
          type="button"
          onClick={() => {
            setOpened(true)
            // The button goes away; keep focus on the passage, not the page.
            passageRef.current?.focus({ preventScroll: true })
          }}
        >
          <span>{t('session.question.openPassage')}</span>
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <path
              d="M2.5 4.5 6 8l3.5-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      ) : null}
    </article>
  )
}
