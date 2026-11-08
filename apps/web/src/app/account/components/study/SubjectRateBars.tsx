import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement } from 'react'
import type { GetDashboardStatsResponse } from '@nihongo/contracts/dashboard/get-dashboard-stats'
import { Badge } from '@nihongo/browser/common/components/Badge'

type SubjectRateBarsProps = {
  stats: GetDashboardStatsResponse
  showWeakest: boolean
}

// Rates are shown as whole percents; the weakest subject is marked by colour
// and by the badge text.
export const SubjectRateBars = ({
  stats,
  showWeakest
}: SubjectRateBarsProps): ReactElement => {
  const { t } = useTranslation('account')
  const { t: commonT } = useTranslation('common')
  const weakest = showWeakest ? stats.weakestSubject : null
  const subjectName = (subject: string): string =>
    commonT(`taxonomy.subjects.${subject}`)
  return (
    <section className="account-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold">{t('study.bySubject')}</h3>
        {weakest ? (
          <Badge variant="warning">
            {t('study.weakest', { subject: subjectName(weakest) })}
          </Badge>
        ) : null}
      </div>
      <ul className="mt-4 grid gap-0">
        {stats.subjectStats.map((stat) => {
          const name = subjectName(stat.subject)
          const percent = Math.round(stat.correctRate)
          return (
            <li
              key={stat.subject}
              className="grid min-h-9 grid-cols-[4.5rem_minmax(0,1fr)_3rem] items-center gap-3 text-sm [html:lang(ja)_&]:grid-cols-[5.25rem_minmax(0,1fr)_3rem]"
            >
              <span>{name}</span>
              {stat.answeredCount === 0 ? (
                <span className="col-span-2 text-xs text-muted">
                  {t('study.noRecord')}
                </span>
              ) : (
                <>
                  <span
                    className="h-3 overflow-hidden rounded-full border border-line bg-surface-muted"
                    role="img"
                    aria-label={`${name} ${percent}%`}
                  >
                    <span
                      className={`block h-full ${stat.subject === weakest ? 'bg-warning' : 'bg-brand'}`}
                      style={{ width: `${percent}%` }}
                    />
                  </span>
                  <span className="text-right font-semibold tabular-nums">
                    {percent}%
                  </span>
                </>
              )}
            </li>
          )
        })}
      </ul>
      {weakest ? (
        <Link
          className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-link"
          to={`/practice?subject=${weakest}`}
        >
          {t('study.startSubject', { subject: subjectName(weakest) })} →
        </Link>
      ) : null}
    </section>
  )
}
