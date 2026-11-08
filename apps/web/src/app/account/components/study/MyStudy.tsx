import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement } from 'react'
import { useGetDashboardStats } from '@app/dashboard/hooks/useGetDashboardStats'
import { AccountRecommendations } from '@app/account/components/study/AccountRecommendations'
import { RecentSessionList } from '@app/account/components/study/RecentSessionList'
import { RepeatedWrongList } from '@app/account/components/study/RepeatedWrongList'
import { StatTile } from '@app/account/components/study/StatTile'
import { SubjectRateBars } from '@app/account/components/study/SubjectRateBars'
import { WeekBars } from '@app/account/components/study/WeekBars'
import { Button } from '@nihongo/browser/common/components/Button'
import { getButtonClassName } from '@nihongo/browser/common/components/Button'
import { resolveUiLocale } from '@nihongo/browser/i18n/types'
import { formatNumber } from '@nihongo/browser/libs/localeFormatters'

// Below this many answers the weakest-subject hint has too little evidence,
// so it stays hidden. Recommendations follow the server: with no personal
// evidence it sends a target-level fallback with its own notice.
export const FEW_DATA_LIMIT = 20

const Skeleton = (): ReactElement => (
  <div className="account-card grid gap-3" aria-hidden="true">
    <span className="h-3 w-1/3 rounded bg-surface-muted" />
    <span className="h-3 w-2/3 rounded bg-surface-muted" />
    <span className="h-3 w-1/2 rounded bg-surface-muted" />
  </div>
)

// "내 학습" summary for all time plus the recommendation list under it.
export const MyStudy = (): ReactElement => {
  const { t, i18n } = useTranslation('account')
  const locale = resolveUiLocale(i18n.resolvedLanguage)
  const headingId = useId()
  // Opening My page always shows a current read.
  const stats = useGetDashboardStats({ myPage: true })
  const data = stats.data
  const isFew = data !== undefined && data.totalAnsweredCount < FEW_DATA_LIMIT
  return (
    <>
      <section className="grid gap-4" aria-labelledby={headingId}>
        <div className="flex items-baseline justify-between gap-3">
          <h2 id={headingId} className="text-xl font-semibold">
            {t('study.title')}
          </h2>
          <p className="text-xs text-muted">{t('study.period')}</p>
        </div>
        {stats.isPending ? (
          <>
            <p className="sr-only" role="status">
              {t('study.loading')}
            </p>
            <div className="grid gap-4 sm:grid-cols-3">
              <Skeleton />
              <Skeleton />
              <Skeleton />
            </div>
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
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <StatTile
                className="col-span-2 sm:col-span-1"
                label={t('study.total')}
                value={formatNumber(data.totalAnsweredCount, locale)}
                unit={t('study.totalUnit')}
              />
              <StatTile
                label={t('study.rate')}
                value={formatNumber(Math.round(data.correctRate), locale)}
                unit="%"
              />
              <StatTile
                label={t('study.wrongNotes')}
                value={formatNumber(data.solvedWrongNoteCount, locale)}
                unit={`/ ${formatNumber(data.wrongNoteCount, locale)}`}
                note={t('study.wrongSolved', {
                  solved: formatNumber(data.solvedWrongNoteCount, locale),
                  total: formatNumber(data.wrongNoteCount, locale)
                })}
              />
            </div>
            {isFew ? (
              <p className="text-xs text-muted">{t('study.fewData')}</p>
            ) : null}
            <div className="grid gap-4 md:grid-cols-2">
              <SubjectRateBars stats={data} showWeakest={!isFew} />
              <WeekBars days={data.dailyStudyCountLast7Days} />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <RecentSessionList sessions={data.recentStudySessions} />
              {data.repeatedWrongQuestions.length > 0 ? (
                <RepeatedWrongList questions={data.repeatedWrongQuestions} />
              ) : null}
            </div>
          </>
        )}
      </section>
      {/* Insights start only after this visit's fresh stats read settles. */}
      <AccountRecommendations enabled={stats.isFetchedAfterMount} />
    </>
  )
}
