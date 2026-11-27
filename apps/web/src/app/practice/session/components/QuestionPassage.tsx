import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReactElement, RefObject } from 'react'
import type { FuriganaSegment } from '@nihongo/contracts/question/get-question'
import type { PassageAudioRef } from '@nihongo/contracts/question/passage-audio'
import { paragraphRuby } from '@app/practice/session/passageFurigana'
import { passageParagraphs } from '@app/practice/session/passageParagraphs'
import { useFurigana } from '@app/practice/session/useFurigana'
import { usePassageClipped } from '@app/practice/session/usePassageClipped'
import type { QuestionPush } from '@app/practice/session/components/PracticeQuestionCard'
import { PassageAudioBar } from '@app/practice/session/passageAudio/PassageAudioBar'
import { paragraphMark } from '@app/practice/session/passageAudio/paragraphMark'
import { usePassageAudio } from '@app/practice/session/passageAudio/usePassageAudio'
import { useRevealReadingWord } from '@app/practice/session/passageAudio/useRevealReadingWord'
import { JaText } from '@common/components/JaText'
import { jaTextProps } from '@common/libs/jaSpacing'
import { SamePassageNote } from '@app/practice/components/SamePassageNote'
import { useToast } from '@nihongo/browser/common/components/Toast'
import {
  PassageHead,
  PassageOpenButton
} from '@app/practice/session/components/QuestionPassageSections'

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
  const textRef = useRef<HTMLDivElement>(null)
  const isClipped = usePassageClipped(textRef, isFolded, isFuriganaOn)
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
  const revealRef = useRevealReadingWord(passageRef)
  return (
    <article
      ref={passageRef}
      aria-label={isDecorative ? undefined : t('session.question.passageLabel')}
      role={isDecorative ? 'presentation' : undefined}
      className="study-push study-passage"
      data-push={push}
      tabIndex={isDecorative ? undefined : 0}
    >
      <PassageHead
        audio={audio}
        audioRowId={audioRowId}
        hasAudio={hasAudio}
        hasFurigana={hasFurigana}
        isFuriganaOn={isFuriganaOn}
        onOpenForAudio={() => setOpened(true)}
      />
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
        className="study-passage-text"
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
        <PassageOpenButton
          textId={textId}
          onOpen={() => {
            setOpened(true)
            // The button goes away; keep focus on the passage, not the page.
            passageRef.current?.focus({ preventScroll: true })
          }}
        />
      ) : null}
    </article>
  )
}
