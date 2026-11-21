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
    <p className="mt-10 text-[14px] leading-5 text-muted">
      {t('rush.fromResult')} ·{' '}
      {/* Only the link is tappable: 44px tall, never split, the › outside
          the underline after a flex gap (design). */}
      <Link
        className="inline-flex min-h-11 items-center gap-1 whitespace-nowrap text-ink"
        to={`/practice/rush?level=${level}`}
      >
        <span className="underline decoration-1 underline-offset-[3px]">
          {t('rush.entry')}
        </span>{' '}
        ›
      </Link>
    </p>
  )
}
