import { appI18n } from '@nihongo/browser/i18n/config'
import { useUiLocale } from '@nihongo/browser/provider/I18nProvider'
import {
  formatDateTime,
  formatNumber
} from '@nihongo/browser/libs/localeFormatters'
import {
  getAdminErrorKey,
  getAdminRetryAfterSeconds
} from '@app/admin/presentation/adminPresentation'

export const useAdminPresentation = () => {
  const { locale } = useUiLocale()
  const t = appI18n.getFixedT(locale, 'admin')
  return {
    t,
    formatAdminDateTime: (value: string): string =>
      formatDateTime(value, locale, {
        dateStyle: 'medium',
        timeStyle: 'short'
      }),
    presentError: (error: unknown): string => {
      const message = t(getAdminErrorKey(error))
      const seconds = getAdminRetryAfterSeconds(error)
      return seconds === null
        ? message
        : t('common.retryAfter', {
            message,
            seconds: formatNumber(seconds, locale)
          })
    }
  }
}
