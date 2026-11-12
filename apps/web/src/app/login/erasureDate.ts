import type { UiLocale } from '@nihongo/browser/i18n/types'
import { formatDateTime } from '@nihongo/browser/libs/localeFormatters'

/** JLP-845 erasure time: "11월 19일 오후 3시" / "11月19日 15時". */
export const formatErasureDate = (value: string, locale: UiLocale): string =>
  formatDateTime(value, locale, {
    month: 'long',
    day: 'numeric',
    hour: 'numeric'
  })
