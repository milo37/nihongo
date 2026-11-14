import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useEffect, useRef } from 'react'
import type { ReactElement } from 'react'
import { getButtonClassName } from '@nihongo/browser/common/components/Button'
import { Icon } from '@nihongo/browser/common/components/Icon'
import { resolveUiLocale } from '@nihongo/browser/i18n/types'
import { formatDateTime } from '@nihongo/browser/libs/localeFormatters'
import type { SessionCap } from '@libs/apiError'

/**
 * A member started too many new sets (#1006): the hour or day cap, in the
 * guest limit card's place and look. No numbers; wrong-note review stays
 * open. Not an error: no red, no alert role. It only appears after a start
 * press whose button it replaces, so focus moves to its title (design #1031).
 */
export const SessionCapCard = ({ cap }: { cap: SessionCap }): ReactElement => {
  const { t, i18n } = useTranslation('practice')
  const { t: navigationT } = useTranslation('navigation')
  const locale = resolveUiLocale(i18n.resolvedLanguage)
  const titleRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    titleRef.current?.focus()
  }, [])
  const time = cap.resetsAt
    ? formatDateTime(cap.resetsAt, locale, {
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
      })
    : ''
  return (
    <section
      className="practice-guest-limit"
      aria-labelledby="practice-session-cap-title"
    >
      <div className="practice-guest-limit-head">
        <Icon name="moon" className="practice-guest-limit-icon" />
        <h2
          ref={titleRef}
          id="practice-session-cap-title"
          className="outline-none"
          tabIndex={-1}
        >
          {t(
            cap.kind === 'hour'
              ? 'setup.sessionCap.hourTitle'
              : 'setup.sessionCap.dayTitle'
          )}
        </h2>
      </div>
      <p>
        {cap.kind === 'hour'
          ? t('setup.sessionCap.hourBody', { time })
          : t('setup.sessionCap.dayBody')}
      </p>
      <Link
        className={getButtonClassName({ variant: 'secondary' })}
        to="/wrong-notes"
      >
        {navigationT('wrongNotes')}
      </Link>
    </section>
  )
}
