import { useEffect, useId, useRef } from 'react'
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

/**
 * Passage: as tall as its text; sticky beside the question on wide screens.
 * JLP-865 r2: no box, so it shares the question's left line; one head row
 * (the tail mark is the only red) and one block per source line.
 */
export const QuestionPassage = ({
  furigana,
  isDecorative,
  passage,
  passageAudio,
  passageRef,
  push
}: {
  furigana: readonly FuriganaSegment[] | null | undefined
  isDecorative: boolean
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
  const audio = usePassageAudio(isDecorative ? null : passageAudio)
  const audioRowId = useId()
  const hasAudio = Boolean(passageAudio) && !isDecorative && !audio.isFailed
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
            aria-expanded={audio.isOpen}
            className="study-audio-toggle"
            type="button"
            onClick={audio.isOpen ? audio.close : audio.open}
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
      <div
        className="study-passage-text tracking-[0.02em] text-ink"
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
    </article>
  )
}
