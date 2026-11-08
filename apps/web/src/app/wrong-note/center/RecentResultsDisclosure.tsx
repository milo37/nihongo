import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement } from 'react'
import { Button } from '@nihongo/browser/common/components/Button'
import { ErrorState } from '@nihongo/browser/common/components/ErrorState'
import { LoadingState } from '@nihongo/browser/common/components/LoadingState'
import { useGetDashboardStats } from '@app/dashboard/hooks/useGetDashboardStats'

type RecentResultsDisclosureProps = {
  formatCount: (value: number) => string
  formatDate: (value: string) => string
}

// Loads recent study results only after the learner opens the disclosure.
export const RecentResultsDisclosure = ({
  formatCount,
  formatDate
}: RecentResultsDisclosureProps): ReactElement => {
  const { t } = useTranslation('wrongNote')
  const { t: commonT } = useTranslation('common')
  const [recentOpen, setRecentOpen] = useState(false)
  const recent = useGetDashboardStats({ enabled: recentOpen })
  return (
    <details
      className="review-recent-results"
      open={recentOpen}
      onToggle={(event) => setRecentOpen(event.currentTarget.open)}
    >
      <summary>{t('integration.recent.title')}</summary>
      {recentOpen ? (
        recent.isPending ? (
          <LoadingState message={t('integration.recent.loading')} />
        ) : recent.isError ? (
          <ErrorState
            title={t('integration.recent.error')}
            description={t('center.states.errorDescription')}
            action={
              <Button
                onClick={() => {
                  void recent.refetch()
                }}
              >
                {commonT('actions.retry')}
              </Button>
            }
          />
        ) : recent.data ? (
          <>
            {recent.data.recentStudySessions.slice(0, 5).map((session) => (
              <div className="review-recent-row" key={session.id}>
                <div>
                  <strong>
                    {session.level} ·{' '}
                    {commonT(`taxonomy.subjects.${session.subject}`)} ·{' '}
                    {t('integration.count', {
                      formattedCount: formatCount(session.totalCount)
                    })}
                  </strong>
                  <p>{formatDate(session.submittedAt)}</p>
                </div>
                <Link
                  className="note-link"
                  to={`/practice/result/${session.id}`}
                >
                  {t('integration.recent.result')}
                </Link>
              </div>
            ))}
            <p className="review-recent-note">
              {t(
                recent.data.recentStudySessions.length
                  ? 'integration.recent.limit'
                  : 'integration.recent.empty'
              )}
            </p>
          </>
        ) : null
      ) : null}
    </details>
  )
}
