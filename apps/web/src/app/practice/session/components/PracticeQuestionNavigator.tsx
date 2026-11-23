import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import { Dialog } from '@nihongo/browser/common/components/Dialog'
import type { StudyQuestionView } from '@app/practice/adapters/studySessionView'
import { usePracticeNumberFormat } from '@app/practice/hooks/usePracticeNumberFormat'

type PracticeQuestionNavigatorProps = {
  currentIndex: number
  isDisabled: boolean
  onJump: (ordinal: number) => void
  onOpenChange: (open: boolean) => void
  open: boolean
  questions: StudyQuestionView[]
  selectedAnswers: Record<string, string>
}

/** Number sheet opened from the top bar's "1 / 3". */
export const PracticeQuestionNavigator = ({
  currentIndex,
  isDisabled,
  onJump,
  onOpenChange,
  open,
  questions,
  selectedAnswers
}: PracticeQuestionNavigatorProps): ReactElement => {
  const { t } = useTranslation('practice')
  const { formatCount } = usePracticeNumberFormat()

  return (
    <Dialog
      open={open}
      size="sm"
      title={t('session.navigation.jumpLabel')}
      onOpenChange={onOpenChange}
    >
      <nav aria-label={t('session.navigation.jumpLabel')}>
        <ol className="study-jump-list">
          {questions.map((question, index) => (
            <li key={question.id}>
              <button
                className="ui-question-jump"
                type="button"
                disabled={isDisabled}
                aria-label={t(
                  selectedAnswers[question.id]
                    ? 'session.navigation.jumpQuestionAnswered'
                    : 'session.navigation.jumpQuestionUnanswered',
                  { ordinal: formatCount(index + 1) }
                )}
                aria-current={index === currentIndex ? 'step' : undefined}
                data-current={index === currentIndex}
                data-answered={Boolean(selectedAnswers[question.id])}
                onClick={() => {
                  onJump(index + 1)
                  onOpenChange(false)
                }}
              >
                {formatCount(index + 1)}
              </button>
            </li>
          ))}
        </ol>
      </nav>
    </Dialog>
  )
}
