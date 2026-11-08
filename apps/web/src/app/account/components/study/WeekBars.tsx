import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import type { GetDashboardStatsResponse } from '@nihongo/contracts/dashboard/get-dashboard-stats'
import { resolveUiLocale } from '@nihongo/browser/i18n/types'
import {
  formatDateTime,
  formatNumber
} from '@nihongo/browser/libs/localeFormatters'

const AREA_HEIGHT = 140
const LABEL_SPACE = 20

export const WeekBars = ({
  days
}: {
  days: GetDashboardStatsResponse['dailyStudyCountLast7Days']
}): ReactElement => {
  const { t, i18n } = useTranslation('account')
  const locale = resolveUiLocale(i18n.resolvedLanguage)
  const max = Math.max(1, ...days.map((day) => day.count))
  const total = days.reduce((sum, day) => sum + day.count, 0)
  const summary = t('study.weekSummary', {
    days: days.filter((day) => day.count > 0).length,
    count: formatNumber(total, locale)
  })
  return (
    <section className="account-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold">{t('study.week')}</h3>
        <p className="text-xs text-muted">{summary}</p>
      </div>
      <div
        className="mt-4 grid grid-cols-7 items-end gap-2"
        role="img"
        aria-label={summary}
      >
        {days.map((day) => (
          <div
            key={day.date}
            className="flex flex-col items-center justify-end"
            style={{ height: AREA_HEIGHT }}
          >
            {day.count > 0 ? (
              <>
                <span className="text-xs font-semibold tabular-nums">
                  {formatNumber(day.count, locale)}
                </span>
                <span
                  className="mt-1 w-full max-w-[28px] rounded-t-sm bg-brand"
                  style={{
                    height: Math.max(
                      4,
                      ((AREA_HEIGHT - LABEL_SPACE * 2) * day.count) / max
                    )
                  }}
                />
              </>
            ) : (
              <span className="h-0.5 w-full max-w-[28px] bg-line" />
            )}
            <span className="mt-2 text-xs text-muted">
              {formatDateTime(`${day.date}T00:00:00.000Z`, locale, {
                weekday: 'short',
                timeZone: 'UTC'
              })}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}
