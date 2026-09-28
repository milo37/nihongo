import { lazy, Suspense, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'

import type {
  DashboardInsightBreakdownView,
  DashboardInsightsView
} from '@app/dashboard/adapters/dashboardInsightsView'
import type {
  DashboardActionNotice,
  DashboardActionNoticeCode
} from '@app/dashboard/hooks/useDashboardRecommendationAction'
import { Badge } from '@common/components/Badge'
import { Button } from '@common/components/Button'
import { EmptyState } from '@common/components/EmptyState'
import { ErrorState } from '@common/components/ErrorState'
import { LoadingState } from '@common/components/LoadingState'
import { Skeleton } from '@common/components/Skeleton'
import { Table } from '@common/components/Table'
import { Tabs } from '@common/components/Tabs'
import { resolveUiLocale } from '@/i18n/types'
import { formatNumber } from '@libs/localeFormatters'

const DashboardInsightChart = lazy(() =>
  import('@app/dashboard/components/DashboardInsightChart').then((module) => ({
    default: module.DashboardInsightChart
  }))
)

type DashboardInsightsSectionProps = {
  actionNotice: DashboardActionNotice | null
  blockedRecommendationKind:
    | DashboardInsightsView['recommendations'][number]['kind']
    | null
  data: DashboardInsightsView | undefined
  isActionPending: boolean
  isError: boolean
  isPaused: boolean
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
}: MetricTableProps): ReactElement => {
  const { i18n, t } = useTranslation('dashboard')
  const locale = resolveUiLocale(i18n.resolvedLanguage)

  return (
    <section>
      <h3 className="text-lg font-black">{title}</h3>
      <Table
        caption={t('insights.table.caption', { title })}
        className="text-sm"
        containerClassName="mt-4"
        minWidthClassName="min-w-[42rem]"
        scrollLabel={label}
      >
        <thead className="bg-surface-muted text-muted">
          <tr>
            <th className="px-4 py-3 font-bold" scope="col">
              {t('insights.table.category')}
            </th>
            <th className="px-4 py-3 font-bold" scope="col">
              {t('insights.table.attempted')}
            </th>
            <th className="px-4 py-3 font-bold" scope="col">
              {t('insights.table.correct')}
            </th>
            <th className="px-4 py-3 font-bold" scope="col">
              {t('insights.table.accuracy')}
            </th>
            <th className="px-4 py-3 font-bold" scope="col">
              {t('insights.table.averageTime')}
            </th>
            <th className="px-4 py-3 font-bold" scope="col">
              {t('insights.table.recent')}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line bg-surface">
          {items.map((item) => (
            <tr key={item.id}>
              <th className="whitespace-nowrap px-4 py-3 font-bold" scope="row">
                {item.label}
              </th>
              <td className="px-4 py-3">
                {t('insights.table.attemptCount', {
                  formattedCount: formatNumber(item.attemptedCount, locale)
                })}
              </td>
              <td className="px-4 py-3">
                {t('insights.table.attemptCount', {
                  formattedCount: formatNumber(item.correctCount, locale)
                })}
              </td>
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
      </Table>
    </section>
  )
}

const assertNever = (value: never): never => {
  throw new Error(`Unsupported dashboard notice value: ${String(value)}`)
}

const getNoticePresentation = (
  code: DashboardActionNoticeCode
): {
  readonly className: string
  readonly role: 'alert' | 'status'
} => {
  switch (code) {
    case 'sessionExhausted':
    case 'targetedEnded':
    case 'targetedUnavailable':
      return {
        className:
          'border-warning-line bg-warning-soft text-warning-strong focus-visible:outline-warning',
        role: 'status'
      }
    case 'sessionRefreshed':
    case 'targetedEndedRefreshed':
    case 'targetedRefreshed':
      return {
        className:
          'border-success-line bg-success-soft text-success-strong focus-visible:outline-success',
        role: 'status'
      }
    case 'sessionRefreshFailed':
    case 'sessionFailed':
    case 'targetedEndedRefreshFailed':
    case 'targetedRefreshFailed':
    case 'targetedFailed':
      return {
        className:
          'border-danger-line bg-danger-soft text-danger-strong focus-visible:outline-danger',
        role: 'alert'
      }
    default:
      return assertNever(code)
  }
}

export const DashboardInsightsSection = ({
  actionNotice,
  blockedRecommendationKind,
  data,
  isActionPending,
  isError,
  isPaused,
  isPending,
  onRecommendationAction,
  onRetry,
  pendingRecommendationKind
}: DashboardInsightsSectionProps): ReactElement => {
  const { i18n, t } = useTranslation('dashboard')
  const locale = resolveUiLocale(i18n.resolvedLanguage)
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

  if (isPending && !data && isPaused) {
    return (
      <ErrorState
        className="mt-8"
        title={t('insights.offlineTitle')}
        description={t('insights.offlineDescription')}
      />
    )
  }

  if (isPending && !data) {
    return (
      <LoadingState
        className="mt-8 rounded-xl border border-line bg-surface"
        message={t('insights.loading')}
      />
    )
  }

  if (!data) {
    return (
      <ErrorState
        className="mt-8"
        title={t('insights.errorTitle')}
        description={t('insights.errorDescription')}
        retryLabel={t('insights.retry')}
        onRetry={() => {
          shouldRestoreRetryFocusRef.current = true
          onRetry()
        }}
      />
    )
  }

  const hasAttempts = data.stats.overall.attemptedCount > 0
  const noticePresentation = actionNotice
    ? getNoticePresentation(actionNotice.code)
    : null
  const formatCount = (value: number): string => formatNumber(value, locale)

  return (
    <section
      className="mt-12 border-t border-line pt-10"
      aria-labelledby="dashboard-insights-title"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-black tracking-[0.16em] text-brand">
            {t('insights.eyebrow')}
          </p>
          <h2
            className="mt-2 rounded-sm text-3xl font-black focus-visible:outline focus-visible:outline-focus focus-visible:outline-offset-focus focus-visible:outline-brand"
            id="dashboard-insights-title"
            ref={headingRef}
            tabIndex={-1}
          >
            {t('insights.title')}
          </h2>
          <p className="mt-3 text-sm font-semibold text-muted">
            {t('insights.window', {
              formattedAttempts: formatCount(data.window.minAttempts),
              formattedDays: formatCount(data.window.durationDays),
              observedAt: data.observedAtLabel
            })}
          </p>
        </div>
        <Badge>{t('insights.ruleBased')}</Badge>
      </div>

      {isPaused ? (
        <p
          className="mt-6 rounded-lg border border-warning-line bg-warning-soft px-4 py-3 text-sm font-semibold text-warning-strong"
          role="status"
        >
          {t('insights.cachedOffline')}
        </p>
      ) : isError ? (
        <ErrorState
          className="mt-6"
          headingLevel={3}
          title={t('insights.staleTitle')}
          description={t('insights.staleDescription')}
          retryLabel={t('insights.retry')}
          onRetry={() => {
            shouldRestoreRetryFocusRef.current = true
            onRetry()
          }}
        />
      ) : null}

      <dl className="mt-8 grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-5">
        <div className="bg-surface p-5">
          <dt className="text-sm text-muted">{t('insights.recentAttempts')}</dt>
          <dd className="mt-2 text-3xl font-black">
            {formatCount(data.stats.overall.attemptedCount)}
            <span className="ml-1 text-base font-semibold text-muted">
              {t('insights.questionUnit')}
            </span>
          </dd>
        </div>
        <div className="bg-surface p-5">
          <dt className="text-sm text-muted">{t('insights.recentAccuracy')}</dt>
          <dd className="mt-2 text-3xl font-black text-brand">
            {data.stats.overall.correctRateLabel}
          </dd>
        </div>
        <div className="bg-surface p-5">
          <dt className="text-sm text-muted">{t('insights.averageTime')}</dt>
          <dd className="mt-2 text-3xl font-black">
            {data.stats.overall.averageElapsedLabel}
          </dd>
        </div>
        <div className="bg-surface p-5">
          <dt className="text-sm text-muted">{t('insights.dueReview')}</dt>
          <dd className="mt-2 text-3xl font-black">
            {formatCount(data.reviewQueueCounts.due)}
            <span className="ml-1 text-base font-semibold text-muted">
              {t('insights.questionUnit')}
            </span>
          </dd>
        </div>
        <div className="bg-surface p-5">
          <dt className="text-sm text-muted">{t('insights.repeatedWrong')}</dt>
          <dd className="mt-2 text-3xl font-black">
            {formatCount(data.reviewQueueCounts.repeated)}
            <span className="ml-1 text-base font-semibold text-muted">
              {t('insights.questionUnit')}
            </span>
          </dd>
        </div>
      </dl>

      {hasAttempts ? (
        <>
          <div className="mt-8 grid gap-6 lg:grid-cols-2">
            <article className="rounded-xl border border-line bg-surface p-5 sm:p-7">
              <h3 className="text-xl font-black">{t('insights.byLevel')}</h3>
              <p className="mt-2 text-sm text-muted">
                {t('insights.chartDescription')}
              </p>
              <div className="mt-6">
                <Suspense
                  fallback={
                    <Skeleton
                      className="h-48"
                      label={t('insights.chartLoading')}
                    />
                  }
                >
                  <DashboardInsightChart items={data.stats.byLevel} />
                </Suspense>
              </div>
            </article>

            <article className="rounded-xl border border-line bg-surface p-5 sm:p-7">
              <MetricTable
                items={data.stats.byLevel}
                label={t('insights.levelTableLabel')}
                title={t('insights.levelTableTitle')}
              />
            </article>
          </div>

          <div className="mt-8 rounded-xl border border-line bg-surface p-5 sm:p-7">
            <MetricTable
              items={data.stats.bySubject}
              label={t('insights.subjectTableLabel')}
              title={t('insights.subjectTableTitle')}
            />
          </div>

          <details className="mt-6 rounded-xl border border-line bg-surface p-5 sm:p-7">
            <summary className="min-h-11 cursor-pointer py-2 text-lg font-black focus-visible:outline focus-visible:outline-focus focus-visible:outline-offset-focus focus-visible:outline-brand">
              {t('insights.detailsSummary')}
            </summary>
            <div className="mt-6">
              <Tabs
                label={t('insights.detailsLabel')}
                tabs={[
                  {
                    id: 'question-type',
                    label: t('insights.questionType'),
                    panel: (
                      <MetricTable
                        items={data.stats.byQuestionType}
                        label={t('insights.questionTypeTableLabel')}
                        title={t('insights.questionTypeTableTitle')}
                      />
                    )
                  },
                  {
                    id: 'tag',
                    label: t('insights.tag'),
                    panel: (
                      <div>
                        {data.stats.byTag.length > 0 ? (
                          <MetricTable
                            items={data.stats.byTag}
                            label={t('insights.tagTableLabel')}
                            title={t('insights.tagTableTitle')}
                          />
                        ) : (
                          <p className="text-sm text-muted">
                            {t('insights.noTags')}
                          </p>
                        )}
                        {data.stats.byTagTruncated ? (
                          <p className="mt-3 text-sm font-semibold text-warning-strong">
                            {t('insights.tagTruncated', {
                              formattedLimit: formatCount(100),
                              formattedTotal: formatCount(data.stats.byTagTotal)
                            })}
                          </p>
                        ) : null}
                      </div>
                    )
                  }
                ]}
              />
            </div>
          </details>
        </>
      ) : (
        <EmptyState
          className="mt-8 rounded-xl border border-line bg-surface"
          title={t('insights.emptyTitle')}
          description={t('insights.emptyDescription')}
        />
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <article className="rounded-xl border border-line bg-surface p-5 sm:p-7">
          <div className="flex items-center justify-between gap-4">
            <h3 className="text-xl font-black">{t('insights.weaknesses')}</h3>
            <Badge>
              {t('insights.count', {
                formattedCount: formatCount(data.weaknesses.length)
              })}
            </Badge>
          </div>
          {data.weaknesses.length > 0 ? (
            <ol className="mt-5 divide-y divide-line">
              {data.weaknesses.map((weakness, index) => (
                <li className="flex min-w-0 gap-4 py-4" key={weakness.key}>
                  <span className="font-black text-brand">
                    {formatCount(index + 1)}
                  </span>
                  <div className="min-w-0 flex-1 break-words">
                    <p className="font-bold">{weakness.title}</p>
                    <p className="mt-1 text-sm text-muted">{weakness.detail}</p>
                    <p className="mt-1 text-xs font-semibold text-muted">
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
              title={t('insights.noWeaknessTitle')}
              description={t('insights.noWeaknessDescription', {
                formattedAttempts: formatCount(data.window.minAttempts)
              })}
            />
          )}
        </article>

        <article className="rounded-xl border border-line bg-surface p-5 sm:p-7">
          <div className="flex items-center justify-between gap-4">
            <h3 className="text-xl font-black">
              {t('insights.recommendations')}
            </h3>
            <Badge variant="success">
              {t('insights.count', {
                formattedCount: formatCount(data.recommendations.length)
              })}
            </Badge>
          </div>
          {data.personalizationNotice ? (
            <p
              className="mt-4 rounded-lg border border-warning-line bg-warning-soft px-4 py-3 text-sm font-semibold text-warning-strong"
              role="status"
            >
              {data.personalizationNotice}
            </p>
          ) : null}
          {actionNotice && noticePresentation ? (
            <p
              className={`mt-4 rounded-lg border px-4 py-3 text-sm font-semibold focus:outline-none focus-visible:outline focus-visible:outline-focus focus-visible:outline-offset-focus ${noticePresentation.className}`}
              key={actionNotice.id}
              ref={actionNoticeRef}
              role={noticePresentation.role}
              tabIndex={-1}
            >
              {t(`insights.actionNotice.${actionNotice.code}`)}
            </p>
          ) : null}
          <ol className="mt-5 divide-y divide-line">
            {data.recommendations.map((recommendation) => (
              <li className="flex min-w-0 gap-4 py-4" key={recommendation.kind}>
                <span className="font-black text-brand">
                  {formatCount(recommendation.rank)}
                </span>
                <div className="min-w-0 flex-1 break-words">
                  <p className="font-bold">{recommendation.title}</p>
                  <p className="mt-1 text-sm leading-6 text-muted">
                    {recommendation.reason.leading}
                    {recommendation.reason.japanesePreview ? (
                      <span lang="ja">
                        {recommendation.reason.japanesePreview}
                      </span>
                    ) : null}
                    {recommendation.reason.trailing}
                  </p>
                  <p className="mt-2 text-sm font-bold text-ink">
                    {recommendation.actionSummary}
                  </p>
                  <Button
                    aria-label={t('insights.actionAriaLabel', {
                      action: recommendation.actionLabel,
                      summary: recommendation.actionSummary
                    })}
                    className="mt-3"
                    disabled={
                      isActionPending ||
                      isPaused ||
                      isError ||
                      blockedRecommendationKind === recommendation.kind
                    }
                    isLoading={
                      pendingRecommendationKind === recommendation.kind
                    }
                    loadingLabel={t('insights.actionLoading')}
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
