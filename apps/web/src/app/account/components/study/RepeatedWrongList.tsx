import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement } from 'react'
import type { DashboardRepeatedWrongQuestion } from '@nihongo/contracts/dashboard/get-dashboard-stats'
import { Badge } from '@nihongo/browser/common/components/Badge'

export const RepeatedWrongList = ({
  questions
}: {
  questions: readonly DashboardRepeatedWrongQuestion[]
}): ReactElement => {
  const { t } = useTranslation('account')
  return (
    <section className="account-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold">{t('study.repeated')}</h3>
        <Link
          className="inline-flex min-h-11 items-center text-sm font-semibold text-link"
          to="/wrong-notes"
        >
          {t('study.seeInReview')}
        </Link>
      </div>
      <ul className="divide-y divide-line">
        {questions.map((question) => (
          <li key={question.questionId}>
            <Link
              className="flex min-h-14 items-center justify-between gap-3 py-2 hover:bg-surface-muted"
              to={`/wrong-notes/${question.questionId}`}
            >
              <span className="min-w-0 truncate text-sm" lang="ja">
                {question.questionPreview}
              </span>
              <Badge variant="warning" className="shrink-0">
                {t('study.wrongTimes', { count: question.wrongCount })}
              </Badge>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
