import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  getAdminApiErrorKey,
  getAdminRetryAfterSeconds,
  hasAdminFieldError,
  type AdminApiErrorPresentation,
  type AdminErrorKey
} from '@app/question-report/reportErrorKeys'
import { formatNumber } from '@nihongo/browser/libs/localeFormatters'
import { resolveUiLocale } from '@nihongo/browser/i18n/types'

// #685: the report dialogs' error copy, without the admin app's date,
// number and percent formatters, which the learner app never shows.
const toApiErrorPresentation = (
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

export const useReportPresentation = () => {
  const { i18n, t } = useTranslation('admin')
  const locale = resolveUiLocale(i18n.resolvedLanguage)

  const presentError = useCallback(
    (error: unknown, fallback: AdminErrorKey = 'errors.generic'): string => {
      const presentation = toApiErrorPresentation(error)
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

  return { presentError, presentFieldError, t }
}
