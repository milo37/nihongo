import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import { useDashboardRecommendationAction } from '@app/dashboard/hooks/useDashboardRecommendationAction'
import { useGetDashboardInsights } from '@app/dashboard/hooks/useGetDashboardInsights'
import { Button } from '@nihongo/browser/common/components/Button'

const MAX_SHOWN = 2

type AccountRecommendationsProps = {
  /** Insights load after the stats read settles, so the summary comes first. */
  enabled?: boolean
}

// Insight recommendations moved here from the learning home (top two by
// rank). A failed insights request hides the section without an alert.
export const AccountRecommendations = ({
  enabled = true
}: AccountRecommendationsProps): ReactElement | null => {
  const { t } = useTranslation('account')
  const { t: dashboardT } = useTranslation('dashboard')
  const { t: commonT } = useTranslation('common')
  const headingId = useId()
  const query = useGetDashboardInsights(enabled)
  const action = useDashboardRecommendationAction({
    refetchInsights: async () => {
      const result = await query.refetch()
      return result.isSuccess
    }
  })
  const items = [...(query.data?.recommendations ?? [])]
    .sort((left, right) => left.rank - right.rank)
    .slice(0, MAX_SHOWN)
  if (!query.isSuccess || items.length === 0) return null
  return (
    <section className="grid gap-3" aria-labelledby={headingId}>
      <h2 id={headingId} className="text-xl font-semibold">
        {t('recommend.title')}
      </h2>
      {query.data.personalizationNotice ? (
        <p className="text-sm text-muted">{query.data.personalizationNotice}</p>
      ) : null}
      <ul className="grid gap-3">
        {items.map((item, index) => (
          <li
            key={item.kind}
            className="account-card flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className="font-semibold">{item.title}</p>
              <p className="mt-1 text-xs text-muted">{item.actionSummary}</p>
            </div>
            <Button
              className="w-full shrink-0 sm:w-auto"
              variant={index === 0 ? 'primary' : 'outline'}
              aria-label={`${item.title} ${t('recommend.start')}`}
              disabled={
                action.blockedRecommendationKind === item.kind ||
                action.isActionPending
              }
              isLoading={action.pendingRecommendationKind === item.kind}
              onClick={() => action.runRecommendation(item)}
            >
              {t('recommend.start')}
            </Button>
          </li>
        ))}
      </ul>
      {action.actionNotice ? (
        <p
          key={action.actionNotice.id}
          className="text-sm"
          role="status"
          aria-live="polite"
        >
          {action.actionNotice.code === 'accountRestricted'
            ? commonT('state.accountRestricted')
            : dashboardT(`insights.actionNotice.${action.actionNotice.code}`)}
        </p>
      ) : null}
    </section>
  )
}
