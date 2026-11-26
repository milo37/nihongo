import { useTranslation } from 'react-i18next'
import type { ReactElement, ReactNode } from 'react'
import type { StudyResultItemView } from '@app/practice/adapters/studyResultView'
import { Button } from '@nihongo/browser/common/components/Button'
import type { WrongNoteReviewState } from '@nihongo/contracts/wrong-note/list-review-list'
import type { useGetWrongNote } from '@app/wrong-note/hooks/useGetWrongNote'
import { JaText } from '@common/components/JaText'
import { jaTextProps } from '@common/libs/jaSpacing'

/** 24px outline icon drawn in the current text colour. */
export const OutlineIcon = ({
  children,
  size
}: {
  children: ReactNode
  size?: number
}): ReactElement => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    width={size}
    height={size}
  >
    {children}
  </svg>
)

type WrongNoteQuery = ReturnType<typeof useGetWrongNote>

/** Correct/wrong headline, the confirmed review state and a status retry. */
export const ReviewFeedback = ({
  item,
  state,
  fresh,
  current
}: {
  item: StudyResultItemView
  state: WrongNoteReviewState | undefined
  fresh: boolean
  current: WrongNoteQuery
}): ReactElement => {
  const { t } = useTranslation('wrongNote')
  const pending = current.isPending || current.isFetching
  return (
    <div
      className={`review-feedback ${item.isCorrect ? 'review-feedback-correct' : 'review-feedback-wrong'}`}
    >
      <h2>
        <OutlineIcon>
          <circle cx="12" cy="12" r="10" />
          <path d={item.isCorrect ? 'm7 12 3 3 7-7' : 'm8 8 8 8m0-8-8 8'} />
        </OutlineIcon>
        {t(
          item.isCorrect
            ? 'integration.complete.correct'
            : 'integration.complete.wrong'
        )}
      </h2>
      {state ? (
        <p>{t(`integration.complete.states.${state}`)}</p>
      ) : (
        <p role="status">
          {t(
            pending && current.fetchStatus !== 'paused'
              ? 'integration.complete.checking'
              : 'integration.complete.unknown'
          )}
        </p>
      )}
      {!fresh && (!pending || current.fetchStatus === 'paused') ? (
        <Button
          variant="outline"
          onClick={() => {
            void current.refetch()
          }}
        >
          {t('integration.complete.retryStatus')}
        </Button>
      ) : null}
    </div>
  )
}

/** The learner's answer next to the correct answer. */
export const AnswerComparison = ({
  item
}: {
  item: StudyResultItemView
}): ReactElement => {
  const { t } = useTranslation('wrongNote')
  const selected = item.question.options.find(
    (option) => option.id === item.selectedOptionId
  )
  const correct = item.question.options.find(
    (option) => option.id === item.correctOptionId
  )
  return (
    <dl className="review-answer-comparison">
      <div>
        <dt
          className={
            item.isCorrect ? 'review-answer-correct' : 'review-answer-wrong'
          }
        >
          <OutlineIcon>
            <path
              d={item.isCorrect ? 'm5 12 4 4 10-10' : 'm6 6 12 12m0-12L6 18'}
            />
          </OutlineIcon>
          {t('integration.complete.selected')}
        </dt>
        <dd {...(selected ? jaTextProps(selected.text) : {})}>
          {selected ? (
            <JaText text={selected.text} />
          ) : (
            t('integration.complete.unanswered')
          )}
        </dd>
      </div>
      <div>
        <dt className="review-answer-correct">
          <OutlineIcon>
            <path d="m5 12 4 4 10-10" />
          </OutlineIcon>
          {t('detail.correct')}
        </dt>
        <dd {...(correct ? jaTextProps(correct.text) : {})}>
          {correct ? (
            <JaText text={correct.text} />
          ) : (
            t('integration.complete.unconfirmed')
          )}
        </dd>
      </div>
    </dl>
  )
}
