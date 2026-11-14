import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement } from 'react'
import { Icon } from '@nihongo/browser/common/components/Icon'
import type { JlptLevel } from '@nihongo/browser/common/types/domain'
import { formatNumber } from '@nihongo/browser/libs/localeFormatters'
import { resolveUiLocale } from '@nihongo/browser/i18n/types'
import { useGetDashboardStats } from '@app/dashboard/hooks/useGetDashboardStats'

/**
 * #995: how many of this level's questions the member solved in the last 7
 * days, at the foot of the home. Members only, so it lives with the member
 * route and the public home never reaches the dashboard contract (ARCH114).
 * Hidden while loading, on error and at 0.
 */
export const WeekLine = ({
  level
}: {
  level: JlptLevel
}): ReactElement | null => {
  const { t, i18n } = useTranslation('home')
  const { t: navigationT } = useTranslation('navigation')
  const stats = useGetDashboardStats({ level, quiet: true })
  const total =
    stats.data?.dailyStudyCountLast7Days.reduce(
      (sum, day) => sum + day.count,
      0
    ) ?? 0
  if (stats.isError || total === 0) return null
  return (
    <p className="home-more home-foot">
      <Icon name="calendar" className="home-more-icon" />
      {t('today.weekLabel', {
        level,
        formattedCount: formatNumber(
          total,
          resolveUiLocale(i18n.resolvedLanguage)
        )
      })}
      <Link to="/account">
        {navigationT('my')}
        <Icon name="chevron-right" className="size-4" />
      </Link>
    </p>
  )
}
