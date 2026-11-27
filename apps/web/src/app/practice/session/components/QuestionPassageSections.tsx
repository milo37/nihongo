import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import { setFurigana } from '@app/practice/session/useFurigana'
import { PlayIcon } from '@app/practice/session/passageAudio/passageAudioIcons'
import type { usePassageAudio } from '@app/practice/session/passageAudio/usePassageAudio'
import { SheetTail } from '@common/components/manuscript/ManuscriptSheet'

/**
 * The passage head row: its name, [듣기] when there is audio, and the
 * furigana switch.
 */
export const PassageHead = ({
  audio,
  audioRowId,
  hasAudio,
  hasFurigana,
  isFuriganaOn,
  onOpenForAudio
}: {
  audio: ReturnType<typeof usePassageAudio>
  audioRowId: string
  hasAudio: boolean
  hasFurigana: boolean
  isFuriganaOn: boolean
  /** #986: opens a folded passage before the bar shows. */
  onOpenForAudio: () => void
}): ReactElement => {
  const { t } = useTranslation('practice')
  return (
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
                  onOpenForAudio()
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
  )
}

/** #986: [지문 펼치기] under a folded passage that runs past three lines. */
export const PassageOpenButton = ({
  textId,
  onOpen
}: {
  textId: string
  onOpen: () => void
}): ReactElement => {
  const { t } = useTranslation('practice')
  return (
    <button
      aria-controls={textId}
      aria-expanded={false}
      className="study-passage-open"
      type="button"
      onClick={onOpen}
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
  )
}
