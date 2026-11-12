import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement } from 'react'
import type { DashboardRecentStudySession } from '@nihongo/contracts/dashboard/get-dashboard-stats'
import {
  getRateTier,
  RateTierMark,
  rateTierTextClass
} from '@app/account/components/study/RateTier'
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
  // One sentence with the wrong notes link marked <notes>…</notes>; split by
  // hand because react-i18next's Trans parser is not allowed in the bundle.
  const [before = '', linkText = '', after = ''] =
    t('study.recentMore').split(/<\/?notes>/u)
  return (
    // JLP-851: a small title and a plain list inside My study, no card.
    <section>
      <h3 className="text-sm font-bold text-muted">{t('study.recent')}</h3>
      {sessions.length === 0 ? (
        <p className="mt-4 text-sm text-muted">{t('study.noRecord')}</p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {sessions.map((session) => {
            const tier = getRateTier(session.correctRate)
            return (
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
                    <span
                      className={`flex items-center justify-end gap-1 text-[13px] font-bold tabular-nums ${rateTierTextClass[tier]}`}
                    >
                      <RateTierMark tier={tier} className="size-[13px]" />
                      {Math.round(session.correctRate)}%
                      <span className="sr-only">{t(`study.tier.${tier}`)}</span>
                    </span>
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
      {/* The contract keeps the newest five; say so only when the list is
          full, and point to the wrong notes that keep every miss. */}
      {sessions.length >= 5 ? (
        <p className="account-recent-more mt-1 text-[13px] leading-[1.7] text-muted">
          {before}
          <Link className="text-link underline" to="/wrong-notes">
            {linkText}
          </Link>
          {after}
        </p>
      ) : null}
    </section>
  )
}
