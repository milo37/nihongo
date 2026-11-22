import { useTranslation } from 'react-i18next'
import { resolveUiLocale } from '@nihongo/browser/i18n/types'
import { formatErasureDate } from '@app/login/erasureDate'
import { useSsoAccountDeletion } from '@app/login/hooks/useSsoAccountDeletion'

// Shows the account deletion result once, only right after this browser
// requested it; ordinary visitors never query the deletion receipt.
export const useDeletionNotice = (active: boolean): string | null => {
  const { t, i18n } = useTranslation('auth')
  // Lazy routes read the locale here, not from I18nProvider (one chunk).
  const locale = resolveUiLocale(i18n.resolvedLanguage)
  const { receipt } = useSsoAccountDeletion(active)
  if (!active) return null
  if (receipt.isPending) return t('sso.checkingAccount')
  // JLP-847: the request was already accepted; a failed receipt read only
  // loses the date, so still confirm it without one.
  if (receipt.isError) return t('sso.deletionAcceptedNoDate')
  // JLP-845: erasure waits 7 days, so the notice carries its date.
  const scheduledAt = receipt.data?.deletionScheduledAt
  return scheduledAt
    ? t('sso.deletionAccepted', {
        date: formatErasureDate(scheduledAt, locale)
      })
    : null
}
