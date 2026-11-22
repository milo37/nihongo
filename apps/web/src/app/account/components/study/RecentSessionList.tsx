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
      <h3 className="my-recent-title">{t('study.recent')}</h3>
      {sessions.length === 0 ? (
        <p className="my-recent-empty">{t('study.noRecord')}</p>
      ) : (
        <ul className="my-recent-list">
          {sessions.map((session) => {
            const tier = getRateTier(session.correctRate)
            return (
              <li key={session.id}>
                <Link
                  className="my-recent-link"
                  to={`/practice/result/${session.id}`}
                >
                  <span className="my-recent-main">
                    <span className="my-recent-head">
                      {session.level} ·{' '}
                      {commonT(`taxonomy.subjects.${session.subject}`)}
                      {session.mode === 'RANDOM' ? null : (
                        <Badge>
                          {commonT(`taxonomy.studyModes.${session.mode}`)}
                        </Badge>
                      )}
                    </span>
                    <span className="my-recent-date">
                      {formatDateTime(session.submittedAt, locale, {
                        month: 'numeric',
                        day: 'numeric'
                      })}
                    </span>
                  </span>
                  <span className="my-recent-side">
                    <span className="my-recent-score">
                      {t('study.recentRowResult', {
                        total: session.totalCount,
                        correct: session.correctCount
                      })}
                    </span>
                    <span
                      className={`my-recent-rate ${rateTierTextClass[tier]}`}
                    >
                      <RateTierMark tier={tier} className="my-recent-mark" />
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
        <p className="account-recent-more my-recent-more">
          {before}
          {linkText ? (
            <Link className="my-recent-more-link" to="/wrong-notes">
              {linkText}
            </Link>
          ) : null}
          {after}
        </p>
      ) : null}
    </section>
  )
}
