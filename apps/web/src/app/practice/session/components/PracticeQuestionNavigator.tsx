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
        <ol className="flex flex-wrap gap-2">
          {questions.map((question, index) => (
            <li key={question.id}>
              <button
                className="ui-question-jump min-h-11 min-w-11 rounded-lg border border-line bg-surface text-sm font-bold hover:border-line-strong hover:bg-surface-muted data-[current=true]:border-2 data-[current=true]:border-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
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
