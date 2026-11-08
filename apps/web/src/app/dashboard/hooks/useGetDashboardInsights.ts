import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { toDashboardInsightsView } from '@app/dashboard/adapters/dashboardInsightsView'
import { dashboardQueries } from '@app/dashboard/queries/dashboardQueries'
import { resolveUiLocale } from '@nihongo/browser/i18n/types'

export const useGetDashboardInsights = (enabled = true) => {
  const { i18n, t } = useTranslation('dashboard')
  const { t: commonT } = useTranslation('common')
  const locale = resolveUiLocale(i18n.resolvedLanguage)
  const localization = useMemo(
    () => ({ commonT, locale, t }),
    [commonT, locale, t]
  )

  return useQuery({
    ...dashboardQueries.insights(),
    enabled,
    select: (response) => toDashboardInsightsView(response, localization)
  })
}
