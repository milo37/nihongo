import { isApiError } from '@nihongo/browser/api/config'

const RETRYABLE_CODES = new Set([
  'INTERNAL_SERVER_ERROR',
  'RATE_LIMITED',
  'SERVICE_UNAVAILABLE'
])

export class SubmissionOutcomeAmbiguousError extends Error {
  override readonly cause: unknown

  constructor(cause: unknown) {
    super('제출 결과를 확인하지 못했습니다. 다시 제출해 주세요.')
    this.name = 'SubmissionOutcomeAmbiguousError'
    this.cause = cause
  }
}

export const isSubmissionOutcomeAmbiguousError = (
  error: unknown
): error is SubmissionOutcomeAmbiguousError =>
  error instanceof SubmissionOutcomeAmbiguousError

export const isRetryableStudySubmissionError = (error: unknown): boolean => {
  if (!isApiError(error)) {
    return false
  }

  return Boolean(
    error.isNetworkError ||
      error.isOffline ||
      error.isServerError ||
      error.status === 429 ||
      (error.code && RETRYABLE_CODES.has(error.code))
  )
}

export const getStudySubmissionRetryDelay = (
  attempt: number,
  error: unknown
): number => {
  if (isApiError(error) && error.retryAfterMs !== undefined) {
    return error.retryAfterMs
  }

  return Math.min(1_000 * 2 ** attempt, 10_000)
}

export const getStudySubmissionErrorCode = (error: unknown): string | null =>
  isApiError(error) ? (error.code ?? null) : null
