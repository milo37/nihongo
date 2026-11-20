import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement } from 'react'
import type { JlptLevel } from '@nihongo/contracts/common/enum'
import { useRushBest } from '@app/practice/hooks/useRush'

/** #1043 the rush row at the bottom of learn; members only (guests: none). */
export const RushEntry = ({
  level,
  userId
}: {
  level: JlptLevel
  userId: string
}): ReactElement => {
  const { t } = useTranslation('practice')
  const best = useRushBest(userId, level)
  return (
    <section className="rush-entry">
      <Link to={`/practice/rush?level=${level}`}>
        <svg viewBox="0 0 26 26" aria-hidden="true">
          <circle cx="13" cy="14.5" r="9" />
          <path d="M13 14.5V9.5M10.5 2.5h5M13 14.5l3.5 2" />
        </svg>
        <span>
          <b>{t('rush.entry')}</b>
          <small>
            {t('rush.entryLead')}
            {best === null ? null : ` · ${t('rush.best', { b: best })}`}
          </small>
        </span>
      </Link>
    </section>
  )
}
