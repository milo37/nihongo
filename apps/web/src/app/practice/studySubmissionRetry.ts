import { isApiError } from '@api/config'

const RETRYABLE_CODES = new Set([
  'INTERNAL_SERVER_ERROR',
  'RATE_LIMITED',
  'SERVICE_UNAVAILABLE'
])

export class SubmissionOutcomeAmbiguousError extends Error {
  override readonly cause: unknown

  constructor(cause: unknown) {
    super('제출 결과를 확인하지 못했습니다. 동일 답안으로 다시 시도해 주세요.')
    this.name = 'SubmissionOutcomeAmbiguousError'
    this.cause = cause
  }
}

export class StudySubmissionPreTransportError extends Error {
  override readonly cause: unknown

  constructor(cause: unknown) {
    super(
      cause instanceof Error
        ? cause.message
        : '답안을 전송하기 전에 제출 준비에 실패했습니다.'
    )
    this.name = 'StudySubmissionPreTransportError'
    this.cause = cause
  }
}

export const isSubmissionOutcomeAmbiguousError = (
  error: unknown
): error is SubmissionOutcomeAmbiguousError =>
  error instanceof SubmissionOutcomeAmbiguousError

export const isStudySubmissionPreTransportError = (
  error: unknown
): error is StudySubmissionPreTransportError =>
  error instanceof StudySubmissionPreTransportError

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

export const isDefinitiveStudySubmissionError = (error: unknown): boolean => {
  if (isStudySubmissionPreTransportError(error)) {
    return true
  }

  if (
    isSubmissionOutcomeAmbiguousError(error) ||
    !isApiError(error) ||
    error.isResponseValidationError ||
    error.code === 'SESSION_ALREADY_SUBMITTED'
  ) {
    return false
  }

  return Boolean(
    error.status &&
      error.status >= 400 &&
      error.status < 500 &&
      error.status !== 408 &&
      error.status !== 429
  )
}
