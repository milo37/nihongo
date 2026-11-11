import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import { formatNumber } from '@nihongo/browser/libs/localeFormatters'
import { resolveUiLocale } from '@nihongo/browser/i18n/types'
import type { GuestAllowance } from '@app/practice/queries/guestAllowanceQueries'

/**
 * A guest's tries left, shown only after the first try and before the last
 * (plan-notes §4): undefined otherwise.
 */
export const getGuestTriesLeft = (
  isGuest: boolean,
  allowance: Pick<GuestAllowance, 'remaining' | 'dailyLimit'> | null | undefined
): number | undefined =>
  isGuest &&
  allowance &&
  allowance.remaining > 0 &&
  allowance.remaining < allowance.dailyLimit
    ? allowance.remaining
    : undefined

/** "| 2번 남음" inside a start button (B4 guest-5 images). */
export const ButtonTriesLeft = ({
  remaining
}: {
  remaining: number
}): ReactElement => {
  const { t, i18n } = useTranslation('home')
  return (
    <span className="button-tries-left">
      {t('today.guestLeftShort', {
        remaining: formatNumber(
          remaining,
          resolveUiLocale(i18n.resolvedLanguage)
        )
      })}
    </span>
  )
}
