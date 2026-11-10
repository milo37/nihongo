import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement } from 'react'
import type { DashboardRecentStudySession } from '@nihongo/contracts/dashboard/get-dashboard-stats'
import { Badge } from '@nihongo/browser/common/components/Badge'
import { resolveUiLocale } from '@nihongo/browser/i18n/types'
import { formatDateTime } from '@nihongo/browser/libs/localeFormatters'

export const RecentSessionList = ({
  sessions
}: {
  sessions: readonly DashboardRecentStudySession[]
}): ReactElement => {
  const { t, i18n } = useTranslation('account')
  const { t: commonT } = useTranslation('common')
  const locale = resolveUiLocale(i18n.resolvedLanguage)
  return (
    <section className="account-card">
      <h3 className="text-base font-semibold">{t('study.recent')}</h3>
      {sessions.length === 0 ? (
        <p className="mt-4 text-sm text-muted">{t('study.noRecord')}</p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {sessions.map((session) => (
            <li key={session.id}>
              <Link
                className="flex min-h-14 items-center justify-between gap-3 py-2 hover:bg-surface-muted"
                to={`/practice/result/${session.id}`}
              >
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                    {session.level} ·{' '}
                    {commonT(`taxonomy.subjects.${session.subject}`)}
                    {session.mode === 'RANDOM' ? null : (
                      <Badge>
                        {commonT(`taxonomy.studyModes.${session.mode}`)}
                      </Badge>
                    )}
                  </span>
                  <span className="mt-1 block text-caption text-muted">
                    {formatDateTime(session.submittedAt, locale, {
                      month: 'numeric',
                      day: 'numeric'
                    })}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-sm font-semibold tabular-nums">
                    {t('study.recentRowResult', {
                      total: session.totalCount,
                      correct: session.correctCount
                    })}
                  </span>
                  <span className="block text-caption text-muted tabular-nums">
                    {Math.round(session.correctRate)}%
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
