import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement } from 'react'
import { Icon } from '@nihongo/browser/common/components/Icon'
import type { JlptLevel } from '@nihongo/browser/common/types/domain'
import { formatNumber } from '@nihongo/browser/libs/localeFormatters'
import { resolveUiLocale } from '@nihongo/browser/i18n/types'
import { useGetDashboardStats } from '@app/dashboard/hooks/useGetDashboardStats'
import type { useListResumableStudySessions } from '@app/practice/hooks/useListResumableStudySessions'

type ResumableQuery = ReturnType<typeof useListResumableStudySessions>

/**
 * #992: the most recent unfinished set as one line under [시작하기]. Nothing
 * while loading, on error, or when the set cannot be resumed here.
 */
export const ResumeLine = ({
  query
}: {
  query: ResumableQuery
}): ReactElement | null => {
  const { t, i18n } = useTranslation('home')
  const { t: practiceT } = useTranslation('practice')
  const { t: commonT } = useTranslation('common')
  const recent = query.isPlaceholderData ? undefined : query.data?.items[0]
  if (
    !recent ||
    recent.practiceContractVersion !== 2 ||
    recent.resumeAvailability !== 'SERVER'
  )
    return null
  const locale = resolveUiLocale(i18n.resolvedLanguage)
  return (
    <p className="home-more">
      <Icon name="history" className="home-more-icon" />
      {t('today.resumeLabel', {
        level: recent.level,
        subject: commonT(`taxonomy.subjects.${recent.subject}`),
        summary: practiceT('setup.resume.summary', {
          formattedCount: formatNumber(recent.actualCount, locale),
          formattedOrdinal: formatNumber(recent.currentOrdinal ?? 1, locale)
        })
      })}
      <Link to={`/practice/session/${recent.id}`}>
        {practiceT('setup.resume.action')}
        <Icon name="chevron-right" className="size-4" />
      </Link>
    </p>
  )
}

/** #995: under today's question, what signing in keeps. */
export const GuestBenefitLine = ({
  loginHref
}: {
  loginHref: string
}): ReactElement => {
  const { t } = useTranslation('home')
  const { t: navigationT } = useTranslation('navigation')
  return (
    <p className="home-more home-foot">
      <Icon name="log-in" className="home-more-icon" />
      {t('today.guestBenefit')}
      <Link to={loginHref}>
        {navigationT('login')}
        <Icon name="chevron-right" className="size-4" />
      </Link>
    </p>
  )
}

/**
 * #995: how many of this level's questions the member solved in the last 7
 * days. Hidden while loading, on error and at 0.
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
