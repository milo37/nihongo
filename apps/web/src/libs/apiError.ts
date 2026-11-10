import { isApiError } from '@nihongo/browser/api/config'

export { isNotFoundApiError } from '@nihongo/browser/util/apiError'

export const isAuthenticationBoundaryApiError = (error: unknown): boolean =>
  isApiError(error) && (error.status === 401 || error.status === 404)

export const isOfflineApiError = (error: unknown): boolean =>
  isApiError(error) && error.isOffline === true

export const isRetiredPracticeApiError = (error: unknown): boolean =>
  isApiError(error) &&
  error.status === 409 &&
  error.code === 'PRACTICE_CONTRACT_VERSION_MISMATCH'

export const isAccountRestrictedApiError = (error: unknown): boolean =>
  isApiError(error) && error.code === 'ACCOUNT_RESTRICTED'

export const isGuestLimitReachedApiError = (error: unknown): boolean =>
  isApiError(error) && error.code === 'GUEST_LIMIT_REACHED'

/** When a guest refused for the daily limit can start again (ISO UTC). */
export const getGuestLimitResetsAt = (error: unknown): string | undefined =>
  isApiError(error) && error.code === 'GUEST_LIMIT_REACHED'
    ? error.details?.resetsAt
    : undefined

export const isNoEligibleQuestionsApiError = (error: unknown): boolean =>
  isApiError(error) && error.code === 'NO_ELIGIBLE_QUESTIONS'

export const isQuestionNotAvailableApiError = (error: unknown): boolean =>
  isApiError(error) && error.code === 'QUESTION_NOT_AVAILABLE'

export const isStudyResultNotReadyApiError = (error: unknown): boolean =>
  isApiError(error) && error.code === 'STUDY_RESULT_NOT_READY'

export interface UiApiError extends Error {
  readonly code?: string
  readonly fieldErrors?: Record<string, string[]>
  readonly isOffline?: boolean
  readonly requestId?: string
  readonly retryAfterMs?: number
  readonly serverMessage?: string
  readonly status?: number
}

export const isUiApiError = (error: unknown): error is UiApiError =>
  error instanceof Error &&
  ('code' in error ||
    'fieldErrors' in error ||
    'isOffline' in error ||
    'requestId' in error ||
    'retryAfterMs' in error ||
    'serverMessage' in error ||
    'status' in error)
