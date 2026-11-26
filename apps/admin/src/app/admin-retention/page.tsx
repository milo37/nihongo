import type { ReactElement } from 'react'
import type { AdminRetentionRow } from '@nihongo/contracts/admin/retention'
import { EmptyState } from '@nihongo/browser/common/components/EmptyState'
import { ErrorState } from '@nihongo/browser/common/components/ErrorState'
import { Icon } from '@nihongo/browser/common/components/Icon'
import { LoadingState } from '@nihongo/browser/common/components/LoadingState'
import { PageContainer } from '@nihongo/browser/common/components/PageContainer'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'
import { useAdminRetention } from '@app/admin-retention/hooks/useAdminRetention'
import { RetentionChart } from '@app/admin-retention/components/RetentionChart'
import {
  RetentionLegend,
  RetentionSummary
} from '@app/admin-retention/components/RetentionSummary'
import { RetentionTable } from '@app/admin-retention/components/RetentionTable'
import {
  cohortDays,
  headlineCount,
  retentionPoints,
  type RetentionMeasure
} from '@app/admin-retention/libs/retentionSeries'

/** #1271: headline numbers, two line charts, exact numbers folded below. */
const RetentionView = ({
  rows
}: {
  rows: readonly AdminRetentionRow[]
}): ReactElement => {
  const { t } = useAdminPresentation()
  const now = new Date()
  const days = cohortDays(rows)
  const seriesOf = (measure: RetentionMeasure) => ({
    MEMBER: retentionPoints(rows, 'MEMBER', measure, now),
    GUEST: retentionPoints(rows, 'GUEST', measure, now)
  })
  const day1 = seriesOf('day1')
  const week1 = seriesOf('week1')
  return (
    <section aria-label={t('retention.title')} className="mt-8">
      <RetentionLegend />
      <RetentionSummary
        day1={{
          MEMBER: headlineCount(day1.MEMBER),
          GUEST: headlineCount(day1.GUEST)
        }}
        week1={{
          MEMBER: headlineCount(week1.MEMBER),
          GUEST: headlineCount(week1.GUEST)
        }}
      />
      <RetentionChart
        title={t('retention.chart.day1')}
        days={days}
        series={day1}
      />
      <RetentionChart
        title={t('retention.chart.week1')}
        days={days}
        series={week1}
      />
      <p className="mt-3 max-w-prose text-[0.8125rem] text-muted [word-break:keep-all]">
        {t('retention.chart.note')}
      </p>
      <RetentionTable rows={rows} />
    </section>
  )
}

const RetentionBody = (): ReactElement => {
  const { t, presentError } = useAdminPresentation()
  const retention = useAdminRetention()
  if (!retention.data) {
    if (retention.isPending && retention.fetchStatus !== 'paused')
      return <LoadingState className="mt-8" message={t('retention.loading')} />
    return (
      <ErrorState
        autoFocus
        className="mt-8"
        title={t('retention.error')}
        description={presentError(retention.error)}
        onRetry={() => void retention.refetch()}
        retryLabel={t('retention.retry')}
      />
    )
  }
  if (retention.data.rows.length === 0)
    return (
      <EmptyState
        autoFocus
        className="mt-8"
        icon={<Icon name="calendar" />}
        title={t('retention.emptyTitle')}
        description={t('retention.emptyDescription')}
      />
    )
  return <RetentionView rows={retention.data.rows} />
}

export const AdminRetentionPage = (): ReactElement => {
  const { t } = useAdminPresentation()
  return (
    <PageContainer width="6xl">
      <header className="border-b border-line pb-8">
        <h1 className="text-balance text-3xl font-black sm:text-4xl">
          {t('retention.title')}
        </h1>
        <p className="mt-4 max-w-prose text-muted [word-break:keep-all]">
          {t('retention.description')}
        </p>
      </header>
      <RetentionBody />
    </PageContainer>
  )
}
