import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement } from 'react'
import type { JlptLevel } from '@nihongo/browser/common/types/domain'
import { useGetDashboardStats } from '@app/dashboard/hooks/useGetDashboardStats'
import {
  MyStudySummary,
  SubjectRateList
} from '@app/account/components/study/MyStudySections'
import { RecentSessionList } from '@app/account/components/study/RecentSessionList'
import { Button } from '@nihongo/browser/common/components/Button'
import { getButtonClassName } from '@nihongo/browser/common/components/Button'
import { resolveUiLocale } from '@nihongo/browser/i18n/types'

const Skeleton = (): ReactElement => (
  <div className="my-skeleton" aria-hidden="true">
    <span className="my-skeleton-line my-skeleton-third" />
    <span className="my-skeleton-line my-skeleton-two-thirds" />
    <span className="my-skeleton-line my-skeleton-half" />
  </div>
)

// "내 학습": one summary line, answered count and correct rate per subject,
// then recent study. JLP-851: rates carry a tier colour, mark and bar.
// JLP-853: everything counts only the given level (the target level).
export const MyStudy = ({ level }: { level: JlptLevel }): ReactElement => {
  const { t, i18n } = useTranslation('account')
  const locale = resolveUiLocale(i18n.resolvedLanguage)
  const headingId = useId()
  // Opening My page always shows a current read.
  const stats = useGetDashboardStats({ level, myPage: true })
  const data = stats.data
  return (
    <section className="account-section my-study" aria-labelledby={headingId}>
      <h2 id={headingId} className="my-study-title">
        {t('study.title', { level })}
      </h2>
      {stats.isPending ? (
        <>
          <p className="sr-only" role="status">
            {t('study.loading')}
          </p>
          <Skeleton />
        </>
      ) : !data ? (
        <div>
          <p className="auth-notice auth-error my-study-error" role="alert">
            {t('study.error')}
          </p>
          <Button
            className="my-study-retry"
            variant="outline"
            disabled={stats.isFetching}
            onClick={() => void stats.refetch()}
          >
            {t('study.retry')}
          </Button>
        </div>
      ) : data.totalAnsweredCount === 0 ? (
        <div>
          <span className="maru-empty" aria-hidden="true" />
          <p className="my-empty-title">{t('study.emptyTitle', { level })}</p>
          <p className="my-empty-text">
            {t('study.emptyDescription', { level })}
          </p>
          <Link
            className={getButtonClassName({ className: 'my-empty-action' })}
            to="/"
          >
            {t('study.emptyAction', { level })}
          </Link>
        </div>
      ) : (
        <>
          <MyStudySummary data={data} locale={locale} />
          <SubjectRateList data={data} locale={locale} />
          <RecentSessionList sessions={data.recentStudySessions} />
        </>
      )}
    </section>
  )
}
