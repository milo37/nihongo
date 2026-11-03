import { useTranslation } from 'react-i18next'
import { formatNumber } from '@nihongo/browser/libs/localeFormatters'
import { resolveUiLocale } from '@nihongo/browser/i18n/types'
import type { UiLocale } from '@nihongo/browser/i18n/types'

export interface PracticeNumberFormat {
  locale: UiLocale
  formatCount: (value: number) => string
  formatDuration: (seconds: number) => string
}

export const usePracticeNumberFormat = (): PracticeNumberFormat => {
  const { i18n } = useTranslation('practice')
  const locale = resolveUiLocale(i18n.resolvedLanguage)
  const formatCount = (value: number): string => formatNumber(value, locale)
  const formatDuration = (seconds: number): string => {
    const options: Intl.NumberFormatOptions = {
      minimumIntegerDigits: 2,
      useGrouping: false
    }
    return `${formatNumber(Math.floor(seconds / 60), locale, options)}:${formatNumber(
      seconds % 60,
      locale,
      options
    )}`
  }
  return { locale, formatCount, formatDuration }
}
