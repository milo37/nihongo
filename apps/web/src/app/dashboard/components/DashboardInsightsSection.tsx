import { lazy, Suspense, useEffect, useRef } from 'react'
import type { ReactElement } from 'react'
import type {
  DashboardInsightBreakdownView,
  DashboardInsightsView
} from '@app/dashboard/adapters/dashboardInsightsView'
import { Badge } from '@common/components/Badge'
import { Button } from '@common/components/Button'
import { EmptyState } from '@common/components/EmptyState'
import { ErrorState } from '@common/components/ErrorState'
import { LoadingState } from '@common/components/LoadingState'
import { Skeleton } from '@common/components/Skeleton'

const DashboardInsightChart = lazy(() =>
  import('@app/dashboard/components/DashboardInsightChart').then((module) => ({
    default: module.DashboardInsightChart
  }))
)

type DashboardInsightsSectionProps = {
  actionNotice: { readonly id: number; readonly message: string } | null
  blockedRecommendationKind:
    | DashboardInsightsView['recommendations'][number]['kind']
    | null
  data: DashboardInsightsView | undefined
  isActionPending: boolean
  isError: boolean
  isPending: boolean
  onRecommendationAction: (
    recommendation: DashboardInsightsView['recommendations'][number]
  ) => void
  onRetry: () => void
  pendingRecommendationKind:
    | DashboardInsightsView['recommendations'][number]['kind']
    | null
}

type MetricTableProps = {
  items: readonly DashboardInsightBreakdownView[]
  label: string
  title: string
}

const MetricTable = ({
  items,
  label,
  title
}: MetricTableProps): ReactElement => (
  <section>
    <h3 className="text-lg font-black">{title}</h3>
    <div
      aria-label={label}
      className="mt-4 overflow-x-auto rounded-lg border border-line focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      role="region"
      tabIndex={0}
    >
      <table className="min-w-[42rem] border-collapse text-left text-sm">
        <thead className="bg-slate-50 text-slate-700">
          <tr>
            <th className="px-4 py-3 font-bold" scope="col">
              구분
            </th>
            <th className="px-4 py-3 font-bold" scope="col">
              풀이
            </th>
            <th className="px-4 py-3 font-bold" scope="col">
              정답
            </th>
            <th className="px-4 py-3 font-bold" scope="col">
              정답률
            </th>
            <th className="px-4 py-3 font-bold" scope="col">
              평균 시간
            </th>
            <th className="px-4 py-3 font-bold" scope="col">
              최근 학습
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line bg-white">
          {items.map((item) => (
            <tr key={item.id}>
              <th className="whitespace-nowrap px-4 py-3 font-bold" scope="row">
                {item.label}
              </th>
              <td className="px-4 py-3">{item.attemptedCount}회</td>
              <td className="px-4 py-3">{item.correctCount}회</td>
              <td className="px-4 py-3 font-semibold">
                {item.correctRateLabel}
              </td>
              <td className="px-4 py-3">{item.averageElapsedLabel}</td>
              <td className="whitespace-nowrap px-4 py-3">
                {item.lastAnsweredLabel}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </section>
)

export const DashboardInsightsSection = ({
  actionNotice,
  blockedRecommendationKind,
  data,
  isActionPending,
  isError,
  isPending,
  onRecommendationAction,
  onRetry,
  pendingRecommendationKind
}: DashboardInsightsSectionProps): ReactElement => {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const actionNoticeRef = useRef<HTMLParagraphElement>(null)
  const shouldRestoreRetryFocusRef = useRef(false)

  useEffect(() => {
    if (data && !isError && shouldRestoreRetryFocusRef.current) {
      shouldRestoreRetryFocusRef.current = false
      headingRef.current?.focus()
    }
  }, [data, isError])

  useEffect(() => {
    if (actionNotice) actionNoticeRef.current?.focus()
  }, [actionNotice])

  if (isPending && !data) {
    return (
      <LoadingState
        className="mt-8 rounded-xl border border-line bg-white"
        message="최근 90일 인사이트를 불러오고 있습니다."
      />
    )
  }

  if (!data) {
    return (
      <ErrorState
        className="mt-8"
        title="학습 인사이트를 불러오지 못했습니다"
        description="기존 누적 통계는 그대로 확인할 수 있습니다. 최근 90일 분석만 다시 요청해 주세요."
        retryLabel="최근 인사이트 다시 시도"
        onRetry={() => {
          shouldRestoreRetryFocusRef.current = true
          onRetry()
        }}
      />
    )
  }

  const hasAttempts = data.stats.overall.attemptedCount > 0

  return (
    <section
      className="mt-12 border-t border-line pt-10"
      aria-labelledby="dashboard-insights-title"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-black tracking-[0.16em] text-brand">
            LAST 90 DAYS
          </p>
          <h2
            className="mt-2 rounded-sm text-3xl font-black"
            id="dashboard-insights-title"
            ref={headingRef}
            tabIndex={-1}
          >
            약점과 다음 학습 추천
          </h2>
          <p className="mt-3 text-sm font-semibold text-slate-600">
            {data.window.durationDays}일 기록 · 최소 {data.window.minAttempts}회
            표본 · {data.observedAtLabel} 기준
          </p>
        </div>
        <Badge>규칙 기반 추천</Badge>
      </div>

      {isError ? (
        <ErrorState
          className="mt-6"
          headingLevel={3}
          title="최신 인사이트로 갱신하지 못했습니다"
          description="현재 화면에는 마지막으로 확인한 결과를 유지합니다."
          retryLabel="최근 인사이트 다시 시도"
          onRetry={() => {
            shouldRestoreRetryFocusRef.current = true
            onRetry()
          }}
        />
      ) : null}

      <dl className="mt-8 grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-5">
        <div className="bg-white p-5">
          <dt className="text-sm text-muted">최근 풀이</dt>
          <dd className="mt-2 text-3xl font-black">
            {data.stats.overall.attemptedCount}
            <span className="ml-1 text-base font-semibold text-muted">
              문제
            </span>
          </dd>
        </div>
        <div className="bg-white p-5">
          <dt className="text-sm text-muted">최근 정답률</dt>
          <dd className="mt-2 text-3xl font-black text-brand">
            {data.stats.overall.correctRateLabel}
          </dd>
        </div>
        <div className="bg-white p-5">
          <dt className="text-sm text-muted">평균 풀이 시간</dt>
          <dd className="mt-2 text-3xl font-black">
            {data.stats.overall.averageElapsedLabel}
          </dd>
        </div>
        <div className="bg-white p-5">
          <dt className="text-sm text-muted">복습 예정</dt>
          <dd className="mt-2 text-3xl font-black">
            {data.reviewQueueCounts.due}
            <span className="ml-1 text-base font-semibold text-muted">
              문제
            </span>
          </dd>
        </div>
        <div className="bg-white p-5">
          <dt className="text-sm text-muted">반복 오답</dt>
          <dd className="mt-2 text-3xl font-black">
            {data.reviewQueueCounts.repeated}
            <span className="ml-1 text-base font-semibold text-muted">
              문제
            </span>
          </dd>
        </div>
      </dl>

      {hasAttempts ? (
        <>
          <div className="mt-8 grid gap-6 lg:grid-cols-2">
            <article className="rounded-xl border border-line bg-white p-5 sm:p-7">
              <h3 className="text-xl font-black">급수별 정답률</h3>
              <p className="mt-2 text-sm text-muted">
                막대와 같은 수치를 아래 표에서도 확인할 수 있습니다.
              </p>
              <div className="mt-6">
                <Suspense
                  fallback={
                    <Skeleton
                      className="h-48"
                      label="급수별 정답률 차트를 불러오는 중입니다."
                    />
                  }
                >
                  <DashboardInsightChart items={data.stats.byLevel} />
                </Suspense>
              </div>
            </article>

            <article className="rounded-xl border border-line bg-white p-5 sm:p-7">
              <MetricTable
                items={data.stats.byLevel}
                label="최근 90일 급수별 정답률 상세 표"
                title="급수별 상세 수치"
              />
            </article>
          </div>

          <div className="mt-8 rounded-xl border border-line bg-white p-5 sm:p-7">
            <MetricTable
              items={data.stats.bySubject}
              label="최근 90일 과목별 정답률 상세 표"
              title="과목별 통계"
            />
          </div>

          <details className="mt-6 rounded-xl border border-line bg-white p-5 sm:p-7">
            <summary className="min-h-11 cursor-pointer py-2 text-lg font-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
              유형·태그 세부 통계 보기
            </summary>
            <div className="mt-6 space-y-8">
              <MetricTable
                items={data.stats.byQuestionType}
                label="최근 90일 문제 유형별 정답률 상세 표"
                title="문제 유형별 통계"
              />
              {data.stats.byTag.length > 0 ? (
                <MetricTable
                  items={data.stats.byTag}
                  label="최근 90일 태그별 정답률 상세 표"
                  title="태그별 통계"
                />
              ) : (
                <p className="text-sm text-muted">관측된 태그가 없습니다.</p>
              )}
              {data.stats.byTagTruncated ? (
                <p className="text-sm font-semibold text-amber-900">
                  태그 전체 {data.stats.byTagTotal}개 중 최대 100개를
                  표시합니다.
                </p>
              ) : null}
            </div>
          </details>
        </>
      ) : (
        <EmptyState
          className="mt-8 rounded-xl border border-line bg-white"
          title="최근 90일 학습 기록이 없습니다"
          description="문제를 풀면 급수·과목·유형·태그별 정확도와 평균 풀이 시간이 표시됩니다. 표본이 없는 값은 0%가 아니라 ‘표본 없음’으로 구분합니다."
        />
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <article className="rounded-xl border border-line bg-white p-5 sm:p-7">
          <div className="flex items-center justify-between gap-4">
            <h3 className="text-xl font-black">분석된 약점</h3>
            <Badge>{data.weaknesses.length}개</Badge>
          </div>
          {data.weaknesses.length > 0 ? (
            <ol className="mt-5 divide-y divide-line">
              {data.weaknesses.map((weakness, index) => (
                <li className="flex gap-4 py-4" key={weakness.key}>
                  <span className="font-black text-brand">{index + 1}</span>
                  <div>
                    <p className="font-bold">{weakness.title}</p>
                    <p className="mt-1 text-sm text-muted">{weakness.detail}</p>
                    <p className="mt-1 text-xs font-semibold text-slate-600">
                      {weakness.scoreLabel}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState
              className="py-8"
              headingLevel={3}
              title="분석 기준을 충족한 약점이 없습니다"
              description={`같은 분류에서 최소 ${data.window.minAttempts}회 표본이 쌓이고 오답이 있어야 약점으로 표시합니다.`}
            />
          )}
        </article>

        <article className="rounded-xl border border-line bg-white p-5 sm:p-7">
          <div className="flex items-center justify-between gap-4">
            <h3 className="text-xl font-black">다음 학습 추천</h3>
            <Badge variant="success">{data.recommendations.length}개</Badge>
          </div>
          {data.personalizationNotice ? (
            <p
              className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950"
              role="status"
            >
              {data.personalizationNotice}
            </p>
          ) : null}
          {actionNotice ? (
            <p
              className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-950 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700"
              key={actionNotice.id}
              ref={actionNoticeRef}
              role="alert"
              tabIndex={-1}
            >
              {actionNotice.message}
            </p>
          ) : null}
          <ol className="mt-5 divide-y divide-line">
            {data.recommendations.map((recommendation) => (
              <li className="flex gap-4 py-4" key={recommendation.kind}>
                <span className="font-black text-brand">
                  {recommendation.rank}
                </span>
                <div>
                  <p className="font-bold">{recommendation.title}</p>
                  <p className="mt-1 text-sm leading-6 text-muted">
                    {recommendation.reason}
                  </p>
                  <p className="mt-2 text-sm font-bold text-ink">
                    {recommendation.actionSummary}
                  </p>
                  <Button
                    aria-label={`${recommendation.actionLabel}: ${recommendation.actionSummary}`}
                    className="mt-3"
                    disabled={
                      isActionPending ||
                      blockedRecommendationKind === recommendation.kind
                    }
                    isLoading={
                      pendingRecommendationKind === recommendation.kind
                    }
                    loadingLabel="추천 학습 준비 중…"
                    onClick={() => onRecommendationAction(recommendation)}
                    size="sm"
                  >
                    {recommendation.actionLabel}
                  </Button>
                </div>
              </li>
            ))}
          </ol>
        </article>
      </div>
    </section>
  )
}
