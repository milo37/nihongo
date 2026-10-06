import { LearningEntry } from '@app/dashboard/components/LearningEntry'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router'
import type { ReactElement } from 'react'
import { DashboardInsightsSection } from '@app/dashboard/components/DashboardInsightsSection'
import { DashboardSummarySection } from '@app/dashboard/components/DashboardSummarySection'
import { useGetDashboardInsights } from '@app/dashboard/hooks/useGetDashboardInsights'
import { useGetDashboardStats } from '@app/dashboard/hooks/useGetDashboardStats'
import { useDashboardRecommendationAction } from '@app/dashboard/hooks/useDashboardRecommendationAction'
import { ErrorState } from '@common/components/ErrorState'
import { LoadingState } from '@common/components/LoadingState'
import { useAuth } from '@provider/ProtectedRouteProvider'

const DashboardRecordsPage = (): ReactElement => {
  const { t } = useTranslation('dashboard')
  const { user } = useAuth()
  const dashboardQuery = useGetDashboardStats()
  const insightsQuery = useGetDashboardInsights()
  const recommendationAction = useDashboardRecommendationAction({
    refetchInsights: async () => {
      const result = await insightsQuery.refetch()
      return !result.isError && result.data !== undefined
    }
  })
  const headingRef = useRef<HTMLHeadingElement>(null)
  const shouldRestoreSummaryRetryFocusRef = useRef(false)

  useEffect(() => {
    if (
      dashboardQuery.data &&
      !dashboardQuery.isError &&
      shouldRestoreSummaryRetryFocusRef.current
    ) {
      shouldRestoreSummaryRetryFocusRef.current = false
      headingRef.current?.focus()
    }
  }, [dashboardQuery.data, dashboardQuery.isError])

  if (
    dashboardQuery.isPending &&
    !dashboardQuery.data &&
    insightsQuery.isPending &&
    !insightsQuery.data
  ) {
    if (
      dashboardQuery.fetchStatus === 'paused' ||
      insightsQuery.fetchStatus === 'paused'
    ) {
      return (
        <ErrorState
          headingLevel={1}
          title={t('offline.title')}
          description={t('offline.description')}
        />
      )
    }
    return <LoadingState message={t('loading')} />
  }

  return (
    <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
      <div className="flex flex-col gap-5 border-b border-line pb-8 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-black tracking-[0.16em] text-brand">
            {t('eyebrow')}
          </p>
          <h1
            className="mt-2 rounded-sm text-4xl font-black"
            ref={headingRef}
            tabIndex={-1}
          >
            {t('title')}
          </h1>
          <p className="mt-3 text-muted">
            {t('greeting', {
              level: user?.targetLevel ?? t('targetUnset'),
              name: user?.name ?? t('learnerFallback')
            })}
          </p>
          <p className="mt-2 text-sm font-semibold text-slate-600">
            {t('basisNote')}
          </p>
        </div>
        <Link
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-brand px-5 font-bold text-white"
          to="/practice"
        >
          {t('startToday')}
        </Link>
      </div>

      {dashboardQuery.isPending &&
      !dashboardQuery.data &&
      dashboardQuery.fetchStatus === 'paused' ? (
        <ErrorState
          className="mt-8"
          title={t('summary.offlineTitle')}
          description={t('summary.offlineDescription')}
        />
      ) : dashboardQuery.isPending && !dashboardQuery.data ? (
        <LoadingState message={t('summary.loading')} />
      ) : dashboardQuery.data ? (
        <>
          {dashboardQuery.fetchStatus === 'paused' ? (
            <p
              className="mt-8 rounded-lg border border-warning-line bg-warning-soft px-4 py-3 text-sm font-semibold text-warning-strong"
              role="status"
            >
              {t('summary.cachedOffline')}
            </p>
          ) : dashboardQuery.isError ? (
            <ErrorState
              className="mt-8"
              title={t('summary.staleTitle')}
              description={t('summary.staleDescription')}
              retryLabel={t('summary.retry')}
              onRetry={() => {
                shouldRestoreSummaryRetryFocusRef.current = true
                void dashboardQuery.refetch()
              }}
            />
          ) : null}
          <DashboardSummarySection stats={dashboardQuery.data} />
        </>
      ) : (
        <ErrorState
          className="mt-8"
          title={t('summary.errorTitle')}
          description={t('summary.errorDescription')}
          retryLabel={t('summary.retry')}
          onRetry={() => {
            shouldRestoreSummaryRetryFocusRef.current = true
            void dashboardQuery.refetch()
          }}
        />
      )}

      <DashboardInsightsSection
        actionNotice={recommendationAction.actionNotice}
        blockedRecommendationKind={
          recommendationAction.blockedRecommendationKind
        }
        data={insightsQuery.data}
        isActionPending={recommendationAction.isActionPending}
        isError={insightsQuery.isError}
        isPaused={insightsQuery.fetchStatus === 'paused'}
        isPending={insightsQuery.isPending}
        onRecommendationAction={recommendationAction.runRecommendation}
        onRetry={() => void recommendationAction.retryInsights()}
        pendingRecommendationKind={
          recommendationAction.pendingRecommendationKind
        }
      />
    </section>
  )
}

export const LearningHomePage = (): ReactElement => {
  const { t } = useTranslation('home')
  const { user } = useAuth()
  return (
    <section className="learning-note a2-home">
      <header className="border-b border-line pb-4">
        <h1 className="mt-2 text-2xl font-semibold leading-tight sm:text-3xl">
          {t('entry.title')}
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted">
          {t('entry.description')}
        </p>
      </header>
      <div className="study-member-entry py-7">
        <LearningEntry key={user?.id ?? 'guest'} isMember={user !== null} />
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2 border-t border-line py-4">
        <Link className="note-link" to="/practice?count=5">
          {t('entry.other')}
        </Link>
        <Link className="note-link" to="/dashboard">
          {t('entry.records')}
        </Link>
      </div>
    </section>
  )
}

export const DashboardPage = (): ReactElement => {
  const [searchParams] = useSearchParams()
  return searchParams.get('view') === 'learning' ? (
    <LearningHomePage />
  ) : (
    <DashboardRecordsPage />
  )
}
