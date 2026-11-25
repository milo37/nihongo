import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { formatNumber } from '@nihongo/browser/libs/localeFormatters'
import { resolveUiLocale } from '@nihongo/browser/i18n/types'

// #1262: a learner sees the report dialog's own copy, never the admin
// app's error table ("서버에서 관리자 요청을…"). Codes a report can get back
// have their own line; anything else is the dialog's "could not send".
const learnerKeyByCode = {
  RATE_LIMITED: 'questionReportDialog.rateLimited',
  QUESTION_REPORT_DUPLICATE: 'questionReportDialog.duplicate',
  VALIDATION_ERROR: 'questionReportDialog.invalid',
  INVALID_REQUEST: 'questionReportDialog.invalid',
  INVALID_JSON: 'questionReportDialog.invalid'
} as const

const readCode = (error: unknown): string | null =>
  error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : null

const readRetryAfterSeconds = (error: unknown): number | null =>
  error instanceof Error &&
  'retryAfterMs' in error &&
  typeof error.retryAfterMs === 'number' &&
  error.retryAfterMs > 0
    ? Math.max(1, Math.ceil(error.retryAfterMs / 1000))
    : null

export const useReportPresentation = () => {
  const { i18n, t } = useTranslation('admin')
  const locale = resolveUiLocale(i18n.resolvedLanguage)

  const presentError = useCallback(
    (error: unknown, fallback: string): string => {
      const code = readCode(error)
      const message =
        code && code in learnerKeyByCode
          ? t(learnerKeyByCode[code as keyof typeof learnerKeyByCode])
          : fallback
      const seconds = readRetryAfterSeconds(error)
      if (seconds === null) return message
      // A long wait (the report limit is minutes long) reads better in
      // minutes, as in the admin app (#712).
      return seconds >= 60
        ? t('common.retryAfterMinutes', {
            message,
            minutes: formatNumber(Math.ceil(seconds / 60), locale)
          })
        : t('common.retryAfter', {
            message,
            seconds: formatNumber(seconds, locale)
          })
    },
    [locale, t]
  )
  const presentFieldError = useCallback(
    (messages: readonly string[] | undefined): string | undefined =>
      messages?.length ? t('questionReportDialog.invalid') : undefined,
    [t]
  )

  return { presentError, presentFieldError, t }
}
