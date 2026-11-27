import { GradeSquare } from '@common/components/manuscript/GradeSquare'
import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import type { GetDailyQuestionResponse } from '@api/question/getDailyQuestion/schema'

/** One choice; after a pick its label shows ✓/✕ and a small line names it. */
export const DailyOption = ({
  answered,
  mark,
  onPick,
  option,
  pressed
}: {
  answered: boolean
  mark: 'correct' | 'wrong' | null
  onPick: () => void
  option: GetDailyQuestionResponse['question']['options'][number]
  pressed: boolean
}): ReactElement => {
  // Left uncompiled: the compiled parent already caches this section, and
  // compiling it too adds about 200 bytes gzip (#1124 bundle).
  'use no memo'
  const { t } = useTranslation('home')
  return (
    <button
      type="button"
      className="home-daily-option"
      data-state={mark ?? undefined}
      aria-pressed={pressed}
      aria-disabled={answered}
      onClick={onPick}
    >
      <span
        className="home-daily-option-label"
        aria-hidden={mark ? true : undefined}
      >
        {mark ? (
          <GradeSquare grade={mark === 'correct' ? 'ok' : 'ng'} />
        ) : (
          option.label
        )}
      </span>
      <span className="home-daily-option-text">
        <span lang="ja">
          {mark ? <span className="sr-only">{option.label}. </span> : null}
          {option.text}
        </span>
        {mark ? (
          <span className="home-daily-option-mark">
            {t(
              mark === 'correct' ? 'today.dailyAnswer' : 'today.dailyYourAnswer'
            )}
          </span>
        ) : null}
      </span>
    </button>
  )
}
