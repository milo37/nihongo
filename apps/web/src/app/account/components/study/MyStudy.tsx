import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import type { JlptLevel } from '@nihongo/browser/common/types/domain'
import { useGetDashboardStats } from '@app/dashboard/hooks/useGetDashboardStats'
import {
  MyStudyEmpty,
  MyStudySummary,
  SubjectRateList
} from '@app/account/components/study/MyStudySections'
import { RecentSessionList } from '@app/account/components/study/RecentSessionList'
import { Button } from '@nihongo/browser/common/components/Button'
import { resolveUiLocale } from '@nihongo/browser/i18n/types'

const Skeleton = (): ReactElement => (
  <div className="grid gap-3" aria-hidden="true">
    <span className="h-3 w-1/3 rounded bg-surface-muted" />
    <span className="h-3 w-2/3 rounded bg-surface-muted" />
    <span className="h-3 w-1/2 rounded bg-surface-muted" />
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
    <section className="account-section grid gap-4" aria-labelledby={headingId}>
      <h2 id={headingId} className="text-lg font-bold">
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
        <MyStudyEmpty level={level} />
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
