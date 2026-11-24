import type { ReactElement } from 'react'
import type { AdminRetentionRow } from '@nihongo/contracts/admin/retention'
import { EmptyState } from '@nihongo/browser/common/components/EmptyState'
import { ErrorState } from '@nihongo/browser/common/components/ErrorState'
import { Icon } from '@nihongo/browser/common/components/Icon'
import { LoadingState } from '@nihongo/browser/common/components/LoadingState'
import { PageContainer } from '@nihongo/browser/common/components/PageContainer'
import { formatNumber } from '@nihongo/browser/libs/localeFormatters'
import { useUiLocale } from '@nihongo/browser/provider/I18nProvider'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'
import { useAdminRetention } from '@app/admin-retention/useAdminRetention'

/** A returned count and its share of the people it is counted against. */
const ReturnCell = ({
  returned,
  base
}: {
  returned: number | null
  base: number | null
}): ReactElement => {
  const { locale } = useUiLocale()
  const { t } = useAdminPresentation()
  if (returned === null || base === null)
    return <span className="text-muted">{t('retention.pending')}</span>
  return (
    <>
      <span className="font-semibold">{formatNumber(returned, locale)}</span>
      <span className="ml-2 text-muted">
        {base === 0
          ? t('common.none')
          : formatNumber(returned / base, locale, {
              style: 'percent',
              maximumFractionDigits: 1
            })}
      </span>
    </>
  )
}

const RetentionRow = ({ row }: { row: AdminRetentionRow }): ReactElement => {
  const { locale } = useUiLocale()
  const { t } = useAdminPresentation()
  return (
    <tr>
      <th scope="row" className="px-3 py-3 font-semibold tabular-nums">
        <time dateTime={row.cohortDate}>{row.cohortDate}</time>
      </th>
      <td className="px-3 py-3">{t(`retention.audience.${row.audience}`)}</td>
      <td className="px-3 py-3 text-right tabular-nums">
        {formatNumber(row.cohortSize, locale)}
      </td>
      <td className="px-3 py-3 text-right tabular-nums">
        <ReturnCell returned={row.day1Returned} base={row.cohortSize} />
      </td>
      <td className="px-3 py-3 text-right tabular-nums">
        <ReturnCell returned={row.day7Returned} base={row.weekCohortSize} />
      </td>
      <td className="px-3 py-3 text-right tabular-nums">
        <ReturnCell returned={row.week1Returned} base={row.weekCohortSize} />
      </td>
    </tr>
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
  return (
    <div
      role="region"
      aria-label={t('retention.title')}
      tabIndex={0}
      className="mt-8 overflow-x-auto rounded-card border border-line bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      <table className="w-full min-w-[48rem] border-collapse text-left text-sm">
        <caption className="sr-only">{t('retention.tableLabel')}</caption>
        <thead className="border-b border-line bg-surface-muted text-muted">
          <tr>
            <th scope="col" className="px-3 py-3 font-semibold">
              {t('retention.columns.cohortDate')}
            </th>
            <th scope="col" className="px-3 py-3 font-semibold">
              {t('retention.columns.audience')}
            </th>
            <th scope="col" className="px-3 py-3 text-right font-semibold">
              {t('retention.columns.cohortSize')}
            </th>
            <th scope="col" className="px-3 py-3 text-right font-semibold">
              {t('retention.columns.day1')}
            </th>
            <th scope="col" className="px-3 py-3 text-right font-semibold">
              {t('retention.columns.day7')}
            </th>
            <th scope="col" className="px-3 py-3 text-right font-semibold">
              {t('retention.columns.week1')}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {retention.data.rows.map((row) => (
            <RetentionRow key={`${row.cohortDate}-${row.audience}`} row={row} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

export const AdminRetentionPage = (): ReactElement => {
  const { t } = useAdminPresentation()
  return (
    <PageContainer width="6xl">
      <header className="border-b border-line pb-8">
        <h1 className="text-balance text-3xl font-black sm:text-4xl">
          {t('retention.title')}
        </h1>
        <p className="mt-4 max-w-prose text-muted">
          {t('retention.description')}
        </p>
      </header>
      <RetentionBody />
    </PageContainer>
  )
}
