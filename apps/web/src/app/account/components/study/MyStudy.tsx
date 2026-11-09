import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement } from 'react'
import { useGetDashboardStats } from '@app/dashboard/hooks/useGetDashboardStats'
import { RecentSessionList } from '@app/account/components/study/RecentSessionList'
import { Button } from '@nihongo/browser/common/components/Button'
import { getButtonClassName } from '@nihongo/browser/common/components/Button'
import { resolveUiLocale } from '@nihongo/browser/i18n/types'
import { formatNumber } from '@nihongo/browser/libs/localeFormatters'

const Skeleton = (): ReactElement => (
  <div className="account-card grid gap-3" aria-hidden="true">
    <span className="h-3 w-1/3 rounded bg-surface-muted" />
    <span className="h-3 w-2/3 rounded bg-surface-muted" />
    <span className="h-3 w-1/2 rounded bg-surface-muted" />
  </div>
)

// "내 학습": answered count and correct rate per subject, then recent study.
export const MyStudy = (): ReactElement => {
  const { t, i18n } = useTranslation('account')
  const { t: commonT } = useTranslation('common')
  const locale = resolveUiLocale(i18n.resolvedLanguage)
  const headingId = useId()
  // Opening My page always shows a current read.
  const stats = useGetDashboardStats({ myPage: true })
  const data = stats.data
  return (
    <section className="grid gap-4" aria-labelledby={headingId}>
      <h2 id={headingId} className="text-xl font-semibold">
        {t('study.title')}
      </h2>
      {stats.isPending ? (
        <>
          <p className="sr-only" role="status">
            {t('study.loading')}
          </p>
          <Skeleton />
        </>
      ) : !data ? (
        <div className="account-card">
          <p className="auth-notice auth-error mt-0" role="alert">
            {t('study.error')}
          </p>
          <Button
            className="mt-3"
            variant="outline"
            disabled={stats.isFetching}
            onClick={() => void stats.refetch()}
          >
            {t('study.retry')}
          </Button>
        </div>
      ) : data.totalAnsweredCount === 0 ? (
        <div className="account-card">
          <p className="font-semibold">{t('study.emptyTitle')}</p>
          <p className="mt-1 text-sm text-muted">
            {t('study.emptyDescription')}
          </p>
          <Link className={getButtonClassName({ className: 'mt-4' })} to="/">
            {t('study.emptyAction')}
          </Link>
        </div>
      ) : (
        <>
          <ul className="account-card grid gap-0 divide-y divide-line">
            {data.subjectStats.map((stat) => (
              <li
                key={stat.subject}
                className="flex min-h-12 items-center justify-between gap-3 text-sm"
              >
                <span className="font-semibold">
                  {commonT(`taxonomy.subjects.${stat.subject}`)}
                </span>
                {stat.answeredCount === 0 ? (
                  <span className="text-xs text-muted">
                    {t('study.noRecord')}
                  </span>
                ) : (
                  <span className="tabular-nums">
                    {formatNumber(stat.answeredCount, locale)}
                    {t('study.totalUnit')}
                    <span className="text-muted"> · {t('study.rate')} </span>
                    <span className="font-semibold">
                      {formatNumber(Math.round(stat.correctRate), locale)}%
                    </span>
                  </span>
                )}
              </li>
            ))}
          </ul>
          <RecentSessionList sessions={data.recentStudySessions} />
        </>
      )}
    </section>
  )
}
