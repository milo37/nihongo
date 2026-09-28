import { useEffect, useRef } from 'react'
import { Link } from 'react-router'
import type { ReactElement } from 'react'
import { DashboardInsightsSection } from '@app/dashboard/components/DashboardInsightsSection'
import { DashboardSummarySection } from '@app/dashboard/components/DashboardSummarySection'
import { useGetDashboardInsights } from '@app/dashboard/hooks/useGetDashboardInsights'
import { useGetDashboardStats } from '@app/dashboard/hooks/useGetDashboardStats'
import { ErrorState } from '@common/components/ErrorState'
import { LoadingState } from '@common/components/LoadingState'
import { useAuth } from '@provider/ProtectedRouteProvider'

export const DashboardPage = (): ReactElement => {
  const { user } = useAuth()
  const dashboardQuery = useGetDashboardStats()
  const insightsQuery = useGetDashboardInsights()
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
    return <LoadingState message="학습 대시보드를 불러오고 있습니다." />
  }

  return (
    <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
      <div className="flex flex-col gap-5 border-b border-line pb-8 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-black tracking-[0.16em] text-brand">
            DASHBOARD
          </p>
          <h1
            className="mt-2 rounded-sm text-4xl font-black"
            ref={headingRef}
            tabIndex={-1}
          >
            학습 흐름을 확인하세요
          </h1>
          <p className="mt-3 text-muted">
            {user?.name ?? '학습자'}님의 목표 급수는{' '}
            <strong className="text-ink">
              {user?.targetLevel ?? '미설정'}
            </strong>
            입니다.
          </p>
          <p className="mt-2 text-sm font-semibold text-slate-600">
            누적 수치는 전체 기간 기준이며, 최근 7일 날짜는 UTC 기준입니다.
          </p>
        </div>
        <Link
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-brand px-5 font-bold text-white"
          to="/practice"
        >
          오늘 학습 시작
        </Link>
      </div>

      {dashboardQuery.isPending && !dashboardQuery.data ? (
        <LoadingState message="누적 학습 통계를 불러오고 있습니다." />
      ) : dashboardQuery.data ? (
        <>
          {dashboardQuery.isError ? (
            <ErrorState
              className="mt-8"
              title="최신 누적 통계로 갱신하지 못했습니다"
              description="현재 화면에는 마지막으로 확인한 결과를 유지합니다."
              retryLabel="누적 통계 다시 시도"
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
          title="누적 대시보드를 불러오지 못했습니다"
          description="최근 90일 인사이트는 별도로 확인할 수 있습니다. 누적 통계만 다시 요청해 주세요."
          retryLabel="누적 통계 다시 시도"
          onRetry={() => {
            shouldRestoreSummaryRetryFocusRef.current = true
            void dashboardQuery.refetch()
          }}
        />
      )}

      <DashboardInsightsSection
        data={insightsQuery.data}
        isError={insightsQuery.isError}
        isPending={insightsQuery.isPending}
        onRetry={() => void insightsQuery.refetch()}
      />
    </section>
  )
}
