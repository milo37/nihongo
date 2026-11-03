import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import type { StudyQuestionView } from '@app/practice/adapters/studySessionView'
import { usePracticeNumberFormat } from '@app/practice/hooks/usePracticeNumberFormat'

type PracticeQuestionNavigatorProps = {
  currentIndex: number
  isDisabled: boolean
  onJump: (ordinal: number) => void
  questions: StudyQuestionView[]
  selectedAnswers: Record<string, string>
}

export const PracticeQuestionNavigator = ({
  currentIndex,
  isDisabled,
  onJump,
  questions,
  selectedAnswers
}: PracticeQuestionNavigatorProps): ReactElement => {
  const { t } = useTranslation('practice')
  const { formatCount } = usePracticeNumberFormat()

  return (
    <aside className="study-question-guide study-question-map text-sm leading-7 text-muted">
      <h2 className="font-semibold text-ink">
        {t('session.navigation.jumpLabel')}
      </h2>
      <nav
        className="study-question-jump mt-8"
        aria-label={t('session.navigation.jumpLabel')}
      >
        <ol className="flex flex-wrap justify-center gap-2">
          {questions.map((question, index) => (
            <li key={question.id}>
              <button
                className="ui-question-jump min-h-11 min-w-11 rounded-lg border border-line bg-surface text-sm font-bold hover:border-line-strong hover:bg-surface-muted data-[current=true]:border-brand data-[current=true]:bg-brand data-[current=true]:text-on-accent data-[answered=true]:ring-2 data-[answered=true]:ring-line-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
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
                }}
              >
                {formatCount(index + 1)}
              </button>
            </li>
          ))}
        </ol>
      </nav>
      <h2 className="font-semibold text-ink">{t('session.guide.title')}</h2>
      <p className="mt-3">{t('session.guide.beforeSubmit')}</p>
      <p>{t('session.guide.afterSubmit')}</p>
    </aside>
  )
}
