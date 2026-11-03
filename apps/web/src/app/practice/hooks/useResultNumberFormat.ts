import { useTranslation } from 'react-i18next'
import { resolveUiLocale } from '@nihongo/browser/i18n/types'
import type { UiLocale } from '@nihongo/browser/i18n/types'
import { formatNumber } from '@nihongo/browser/libs/localeFormatters'

export interface ResultNumberFormat {
  locale: UiLocale
  formatCount: (value: number) => string
  formatDuration: (seconds: number) => string
}

export const useResultNumberFormat = (): ResultNumberFormat => {
  const { i18n, t } = useTranslation('result')
  const locale = resolveUiLocale(i18n.resolvedLanguage)
  const formatCount = (value: number): string => formatNumber(value, locale)
  const formatDuration = (seconds: number): string =>
    t('metrics.durationValue', {
      minutes: formatCount(Math.floor(seconds / 60)),
      seconds: formatCount(seconds % 60)
    })
  return { locale, formatCount, formatDuration }
}
