import type { ReactElement } from 'react'
import type { AdminRetentionAudience } from '@nihongo/contracts/admin/retention'
import { formatNumber } from '@nihongo/browser/libs/localeFormatters'
import { useUiLocale } from '@nihongo/browser/provider/I18nProvider'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'
import { RETENTION_COLORS } from '@app/admin-retention/libs/retentionColors'
import {
  RETENTION_AUDIENCES,
  rateOf,
  type RetentionCount
} from '@app/admin-retention/libs/retentionSeries'

type Counts = Record<AdminRetentionAudience, RetentionCount>

/** Colour key shared by both charts. */
export const RetentionLegend = (): ReactElement => {
  const { t } = useAdminPresentation()
  return (
    <ul className="flex gap-4 text-[0.8125rem] text-muted">
      {RETENTION_AUDIENCES.map((audience) => (
        <li key={audience} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block size-2.5 rounded-full"
            style={{ background: RETENTION_COLORS[audience] }}
          />
          {t(`retention.audience.${audience}`)}
        </li>
      ))}
    </ul>
  )
}

const Stat = ({
  label,
  counts
}: {
  label: string
  counts: Counts
}): ReactElement => {
  const { locale } = useUiLocale()
  const { t } = useAdminPresentation()
  return (
    <div>
      <h2 className="text-[0.8125rem] text-muted">{label}</h2>
      <dl>
        {RETENTION_AUDIENCES.map((audience) => {
          const rate = rateOf(counts[audience])
          return (
            <div key={audience} className="mt-2 flex flex-col-reverse gap-1">
              <dt className="text-[0.8125rem] text-muted tabular-nums">
                <span className="sr-only">
                  {t(`retention.audience.${audience}`)}{' '}
                </span>
                {t('retention.summary.base', {
                  count: formatNumber(counts[audience].base, locale)
                })}
              </dt>
              <dd className="flex items-baseline gap-2">
                <span className="text-[1.75rem] font-bold leading-9 tabular-nums">
                  {rate === null
                    ? t('common.none')
                    : formatNumber(rate, locale, {
                        style: 'percent',
                        maximumFractionDigits: 0
                      })}
                </span>
                <span
                  aria-hidden="true"
                  className="text-[0.9375rem] font-semibold text-muted"
                >
                  {t(`retention.audience.${audience}`)}
                </span>
              </dd>
            </div>
          )
        })}
      </dl>
    </div>
  )
}

/** #1271 headline: latest counted 7 days, next day and first week. */
export const RetentionSummary = ({
  day1,
  week1
}: {
  day1: Counts
  week1: Counts
}): ReactElement => {
  const { t } = useAdminPresentation()
  return (
    <div className="mt-4 grid max-w-[35rem] grid-cols-2 gap-4">
      <Stat label={t('retention.summary.day1')} counts={day1} />
      <Stat label={t('retention.summary.week1')} counts={week1} />
    </div>
  )
}
