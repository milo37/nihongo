import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  getAdminApiErrorKey,
  getAdminRetryAfterSeconds,
  hasAdminFieldError,
  type AdminApiErrorPresentation,
  type AdminErrorKey
} from '@app/admin/presentation/adminPresentation'
import { formatDateTime, formatNumber } from '@libs/localeFormatters'
import { resolveUiLocale } from '@/i18n/types'

const toAdminApiErrorPresentation = (
  error: unknown
): AdminApiErrorPresentation | null => {
  if (!(error instanceof Error)) return null
  return {
    ...('code' in error && typeof error.code === 'string'
      ? { code: error.code }
      : {}),
    ...('isOffline' in error && typeof error.isOffline === 'boolean'
      ? { isOffline: error.isOffline }
      : {}),
    ...('retryAfterMs' in error && typeof error.retryAfterMs === 'number'
      ? { retryAfterMs: error.retryAfterMs }
      : {})
  }
}

export const useAdminPresentation = () => {
  const { i18n, t } = useTranslation('admin')
  const locale = resolveUiLocale(i18n.resolvedLanguage)

  const formatAdminDateTime = useCallback(
    (value: Date | number | string): string =>
      formatDateTime(value, locale, {
        dateStyle: 'medium',
        timeStyle: 'short'
      }),
    [locale]
  )
  const formatAdminNumber = useCallback(
    (value: number, options: Intl.NumberFormatOptions = {}): string =>
      formatNumber(value, locale, options),
    [locale]
  )
  const formatAdminPercent = useCallback(
    (basisPoints: number): string =>
      formatNumber(basisPoints / 10_000, locale, {
        maximumFractionDigits: 1,
        minimumFractionDigits: 1,
        style: 'percent'
      }),
    [locale]
  )
  const presentError = useCallback(
    (error: unknown, fallback: AdminErrorKey = 'errors.generic'): string => {
      const presentation = toAdminApiErrorPresentation(error)
      const message = t(getAdminApiErrorKey(presentation, fallback))
      const seconds = getAdminRetryAfterSeconds(presentation)
      return seconds === null
        ? message
        : t('common.retryAfter', {
            message,
            seconds: formatNumber(seconds, locale)
          })
    },
    [locale, t]
  )
  const presentFieldError = useCallback(
    (messages: readonly string[] | undefined): string | undefined =>
      hasAdminFieldError(messages) ? t('errors.fieldInvalid') : undefined,
    [t]
  )

  return {
    formatAdminDateTime,
    formatAdminNumber,
    formatAdminPercent,
    locale,
    presentError,
    presentFieldError,
    t
  }
}
