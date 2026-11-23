import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement } from 'react'
import type { JlptLevel } from '@nihongo/contracts/common/enum'

/** #1043 one quiet line at the very bottom of a member's set result,
 *  pointing to the kanji rush at the set's level (entry-position r4 §1). */
export const ResultRushLine = ({
  level
}: {
  level: JlptLevel
}): ReactElement => {
  const { t } = useTranslation('practice')
  return (
    <p className="study-result-rush-line">
      {t('rush.fromResult')} ·{' '}
      {/* Only the link is tappable: 44px tall, never split, the › outside
          the underline after a flex gap (design). */}
      <Link
        className="study-result-rush-link"
        to={`/practice/rush?level=${level}`}
      >
        <span className="study-result-rush-label">{t('rush.entry')}</span> ›
      </Link>
    </p>
  )
}
